import type { CameraIntrinsics } from "@avt/contracts";
import { PX, PY, PZ, type State6 } from "./state.js";
import type { Mat } from "./linalg.js";

/**
 * Visual measurement h(x) = [u, v, d]:
 *   u = fx·px/pz + cx,  v = fy·py/pz + cy,  d = pz (optical-axis depth).
 */
export function hVisual(x: State6, K: CameraIntrinsics, out: Float64Array): Float64Array {
  const px = x[PX];
  const py = x[PY];
  const pz = clampDepth(x[PZ]);
  out[0] = (K.fx * px) / pz + K.cx;
  out[1] = (K.fy * py) / pz + K.cy;
  out[2] = pz;
  return out;
}

/** Jacobian ∂h/∂x (3×6) of the visual model at x. */
export function jacobianVisual(x: State6, K: CameraIntrinsics, out: Mat): Mat {
  const px = x[PX];
  const py = x[PY];
  const pz = clampDepth(x[PZ]);
  const inv = 1 / pz;
  const inv2 = inv * inv;
  out.fill(0);
  // u
  out[0 * 6 + PX] = K.fx * inv;
  out[0 * 6 + PZ] = -K.fx * px * inv2;
  // v
  out[1 * 6 + PY] = K.fy * inv;
  out[1 * 6 + PZ] = -K.fy * py * inv2;
  // d = pz
  out[2 * 6 + PZ] = 1;
  return out;
}

/** Monocular depth from a known object height: d = H·fy / h_px. */
export function depthFromSize(bboxHeightPx: number, knownHeightM: number, fy: number): number {
  return (knownHeightM * fy) / Math.max(bboxHeightPx, 1e-3);
}

/**
 * Visual measurement covariance. Pixel noise is roughly constant, but monocular
 * depth error grows with depth² (a 1-pixel bbox change at 5 m means far more
 * metres than at 1 m), so the depth variance scales accordingly.
 */
export function buildRVisual(
  depth: number,
  sigmaPx: number,
  relDepthStd: number,
  out: Mat,
): Mat {
  out.fill(0);
  out[0] = sigmaPx * sigmaPx;
  out[4] = sigmaPx * sigmaPx;
  const sd = relDepthStd * depth * depth;
  out[8] = sd * sd;
  return out;
}

function clampDepth(pz: number): number {
  // Keep the target in front of the camera; avoid divide-by-zero.
  return pz > 1e-3 ? pz : 1e-3;
}
