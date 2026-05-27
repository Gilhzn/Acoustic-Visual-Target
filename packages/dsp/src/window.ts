/** Window functions for spectral leakage control. Returned as Float32Array LUTs. */

export type WindowKind = "rect" | "hann" | "hamming" | "blackman-harris";

export function makeWindow(kind: WindowKind, n: number): Float32Array {
  const w = new Float32Array(n);
  if (n <= 0) return w;
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  const N = n - 1;
  switch (kind) {
    case "rect":
      w.fill(1);
      break;
    case "hann":
      for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      break;
    case "hamming":
      for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / N);
      break;
    case "blackman-harris": {
      const a0 = 0.35875,
        a1 = 0.48829,
        a2 = 0.14128,
        a3 = 0.01168;
      for (let i = 0; i < n; i++) {
        const x = (2 * Math.PI * i) / N;
        w[i] = a0 - a1 * Math.cos(x) + a2 * Math.cos(2 * x) - a3 * Math.cos(3 * x);
      }
      break;
    }
  }
  return w;
}

/** Coherent gain (mean of window) — used to normalize amplitude after windowing. */
export function coherentGain(win: Float32Array): number {
  let s = 0;
  for (let i = 0; i < win.length; i++) s += win[i];
  return s / win.length;
}

export function applyWindow(sig: Float32Array, win: Float32Array, out: Float32Array): void {
  const n = Math.min(sig.length, win.length, out.length);
  for (let i = 0; i < n; i++) out[i] = sig[i] * win[i];
}
