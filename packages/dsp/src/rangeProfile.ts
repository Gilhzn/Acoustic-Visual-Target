import { ampToDb, type Decibels } from "@avt/core-units";

/** Beat frequency (Hz) for an FFT bin given the baseband analysis rate. */
export const binToBeatHz = (bin: number, basebandRate: number, fftSize: number): number =>
  (bin * basebandRate) / fftSize;

export interface PeakResult {
  /** Sub-bin-interpolated peak index. */
  bin: number;
  beatHz: number;
  magnitude: number;
  snrDb: Decibels;
}

export interface PeakOpts {
  minBin?: number;
  maxBin?: number;
  /** CFAR guard cells either side of the peak (excluded from noise estimate). */
  guard?: number;
  /** CFAR training cells either side (used for noise estimate). */
  training?: number;
}

/**
 * Cell-averaging CFAR peak detector with parabolic sub-bin interpolation.
 * Sub-bin interpolation improves *precision* (jitter), not range *resolution*
 * (which is fixed at c/2B). Returns the strongest peak and its SNR vs the
 * surrounding noise floor.
 */
export function pickPeak(
  mag: Float32Array,
  basebandRate: number,
  fftSize: number,
  opts: PeakOpts = {},
): PeakResult {
  const n = mag.length;
  const lo = Math.max(1, opts.minBin ?? 1);
  const hi = Math.min(n - 2, opts.maxBin ?? n - 2);
  const guard = opts.guard ?? 2;
  const training = opts.training ?? 8;

  let peakBin = lo;
  let peakVal = -Infinity;
  for (let i = lo; i <= hi; i++) {
    if (mag[i] > peakVal) {
      peakVal = mag[i];
      peakBin = i;
    }
  }
  if (!isFinite(peakVal) || peakVal <= 0) {
    return { bin: peakBin, beatHz: 0, magnitude: 0, snrDb: ampToDb(0) };
  }

  // Parabolic interpolation around the integer peak.
  let refined = peakBin;
  const ym = mag[peakBin - 1];
  const y0 = mag[peakBin];
  const yp = mag[peakBin + 1];
  const denom = ym - 2 * y0 + yp;
  if (Math.abs(denom) > 1e-12) {
    const delta = (0.5 * (ym - yp)) / denom;
    if (delta > -1 && delta < 1) refined = peakBin + delta;
  }

  // CFAR noise estimate from training cells outside the guard band.
  let noiseSum = 0;
  let noiseCount = 0;
  const innerLo = peakBin - guard;
  const innerHi = peakBin + guard;
  for (let i = peakBin - guard - training; i <= peakBin + guard + training; i++) {
    if (i < 0 || i >= n) continue;
    if (i >= innerLo && i <= innerHi) continue;
    noiseSum += mag[i];
    noiseCount++;
  }
  const noise = noiseCount > 0 ? noiseSum / noiseCount : peakVal * 1e-3;
  const snr = peakVal / Math.max(noise, 1e-9);

  return {
    bin: refined,
    beatHz: binToBeatHz(refined, basebandRate, fftSize),
    magnitude: peakVal,
    snrDb: ampToDb(snr),
  };
}
