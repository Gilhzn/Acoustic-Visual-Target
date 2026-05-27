import { meters, seconds } from "@avt/core-units";
import type { CameraIntrinsics, VisualMeasurement } from "@avt/contracts";
import type { Trajectory } from "./scene.js";
import type { Rng } from "./rng.js";

export interface VisualImpairments {
  /** Seconds intervals [start,end] where the target is occluded (no detection). */
  occlusionWindows?: [number, number][];
  /** Pixel position noise std. */
  pixelNoiseStd?: number;
  /** Per-frame probability of a missed detection (low light / motion blur). */
  lowLightDropoutProb?: number;
  /** Relative noise on the bounding-box height → monocular depth noise. */
  bboxHeightNoiseFrac?: number;
  /** Reported detector confidence [0,1]. */
  confidence?: number;
}

function occluded(windows: [number, number][] | undefined, t: number): boolean {
  if (!windows) return false;
  for (const [a, b] of windows) if (t >= a && t <= b) return true;
  return false;
}

/**
 * Forward visual model: project the target, derive a monocular depth from its
 * known physical height, and apply impairments. Returns null when the target is
 * occluded, dropped, behind the camera, or off-screen.
 */
export function synthDetection(
  traj: Trajectory,
  K: CameraIntrinsics,
  knownHeightM: number,
  classLabel: string,
  imp: VisualImpairments,
  tSec: number,
  rng: Rng,
): VisualMeasurement | null {
  if (occluded(imp.occlusionWindows, tSec)) return null;
  if (imp.lowLightDropoutProb && rng.next() < imp.lowLightDropoutProb) return null;

  const p = traj.posAt(tSec);
  if (p.z <= 1e-2) return null;

  const pxNoise = imp.pixelNoiseStd ?? 0;
  const u = (K.fx * p.x) / p.z + K.cx + pxNoise * rng.gaussian();
  const v = (K.fy * p.y) / p.z + K.cy + pxNoise * rng.gaussian();
  if (u < 0 || u > K.width || v < 0 || v > K.height) return null;

  const trueHeightPx = (knownHeightM * K.fy) / p.z;
  const hNoise = imp.bboxHeightNoiseFrac ?? 0;
  const noisyHeightPx = Math.max(trueHeightPx * (1 + hNoise * rng.gaussian()), 1e-3);
  const depthM = (knownHeightM * K.fy) / noisyHeightPx;

  return {
    u,
    v,
    depthM: meters(depthM),
    confidence: imp.confidence ?? 0.85,
    classLabel,
    tSec: seconds(tSec),
    valid: true,
  };
}
