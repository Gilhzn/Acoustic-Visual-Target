import { PX, PY, PZ, type State6 } from "./state.js";
import type { Mat } from "./linalg.js";

/**
 * Acoustic measurement h(x) = [R, θ]:
 *   R = ‖p‖,  θ = atan2(px, pz)   (azimuth in the x–z plane).
 */
export function hAcoustic(x: State6, out: Float64Array): Float64Array {
  const px = x[PX];
  const py = x[PY];
  const pz = x[PZ];
  out[0] = Math.sqrt(px * px + py * py + pz * pz);
  out[1] = Math.atan2(px, pz);
  return out;
}

/** Jacobian ∂h/∂x (2×6) of the acoustic model at x. */
export function jacobianAcoustic(x: State6, out: Mat): Mat {
  const px = x[PX];
  const py = x[PY];
  const pz = x[PZ];
  const r = Math.max(Math.sqrt(px * px + py * py + pz * pz), 1e-6);
  const horiz = Math.max(px * px + pz * pz, 1e-9);
  out.fill(0);
  // ∂R/∂p
  out[0 * 6 + PX] = px / r;
  out[0 * 6 + PY] = py / r;
  out[0 * 6 + PZ] = pz / r;
  // ∂θ/∂p,  θ = atan2(px, pz)
  out[1 * 6 + PX] = pz / horiz;
  out[1 * 6 + PZ] = -px / horiz;
  return out;
}

/** Diagonal acoustic measurement covariance R = diag((σ_R·rScale)², (σ_θ·azScale)²). */
export function buildRAcoustic(
  sigmaR: number,
  sigmaTheta: number,
  azScale: number,
  out: Mat,
  rangeScale = 1,
): Mat {
  out.fill(0);
  const sr = sigmaR * rangeScale;
  out[0] = sr * sr;
  out[3] = (sigmaTheta * azScale) * (sigmaTheta * azScale);
  return out;
}
