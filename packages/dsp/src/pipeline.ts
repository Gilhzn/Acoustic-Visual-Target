import {
  SPEED_OF_SOUND_MPS,
  isPowerOfTwo,
  meters,
  type Hz,
  type Meters,
  type Seconds,
} from "@avt/core-units";
import type { AcousticMeasurement, RangeProcessor } from "@avt/contracts";
import {
  chirpSamples,
  rangeToBeat,
  beatToRange,
  synthChirpIQ,
  type ChirpSpec,
} from "./chirp.js";
import { FftPlan, magnitudeSpectrum } from "./fft.js";
import { designBandpass, designLowpass, FirFilter } from "./fir.js";
import { dechirp } from "./dechirp.js";
import { firDecimateComplex } from "./iqdemod.js";
import { EwmaClutter, zeroBelowBin } from "./clutter.js";
import { pickPeak } from "./rangeProfile.js";
import { phaseDiff, pdoaToAzimuth } from "./pdoa.js";
import { makeWindow } from "./window.js";

export interface PipelineOpts {
  /** Physical mic baseline (m). Drives PDoA azimuth + its ambiguity. */
  micBaselineM?: number;
  /** Apply the linear-phase band-pass before dechirp (default true). */
  bandpass?: boolean;
  bandpassTaps?: number;
  bandpassLowHz?: number;
  bandpassHighHz?: number;
  /** Decimation factor from fs to the baseband analysis rate (default 8). */
  decimation?: number;
  lowpassTaps?: number;
  /** Zero-pad factor for the analysis FFT (finer peak interpolation). */
  zeroPad?: number;
  /** Coherent EWMA clutter cancellation across frames (default true). */
  clutter?: boolean;
  clutterAlpha?: number;
  /** Near-field range gate (m) — blocks speaker→mic crosstalk. */
  nearFieldGateM?: number;
  /** Minimum SNR (dB) for a measurement to be flagged valid. */
  minSnrDb?: number;
  /** Carrier for the PDoA wavelength (default mid-band). */
  carrierHz?: number;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * End-to-end FMCW acoustic pipeline: band-pass → dechirp → decimate → window →
 * FFT range profile → clutter cancel → near-field gate → CFAR peak → range,
 * with dual-mic PDoA azimuth (alias-enumerated). One `process` call consumes
 * one chirp-echo frame on both mics. All hot buffers are preallocated.
 */
export class AcousticPipeline implements RangeProcessor {
  readonly name = "ts-fmcw";
  private readonly spec: ChirpSpec;
  private readonly opts: Required<PipelineOpts>;
  private readonly refLen: number;
  private readonly basebandRate: number;
  private readonly fftSize: number;
  private readonly lambdaM: number;
  private readonly minBin: number;
  private readonly maxBin: number;

  // Reference (optionally band-passed so group delay cancels in the dechirp).
  private readonly refRe: Float32Array;
  private readonly refIm: Float32Array;
  private readonly bpTaps: Float32Array;
  private readonly lpTaps: Float32Array;
  private readonly fir0: FirFilter;
  private readonly fir1: FirFilter;
  private readonly fft: FftPlan;
  private readonly clut0: EwmaClutter;
  private readonly clut1: EwmaClutter;
  private readonly win: Float32Array;

  // Scratch (allocation-free hot path).
  private readonly bp0: Float32Array;
  private readonly bp1: Float32Array;
  private readonly deI0: Float32Array;
  private readonly deQ0: Float32Array;
  private readonly deI1: Float32Array;
  private readonly deQ1: Float32Array;
  private readonly bbI0: Float32Array;
  private readonly bbQ0: Float32Array;
  private readonly bbI1: Float32Array;
  private readonly bbQ1: Float32Array;
  private readonly re0: Float32Array;
  private readonly im0: Float32Array;
  private readonly re1: Float32Array;
  private readonly im1: Float32Array;
  private readonly mag0: Float32Array;

  constructor(spec: ChirpSpec, opts: PipelineOpts = {}) {
    this.spec = spec;
    const fs = spec.fs as number;
    const o: Required<PipelineOpts> = {
      micBaselineM: opts.micBaselineM ?? 0.1,
      bandpass: opts.bandpass ?? true,
      bandpassTaps: opts.bandpassTaps ?? 127,
      bandpassLowHz: opts.bandpassLowHz ?? 17500,
      bandpassHighHz: opts.bandpassHighHz ?? 22500,
      decimation: opts.decimation ?? 8,
      lowpassTaps: opts.lowpassTaps ?? 63,
      zeroPad: opts.zeroPad ?? 4,
      clutter: opts.clutter ?? true,
      clutterAlpha: opts.clutterAlpha ?? 0.95,
      nearFieldGateM: opts.nearFieldGateM ?? 0.15,
      minSnrDb: opts.minSnrDb ?? 6,
      carrierHz: opts.carrierHz ?? ((spec.fStart as number) + (spec.fEnd as number)) / 2,
    };
    this.opts = o;
    this.refLen = chirpSamples(spec);
    this.basebandRate = fs / o.decimation;
    this.lambdaM = (SPEED_OF_SOUND_MPS as number) / o.carrierHz;

    const decimLen = Math.floor(this.refLen / o.decimation);
    this.fftSize = Math.min(8192, nextPow2(decimLen * o.zeroPad));
    if (!isPowerOfTwo(this.fftSize)) throw new Error("internal fft size error");

    // Build complex reference; band-pass it so the FIR group delay cancels.
    const raw = synthChirpIQ(spec);
    this.bpTaps = designBandpass(
      o.bandpassLowHz as Hz,
      o.bandpassHighHz as Hz,
      spec.fs,
      o.bandpassTaps,
    );
    this.lpTaps = designLowpass(
      (0.45 * this.basebandRate) as Hz,
      spec.fs,
      o.lowpassTaps,
    );
    if (o.bandpass) {
      const rRe = new Float32Array(this.refLen);
      const rIm = new Float32Array(this.refLen);
      new FirFilter(this.bpTaps).process(raw.re, rRe);
      new FirFilter(this.bpTaps).process(raw.im, rIm);
      this.refRe = rRe;
      this.refIm = rIm;
    } else {
      this.refRe = raw.re;
      this.refIm = raw.im;
    }

    this.fir0 = new FirFilter(this.bpTaps);
    this.fir1 = new FirFilter(this.bpTaps);
    this.fft = new FftPlan(this.fftSize);
    this.clut0 = new EwmaClutter(o.clutterAlpha, this.fftSize);
    this.clut1 = new EwmaClutter(o.clutterAlpha, this.fftSize);
    this.win = makeWindow("hann", decimLen);

    this.bp0 = new Float32Array(this.refLen);
    this.bp1 = new Float32Array(this.refLen);
    this.deI0 = new Float32Array(this.refLen);
    this.deQ0 = new Float32Array(this.refLen);
    this.deI1 = new Float32Array(this.refLen);
    this.deQ1 = new Float32Array(this.refLen);
    this.bbI0 = new Float32Array(decimLen);
    this.bbQ0 = new Float32Array(decimLen);
    this.bbI1 = new Float32Array(decimLen);
    this.bbQ1 = new Float32Array(decimLen);
    this.re0 = new Float32Array(this.fftSize);
    this.im0 = new Float32Array(this.fftSize);
    this.re1 = new Float32Array(this.fftSize);
    this.im1 = new Float32Array(this.fftSize);
    this.mag0 = new Float32Array(this.fftSize >> 1);

    const nearBeat = rangeToBeat(meters(o.nearFieldGateM), spec);
    this.minBin = Math.max(1, Math.ceil((nearBeat * this.fftSize) / this.basebandRate));
    this.maxBin = (this.fftSize >> 1) - 2;
  }

  reset(): void {
    this.fir0.reset();
    this.fir1.reset();
    this.clut0.reset();
    this.clut1.reset();
  }

  /** Range resolution of the configured chirp (c/2B). */
  get rangeResolutionM(): Meters {
    return ((SPEED_OF_SOUND_MPS as number) /
      (2 * Math.abs((this.spec.fEnd as number) - (this.spec.fStart as number)))) as Meters;
  }

  get maxRangeM(): Meters {
    return beatToRange(this.basebandRate / 2, this.spec);
  }

  private conditionMic(
    rx: Float32Array,
    bp: Float32Array,
    fir: FirFilter,
    deI: Float32Array,
    deQ: Float32Array,
    bbI: Float32Array,
    bbQ: Float32Array,
    re: Float32Array,
    im: Float32Array,
    clut: EwmaClutter,
  ): void {
    const src = this.opts.bandpass ? bp : rx;
    if (this.opts.bandpass) {
      fir.reset();
      fir.process(rx, bp);
    }
    dechirp(src, this.refRe, this.refIm, deI, deQ);
    const dLen = firDecimateComplex(deI, deQ, this.lpTaps, this.opts.decimation, bbI, bbQ);
    // Window then zero-pad into FFT buffers.
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < dLen; i++) {
      const w = this.win[i];
      re[i] = bbI[i] * w;
      im[i] = bbQ[i] * w;
    }
    this.fft.forward(re, im);
    if (this.opts.clutter) clut.update(re, im);
    zeroBelowBin(re, im, this.minBin);
  }

  process(mic0: Float32Array, mic1: Float32Array, tSec: Seconds): AcousticMeasurement {
    this.conditionMic(
      mic0, this.bp0, this.fir0, this.deI0, this.deQ0,
      this.bbI0, this.bbQ0, this.re0, this.im0, this.clut0,
    );
    this.conditionMic(
      mic1, this.bp1, this.fir1, this.deI1, this.deQ1,
      this.bbI1, this.bbQ1, this.re1, this.im1, this.clut1,
    );

    magnitudeSpectrum(this.re0, this.im0, this.mag0);
    const peak = pickPeak(this.mag0, this.basebandRate, this.fftSize, {
      minBin: this.minBin,
      maxBin: this.maxBin,
    });
    const rangeM = beatToRange(peak.beatHz, this.spec);

    const bin = Math.round(peak.bin);
    const dPhi = phaseDiff(this.re0[bin], this.im0[bin], this.re1[bin], this.im1[bin]);
    const az = pdoaToAzimuth(dPhi, meters(this.opts.micBaselineM), meters(this.lambdaM));

    const valid = (peak.snrDb as number) >= this.opts.minSnrDb && (rangeM as number) > 0;
    return {
      rangeM,
      azimuthRad: az.theta,
      aliases: az.aliases,
      ambiguous: az.ambiguous,
      snrDb: peak.snrDb,
      tSec,
      valid,
    };
  }
}
