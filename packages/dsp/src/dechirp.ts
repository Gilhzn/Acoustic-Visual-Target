/**
 * FMCW stretch processing: mix the real received signal with the complex
 * reference chirp exp(jφ(t)). For an echo at delay τ this yields a baseband
 * tone at the POSITIVE beat frequency f_b = β·(2R/c); the sum term (~2·f0) is
 * rejected downstream by the decimation low-pass.
 *
 *   rx · ref = rx·(refRe + j·refIm)
 */
export function dechirp(
  rx: Float32Array,
  refRe: Float32Array,
  refIm: Float32Array,
  outRe: Float32Array,
  outIm: Float32Array,
): void {
  const n = Math.min(rx.length, refRe.length, refIm.length, outRe.length, outIm.length);
  for (let i = 0; i < n; i++) {
    const x = rx[i];
    outRe[i] = x * refRe[i];
    outIm[i] = x * refIm[i];
  }
}
