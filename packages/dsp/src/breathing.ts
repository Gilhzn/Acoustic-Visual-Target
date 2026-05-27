import { SPEED_OF_SOUND_MPS, powerToDb, type Decibels } from "@avt/core-units";
import { FftPlan } from "./fft.js";
import { makeWindow } from "./window.js";

export interface BreathingResult {
  /** Breaths per minute (0 when no breathing is detected). */
  rateBpm: number;
  /** Strength of the breathing oscillation vs the rest of the band. */
  snrDb: Decibels;
  /** True when a confident breathing-band oscillation is present (a living body). */
  alive: boolean;
  /** Estimated peak-to-peak chest displacement (mm). */
  displacementMm: number;
}

export interface BreathingOpts {
  /** Rate at which push() is called (acoustic frame rate, Hz). */
  frameRateHz: number;
  /** Carrier used for the displacement estimate (Hz). */
  carrierHz: number;
  /** Analysis window length (s). */
  windowSec?: number;
  minBpm?: number;
  maxBpm?: number;
  /** Band SNR (dB) above which a breathing signal is declared "alive". */
  aliveSnrDb?: number;
}

/**
 * Acoustic micro-motion / breathing detector.
 *
 * A breathing chest shifts the round-trip path by millimetres — far below the
 * range resolution, but it rotates the PHASE of the target's echo by radians
 * (Δφ = 4π·Δd/λ). Tracking that phase over a multi-second window and finding
 * the dominant oscillation in the breathing band (≈0.1–0.6 Hz) reveals a living
 * body and its breathing rate, even in total darkness. Same-room / line-of-sight
 * only — sound does not pass through walls.
 */
export class BreathingDetector {
  private readonly n: number;
  private readonly frameRate: number;
  private readonly lambda: number;
  private readonly minHz: number;
  private readonly maxHz: number;
  private readonly aliveSnrDb: number;

  private readonly phase: Float32Array;
  private idx = 0;
  private count = 0;
  private lastWrapped = 0;
  private acc = 0;
  private hasLast = false;

  private readonly fftSize: number;
  private readonly fft: FftPlan;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly win: Float32Array;

  constructor(opts: BreathingOpts) {
    this.frameRate = opts.frameRateHz;
    this.lambda = (SPEED_OF_SOUND_MPS as number) / opts.carrierHz;
    this.minHz = (opts.minBpm ?? 6) / 60;
    this.maxHz = (opts.maxBpm ?? 40) / 60;
    this.aliveSnrDb = opts.aliveSnrDb ?? 6;
    const windowSec = opts.windowSec ?? 12;
    this.n = Math.max(16, Math.round(this.frameRate * windowSec));
    this.phase = new Float32Array(this.n);

    let p = 1;
    while (p < this.n * 2) p <<= 1;
    this.fftSize = Math.min(2048, p);
    this.fft = new FftPlan(this.fftSize);
    this.re = new Float32Array(this.fftSize);
    this.im = new Float32Array(this.fftSize);
    this.win = makeWindow("hann", this.n);
  }

  reset(): void {
    this.idx = 0;
    this.count = 0;
    this.acc = 0;
    this.hasLast = false;
  }

  /** Feed one complex sample taken at the target's range bin. */
  push(re: number, im: number): void {
    const wrapped = Math.atan2(im, re);
    if (!this.hasLast) {
      this.acc = wrapped;
      this.hasLast = true;
    } else {
      let d = wrapped - this.lastWrapped;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.acc += d;
    }
    this.lastWrapped = wrapped;
    this.phase[this.idx] = this.acc;
    this.idx = this.idx + 1 >= this.n ? 0 : this.idx + 1;
    if (this.count < this.n) this.count++;
  }

  analyze(): BreathingResult {
    const none: BreathingResult = { rateBpm: 0, snrDb: powerToDb(0), alive: false, displacementMm: 0 };
    if (this.count < this.n * 0.6) return none;

    const m = this.count;
    const start = this.count < this.n ? 0 : this.idx;
    // Ordered copy.
    const s = this.re; // reuse as scratch real series
    for (let i = 0; i < m; i++) s[i] = this.phase[(start + i) % this.n];

    // Linear detrend (remove slow drift / target motion).
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < m; i++) {
      sx += i;
      sy += s[i];
      sxx += i * i;
      sxy += i * s[i];
    }
    const denom = m * sxx - sx * sx;
    const slope = denom !== 0 ? (m * sxy - sx * sy) / denom : 0;
    const intercept = (sy - slope * sx) / m;

    let rms = 0;
    for (let i = 0; i < m; i++) {
      const d = s[i] - (intercept + slope * i);
      const wv = d * this.win[i];
      this.re[i] = wv;
      rms += d * d;
    }
    rms = Math.sqrt(rms / m);
    for (let i = m; i < this.fftSize; i++) this.re[i] = 0;
    this.im.fill(0);

    this.fft.forward(this.re, this.im);

    const freqRes = this.frameRate / this.fftSize;
    const loBin = Math.max(1, Math.floor(this.minHz / freqRes));
    const hiBin = Math.min(this.fftSize >> 1, Math.ceil(this.maxHz / freqRes));

    let peakBin = loBin;
    let peakPow = -1;
    let bandSum = 0;
    let bandCount = 0;
    for (let k = loBin; k <= hiBin; k++) {
      const pw = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      bandSum += pw;
      bandCount++;
      if (pw > peakPow) {
        peakPow = pw;
        peakBin = k;
      }
    }
    if (bandCount === 0 || peakPow <= 0) return none;
    const noise = Math.max((bandSum - peakPow) / Math.max(bandCount - 1, 1), 1e-12);
    const snrDb = powerToDb(peakPow / noise);
    const rateBpm = peakBin * freqRes * 60;
    // Δφ amplitude ≈ rms·√2 ; Δd = Δφ·λ/(4π) ; peak-to-peak = 2·Δd.
    const ampPhase = rms * Math.SQRT2;
    const displacementMm = (2 * ampPhase * this.lambda) / (4 * Math.PI) * 1000;
    const alive = (snrDb as number) >= this.aliveSnrDb;

    return { rateBpm, snrDb, alive, displacementMm };
  }
}
