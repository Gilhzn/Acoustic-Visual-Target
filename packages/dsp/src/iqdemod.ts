import type { Hz, SampleRate } from "@avt/core-units";

/**
 * Homodyne I/Q down-conversion of a real signal by a carrier:
 *   I = x·cos(2πfc·t),  Q = -x·sin(2πfc·t)
 * Provided for the spec's alternative demod path and for tests.
 */
export function iqMix(
  x: Float32Array,
  carrier: Hz,
  fs: SampleRate,
  outI: Float32Array,
  outQ: Float32Array,
): void {
  const n = Math.min(x.length, outI.length, outQ.length);
  const w = (2 * Math.PI * (carrier as number)) / (fs as number);
  for (let i = 0; i < n; i++) {
    const ph = w * i;
    outI[i] = x[i] * Math.cos(ph);
    outQ[i] = -x[i] * Math.sin(ph);
  }
}

/**
 * Decimating complex FIR: applies the (real) anti-alias low-pass `taps` to the
 * I and Q channels and keeps every `factor`-th output. Computes only the kept
 * samples (efficient polyphase-equivalent). Returns the number of output samples.
 *
 * y[m] = Σ_t taps[t]·in[m·factor − t]   (causal, zero for negative index)
 */
export function firDecimateComplex(
  inI: Float32Array,
  inQ: Float32Array,
  taps: Float32Array,
  factor: number,
  outI: Float32Array,
  outQ: Float32Array,
): number {
  const len = Math.min(inI.length, inQ.length);
  const ntaps = taps.length;
  const outLen = Math.floor(len / factor);
  const cap = Math.min(outLen, outI.length, outQ.length);
  for (let m = 0; m < cap; m++) {
    const base = m * factor;
    let accI = 0;
    let accQ = 0;
    const tMax = Math.min(ntaps, base + 1);
    for (let t = 0; t < tMax; t++) {
      const idx = base - t;
      const c = taps[t];
      accI += c * inI[idx];
      accQ += c * inQ[idx];
    }
    outI[m] = accI;
    outQ[m] = accQ;
  }
  return cap;
}

/** Effective sample rate after decimation. */
export const decimatedRate = (fs: SampleRate, factor: number): number =>
  (fs as number) / factor;
