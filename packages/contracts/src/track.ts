import type { Seconds } from "@avt/core-units";
import type { Vec3 } from "./measurements.js";

/**
 * A fused pose snapshot produced by the EKF and consumed by the render layer.
 * Written by the fusion worker, read by the WebGL animation loop (via a ring
 * buffer / shared refs — never through React state).
 */
export interface TrackState {
  tSec: Seconds;
  position: Vec3;
  velocity: Vec3;
  /** Trace of the position covariance — overall positional uncertainty (m²). */
  posUncertainty: number;
  /** True while the target is being tracked (not lost). */
  tracked: boolean;
  classLabel: string;
}

/**
 * Number of float32 slots per TrackState row in the SharedArrayBuffer ring.
 * Layout: [tSec, px,py,pz, vx,vy,vz, posUnc, tracked]  (classLabel is sent
 * out-of-band; the hot ring carries only numerics).
 */
export const TRACK_RING_STRIDE = 9;
