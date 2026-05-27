import type { Vec3 } from "@avt/contracts";

/** Analytic ground-truth target trajectory in the camera frame (z forward). */
export interface Trajectory {
  posAt(tSec: number): Vec3;
}

export function staticTrajectory(p: Vec3): Trajectory {
  return { posAt: () => ({ ...p }) };
}

export function linearTrajectory(p0: Vec3, v: Vec3): Trajectory {
  return {
    posAt: (t) => ({ x: p0.x + v.x * t, y: p0.y + v.y * t, z: p0.z + v.z * t }),
  };
}

/** Circular orbit in the x–z plane (constant depth band), useful for azimuth sweeps. */
export function orbitTrajectory(
  center: Vec3,
  radius: number,
  omega: number,
  phase0 = 0,
): Trajectory {
  return {
    posAt: (t) => ({
      x: center.x + radius * Math.cos(omega * t + phase0),
      y: center.y,
      z: center.z + radius * Math.sin(omega * t + phase0),
    }),
  };
}

export function euclidean(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
