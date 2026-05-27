import {
  SPEED_OF_SOUND_MPS,
  type Hz,
  type Meters,
  type SampleRate,
} from "@avt/core-units";

/** Linear FMCW chirp (sawtooth sweep) specification. */
export interface ChirpSpec {
  fStart: Hz;
  fEnd: Hz;
  durationS: number;
  fs: SampleRate;
}

export const chirpSamples = (spec: ChirpSpec): number =>
  Math.round(spec.durationS * (spec.fs as number));

export const chirpBandwidthHz = (spec: ChirpSpec): number =>
  Math.abs((spec.fEnd as number) - (spec.fStart as number));

/** Sweep rate β = BW / T  (Hz per second). */
export const chirpSweepRate = (spec: ChirpSpec): number =>
  ((spec.fEnd as number) - (spec.fStart as number)) / spec.durationS;

/** Range resolution ΔR = c / (2·BW). */
export const chirpRangeResolution = (spec: ChirpSpec): Meters =>
  ((SPEED_OF_SOUND_MPS as number) / (2 * chirpBandwidthHz(spec))) as Meters;

/** Beat frequency for a target at range R: f_b = β·(2R/c). */
export const rangeToBeat = (range: Meters, spec: ChirpSpec): number =>
  (Math.abs(chirpSweepRate(spec)) * 2 * (range as number)) / (SPEED_OF_SOUND_MPS as number);

/** Range for a measured beat frequency: R = f_b·c / (2·β). */
export const beatToRange = (beatHz: number, spec: ChirpSpec): Meters =>
  ((beatHz * (SPEED_OF_SOUND_MPS as number)) /
    (2 * Math.abs(chirpSweepRate(spec)))) as Meters;

/** Max unambiguous range for a given baseband analysis rate (Nyquist beat). */
export const chirpMaxRange = (spec: ChirpSpec, basebandRate: number): Meters =>
  beatToRange(basebandRate / 2, spec);

interface SynthOpts {
  amplitude?: number;
  /** Fraction of each edge to raise-cosine taper (anti-click). 0..0.5. */
  taperFraction?: number;
}

function edgeTaper(n: number, total: number, taperFraction: number): number {
  if (taperFraction <= 0) return 1;
  const edge = Math.max(1, Math.floor(total * taperFraction));
  if (n < edge) return 0.5 - 0.5 * Math.cos((Math.PI * n) / edge);
  if (n >= total - edge) return 0.5 - 0.5 * Math.cos((Math.PI * (total - 1 - n)) / edge);
  return 1;
}

/**
 * Real up-chirp s(t) = A·g(t)·cos(2π(f0·t + β/2·t²)), g = edge taper.
 * Writes into `out` (allocated if omitted) and returns it.
 */
export function synthChirp(spec: ChirpSpec, out?: Float32Array, opts: SynthOpts = {}): Float32Array {
  const n = chirpSamples(spec);
  const buf = out ?? new Float32Array(n);
  const fs = spec.fs as number;
  const f0 = spec.fStart as number;
  const beta = chirpSweepRate(spec);
  const amp = opts.amplitude ?? 1;
  const taper = opts.taperFraction ?? 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const phase = 2 * Math.PI * (f0 * t + 0.5 * beta * t * t);
    buf[i] = amp * edgeTaper(i, n, taper) * Math.cos(phase);
  }
  return buf;
}

/**
 * Complex analytic reference chirp exp(j·φ(t)). `outRe`/`outIm` are filled (and
 * allocated if omitted). Used as the dechirp mixing reference.
 */
export function synthChirpIQ(
  spec: ChirpSpec,
  outRe?: Float32Array,
  outIm?: Float32Array,
): { re: Float32Array; im: Float32Array } {
  const n = chirpSamples(spec);
  const re = outRe ?? new Float32Array(n);
  const im = outIm ?? new Float32Array(n);
  const fs = spec.fs as number;
  const f0 = spec.fStart as number;
  const beta = chirpSweepRate(spec);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const phase = 2 * Math.PI * (f0 * t + 0.5 * beta * t * t);
    re[i] = Math.cos(phase);
    im[i] = Math.sin(phase);
  }
  return { re, im };
}
