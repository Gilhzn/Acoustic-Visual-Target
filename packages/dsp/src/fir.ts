import type { Hz, SampleRate } from "@avt/core-units";
import { makeWindow, type WindowKind } from "./window.js";

const sincN = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/**
 * |H(ν)| of a tap set at normalized frequency ν (cycles/sample, 0..0.5).
 * Used for unity-gain normalization and by tests.
 */
export function frequencyResponseMag(taps: Float32Array, normFreq: number): number {
  let re = 0;
  let im = 0;
  const w = 2 * Math.PI * normFreq;
  for (let n = 0; n < taps.length; n++) {
    re += taps[n] * Math.cos(w * n);
    im -= taps[n] * Math.sin(w * n);
  }
  return Math.hypot(re, im);
}

/**
 * Linear-phase band-pass FIR via windowed-sinc. `numTaps` should be odd for a
 * symmetric (Type-I) filter. The result is normalized to unity gain at band
 * center. Linear phase is required so the dechirp stage keeps phase coherence
 * (IIR group-delay distortion would corrupt PDoA).
 */
export function designBandpass(
  fLow: Hz,
  fHigh: Hz,
  fs: SampleRate,
  numTaps: number,
  windowKind: WindowKind = "blackman-harris",
): Float32Array {
  const taps = new Float32Array(numTaps);
  const M = (numTaps - 1) / 2;
  const fc1 = (fLow as number) / (fs as number);
  const fc2 = (fHigh as number) / (fs as number);
  const win = makeWindow(windowKind, numTaps);
  for (let n = 0; n < numTaps; n++) {
    const k = n - M;
    const ideal = 2 * fc2 * sincN(2 * fc2 * k) - 2 * fc1 * sincN(2 * fc1 * k);
    taps[n] = ideal * win[n];
  }
  const center = ((fLow as number) + (fHigh as number)) / 2 / (fs as number);
  const g = frequencyResponseMag(taps, center);
  if (g > 1e-9) {
    for (let n = 0; n < numTaps; n++) taps[n] /= g;
  }
  return taps;
}

/**
 * Linear-phase low-pass FIR via windowed-sinc, normalized to unity DC gain.
 * Used as the decimation anti-alias filter.
 */
export function designLowpass(
  fCut: Hz,
  fs: SampleRate,
  numTaps: number,
  windowKind: WindowKind = "blackman-harris",
): Float32Array {
  const taps = new Float32Array(numTaps);
  const M = (numTaps - 1) / 2;
  const fc = (fCut as number) / (fs as number);
  const win = makeWindow(windowKind, numTaps);
  let sum = 0;
  for (let n = 0; n < numTaps; n++) {
    const k = n - M;
    taps[n] = 2 * fc * sincN(2 * fc * k) * win[n];
    sum += taps[n];
  }
  if (Math.abs(sum) > 1e-9) {
    for (let n = 0; n < numTaps; n++) taps[n] /= sum;
  }
  return taps;
}

/**
 * Stateful streaming FIR filter. Uses a circular delay line so `process` is
 * allocation-free and can be called per audio block. Group delay = (N-1)/2.
 */
export class FirFilter {
  private readonly taps: Float32Array;
  private readonly hist: Float32Array;
  private pos = 0;

  constructor(taps: Float32Array) {
    this.taps = taps;
    this.hist = new Float32Array(taps.length);
  }

  reset(): void {
    this.hist.fill(0);
    this.pos = 0;
  }

  process(block: Float32Array, out: Float32Array): void {
    const taps = this.taps;
    const hist = this.hist;
    const len = taps.length;
    let pos = this.pos;
    const count = Math.min(block.length, out.length);
    for (let i = 0; i < count; i++) {
      hist[pos] = block[i];
      let acc = 0;
      let idx = pos;
      for (let t = 0; t < len; t++) {
        acc += taps[t] * hist[idx];
        idx = idx === 0 ? len - 1 : idx - 1;
      }
      out[i] = acc;
      pos = pos === len - 1 ? 0 : pos + 1;
    }
    this.pos = pos;
  }
}
