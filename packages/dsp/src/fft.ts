import { isPowerOfTwo } from "@avt/core-units";

/**
 * Radix-2 iterative Cooley-Tukey FFT, in-place, split-complex (separate real /
 * imag Float32Arrays). Twiddle factors and the bit-reversal permutation are
 * precomputed at construction so transforms are allocation-free.
 *
 * Sign convention (forward): X_k = Σ_n x_n · e^(-2πi·kn/N).
 */
export class FftPlan {
  readonly n: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    if (!isPowerOfTwo(n)) {
      throw new Error(`FftPlan size must be a power of two, got ${n}`);
    }
    this.n = n;
    const half = n >> 1;
    this.cosTable = new Float32Array(Math.max(half, 1));
    this.sinTable = new Float32Array(Math.max(half, 1));
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinTable[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const levels = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < levels; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r >>> 0;
    }
  }

  /** Forward transform, in place. */
  forward(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    if (re.length < n || im.length < n) {
      throw new Error("FFT buffers smaller than plan size");
    }
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    const cos = this.cosTable;
    const sin = this.sinTable;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const c = cos[k];
          const s = sin[k];
          const tpre = re[l] * c + im[l] * s;
          const tpim = -re[l] * s + im[l] * c;
          re[l] = re[j] - tpre;
          im[l] = im[j] - tpim;
          re[j] += tpre;
          im[j] += tpim;
        }
      }
    }
  }

  /** Inverse transform, in place. Result is scaled by 1/N. */
  inverse(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.forward(re, im);
    const inv = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= inv;
      im[i] = -im[i] * inv;
    }
  }
}

/** Fill `out[i] = sqrt(re[i]²+im[i]²)` for i < out.length. */
export function magnitudeSpectrum(
  re: Float32Array,
  im: Float32Array,
  out: Float32Array,
): void {
  const n = out.length;
  for (let i = 0; i < n; i++) out[i] = Math.hypot(re[i], im[i]);
}

/** Reference (slow) DFT used only to validate the FFT in tests. */
export function naiveDft(
  re: Float32Array,
  im: Float32Array,
): { re: Float32Array; im: Float32Array } {
  const n = re.length;
  const outRe = new Float32Array(n);
  const outIm = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      sr += re[t] * c - im[t] * s;
      si += re[t] * s + im[t] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}
