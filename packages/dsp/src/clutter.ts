/**
 * Coherent EWMA clutter canceller. Maintains a slowly-adapting complex
 * background per range bin; subtracting it removes static reflections (walls,
 * furniture, direct speaker→mic leakage) while preserving moving targets.
 *
 *   B_t(r) = α·B_{t-1}(r) + (1-α)·X_t(r)
 *   out(r) = X_t(r) − B_t(r)
 *
 * Operating on complex bins (not magnitudes) cancels static echoes
 * coherently, which is far more effective than magnitude subtraction.
 */
export class EwmaClutter {
  private readonly bgRe: Float32Array;
  private readonly bgIm: Float32Array;
  private readonly alpha: number;
  private primed = false;

  constructor(alpha: number, bins: number) {
    this.alpha = alpha;
    this.bgRe = new Float32Array(bins);
    this.bgIm = new Float32Array(bins);
  }

  reset(): void {
    this.bgRe.fill(0);
    this.bgIm.fill(0);
    this.primed = false;
  }

  /** Update background with the current profile and subtract it in place. */
  update(profileRe: Float32Array, profileIm: Float32Array): void {
    const n = Math.min(profileRe.length, this.bgRe.length);
    const a = this.alpha;
    const b = 1 - a;
    if (!this.primed) {
      for (let r = 0; r < n; r++) {
        this.bgRe[r] = profileRe[r];
        this.bgIm[r] = profileIm[r];
      }
      this.primed = true;
    }
    for (let r = 0; r < n; r++) {
      this.bgRe[r] = a * this.bgRe[r] + b * profileRe[r];
      this.bgIm[r] = a * this.bgIm[r] + b * profileIm[r];
      profileRe[r] -= this.bgRe[r];
      profileIm[r] -= this.bgIm[r];
    }
  }
}

/** Zero complex bins below `minBin` (near-field range gate against crosstalk). */
export function zeroBelowBin(re: Float32Array, im: Float32Array, minBin: number): void {
  const lim = Math.min(minBin, re.length);
  for (let r = 0; r < lim; r++) {
    re[r] = 0;
    im[r] = 0;
  }
}
