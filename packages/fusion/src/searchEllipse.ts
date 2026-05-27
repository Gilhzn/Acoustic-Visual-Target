import type { CameraIntrinsics } from "@avt/contracts";
import { PX, PY, PZ, type State6, type Cov6 } from "./state.js";
import { chiSquareThreshold } from "./gating.js";

export interface SearchEllipse {
  centerU: number;
  centerV: number;
  semiMajor: number;
  semiMinor: number;
  /** Orientation of the major axis (radians, image plane). */
  angleRad: number;
  valid: boolean;
}

/**
 * Project the predicted 3D position and its covariance into the image plane,
 * yielding a confidence ellipse. When visual tracking is lost the covariance
 * grows, the ellipse expands, and detection is constrained to this region for
 * fast re-acquisition.
 *
 *   Σ₂D = J · P_pos · Jᵀ,   J = ∂[u,v]/∂p  (2×3)
 */
export function projectSearchEllipse(
  x: State6,
  P: Cov6,
  K: CameraIntrinsics,
  confidence = 0.95,
): SearchEllipse {
  const px = x[PX];
  const py = x[PY];
  const pz = x[PZ];
  if (pz <= 1e-3) {
    return { centerU: K.cx, centerV: K.cy, semiMajor: 0, semiMinor: 0, angleRad: 0, valid: false };
  }
  const inv = 1 / pz;
  const inv2 = inv * inv;
  // J (2×3): rows u,v ; cols px,py,pz
  const j00 = K.fx * inv;
  const j02 = -K.fx * px * inv2;
  const j11 = K.fy * inv;
  const j12 = -K.fy * py * inv2;

  // Position covariance 3×3 block.
  const p00 = P[PX * 6 + PX], p01 = P[PX * 6 + PY], p02 = P[PX * 6 + PZ];
  const p11 = P[PY * 6 + PY], p12 = P[PY * 6 + PZ];
  const p22 = P[PZ * 6 + PZ];

  // J·P (2×3) with J row0 = [j00,0,j02], row1 = [0,j11,j12].
  const a0 = j00 * p00 + j02 * p02; // (0, x)
  const a1 = j00 * p01 + j02 * p12; // (0, y)
  const a2 = j00 * p02 + j02 * p22; // (0, z)
  const b1 = j11 * p11 + j12 * p12; // (1, y)
  const b2 = j11 * p12 + j12 * p22; // (1, z)

  // Σ = (J·P)·Jᵀ (2×2 symmetric).
  const s00 = a0 * j00 + a2 * j02;
  const s01 = a1 * j11 + a2 * j12;
  const s11 = b1 * j11 + b2 * j12;

  // Eigen-decomposition of [[s00,s01],[s01,s11]].
  const tr = s00 + s11;
  const det = s00 * s11 - s01 * s01;
  const disc = Math.sqrt(Math.max(tr * tr * 0.25 - det, 0));
  const l1 = tr * 0.5 + disc;
  const l2 = tr * 0.5 - disc;
  const chi2 = chiSquareThreshold(2, confidence);
  const angle = Math.abs(s01) < 1e-12 && s00 >= s11 ? 0 : 0.5 * Math.atan2(2 * s01, s00 - s11);

  const u = (K.fx * px) / pz + K.cx;
  const v = (K.fy * py) / pz + K.cy;
  return {
    centerU: u,
    centerV: v,
    semiMajor: Math.sqrt(chi2 * Math.max(l1, 0)),
    semiMinor: Math.sqrt(chi2 * Math.max(l2, 0)),
    angleRad: angle,
    valid: true,
  };
}
