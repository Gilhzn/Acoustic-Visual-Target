/**
 * EKF state and covariance layout.
 *
 * State x = [px, py, pz, vx, vy, vz] in the CAMERA frame:
 *   x = right, y = down, z = forward (optical axis), metres / (m/s).
 * The acoustic sensor sits at the origin; azimuth is the bearing in the x–z
 * plane (assumes a horizontal mic baseline, i.e. the phone held in landscape).
 *
 * Covariance P is 6×6 stored row-major (length 36).
 */
export type State6 = Float64Array;
export type Cov6 = Float64Array;

export const PX = 0;
export const PY = 1;
export const PZ = 2;
export const VX = 3;
export const VY = 4;
export const VZ = 5;
export const STATE_DIM = 6;

export function makeState(
  px: number,
  py: number,
  pz: number,
  vx = 0,
  vy = 0,
  vz = 0,
): State6 {
  const s = new Float64Array(6);
  s[PX] = px;
  s[PY] = py;
  s[PZ] = pz;
  s[VX] = vx;
  s[VY] = vy;
  s[VZ] = vz;
  return s;
}

/** Diagonal initial covariance from per-component standard deviations. */
export function diagCov(
  posStd: number,
  velStd: number,
  out: Cov6 = new Float64Array(36),
): Cov6 {
  out.fill(0);
  const pv = posStd * posStd;
  const vv = velStd * velStd;
  for (let i = 0; i < 3; i++) out[i * 6 + i] = pv;
  for (let i = 3; i < 6; i++) out[i * 6 + i] = vv;
  return out;
}

/** Trace of the 3×3 position covariance block (total positional variance). */
export function positionUncertainty(P: Cov6): number {
  return P[PX * 6 + PX] + P[PY * 6 + PY] + P[PZ * 6 + PZ];
}
