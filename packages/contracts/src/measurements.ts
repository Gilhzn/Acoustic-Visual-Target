import type { Meters, Radians, Seconds, Decibels } from "@avt/core-units";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Pinhole camera intrinsics (pixels). u = fx·X/Z + cx, v = fy·Y/Z + cy,
 * with Z the optical-axis depth in the camera frame.
 */
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * One acoustic observation from the FMCW pipeline.
 *
 * Azimuth from dual-mic PDoA is fundamentally ambiguous at near-ultrasonic
 * wavelengths (λ≈1.7cm vs a ~10cm baseline), so we expose every phase-aliased
 * solution. `azimuthRad` is the principal value; `aliases` lists all candidates
 * (including the principal one). Fusion picks the alias nearest the camera bearing.
 */
export interface AcousticMeasurement {
  rangeM: Meters;
  azimuthRad: Radians;
  aliases: Radians[];
  ambiguous: boolean;
  snrDb: Decibels;
  tSec: Seconds;
  valid: boolean;
  /** Breaths/min from echo-phase micro-motion (optional; 0 if undetected). */
  breathingRateBpm?: number;
  /** Confidence of the breathing oscillation (dB). */
  lifeSnrDb?: number;
  /** True when a living, breathing body is detected acoustically. */
  alive?: boolean;
}

/**
 * One visual observation: bounding-box centroid in pixels plus monocular
 * depth derived from a known physical object size.
 */
export interface VisualMeasurement {
  u: number;
  v: number;
  depthM: Meters;
  confidence: number;
  classLabel: string;
  tSec: Seconds;
  valid: boolean;
}

/** Raw object-detector output, before projection into a measurement. */
export interface Detection {
  /** [xMin, yMin, xMax, yMax] in pixels. */
  bbox: [number, number, number, number];
  score: number;
  classLabel: string;
}

/** Average real-world heights (m) used for monocular depth-from-size. */
export const KNOWN_OBJECT_HEIGHTS_M: Readonly<Record<string, number>> = {
  person: 1.7,
  cat: 0.25,
  dog: 0.5,
  default: 1.0,
};
