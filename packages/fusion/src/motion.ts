import type { Mat } from "./linalg.js";
import { PX, PY, PZ, VX, VY, VZ, type State6, type Cov6 } from "./state.js";

/** Build the constant-velocity state-transition matrix F(dt) into `out` (6×6). */
export function buildF(dt: number, out: Mat): Mat {
  out.fill(0);
  for (let i = 0; i < 6; i++) out[i * 6 + i] = 1;
  out[PX * 6 + VX] = dt;
  out[PY * 6 + VY] = dt;
  out[PZ * 6 + VZ] = dt;
  return out;
}

/** Apply constant-velocity propagation x' = F·x directly (no matrix build). */
export function predictState(x: State6, dt: number, out: State6): State6 {
  out[PX] = x[PX] + x[VX] * dt;
  out[PY] = x[PY] + x[VY] * dt;
  out[PZ] = x[PZ] + x[VZ] * dt;
  out[VX] = x[VX];
  out[VY] = x[VY];
  out[VZ] = x[VZ];
  return out;
}

/**
 * Discrete white-noise-acceleration process covariance Q(dt) for the CV model,
 * applied independently per axis:
 *   [[dt⁴/4, dt³/2], [dt³/2, dt²]] · σ_a²
 * where σ_a is the acceleration std (tuned to target dynamics).
 */
export function processNoiseQ(dt: number, sigmaA: number, out: Cov6): Cov6 {
  out.fill(0);
  const q = sigmaA * sigmaA;
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  const dt4 = dt2 * dt2;
  const qpp = (q * dt4) / 4;
  const qpv = (q * dt3) / 2;
  const qvv = q * dt2;
  const pos = [PX, PY, PZ];
  const vel = [VX, VY, VZ];
  for (let a = 0; a < 3; a++) {
    const p = pos[a];
    const v = vel[a];
    out[p * 6 + p] = qpp;
    out[p * 6 + v] = qpv;
    out[v * 6 + p] = qpv;
    out[v * 6 + v] = qvv;
  }
  return out;
}
