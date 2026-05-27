import type { Vec3 } from "@avt/contracts";

/**
 * Map the EKF camera frame (x right, y down, z forward — CV convention) to the
 * Three.js / WebXR view frame (x right, y up, camera looking down −Z). The
 * target mesh is parented to the camera, so these view-space coordinates place
 * it correctly relative to the device pose.
 */
export function cameraFrameToView(p: Vec3): Vec3 {
  return { x: p.x, y: -p.y, z: -p.z };
}

/** Inverse of cameraFrameToView. */
export function viewToCameraFrame(p: Vec3): Vec3 {
  return { x: p.x, y: -p.y, z: -p.z };
}

/** Velocities transform with the same axis flips. */
export function cameraFrameVelToView(v: Vec3): Vec3 {
  return { x: v.x, y: -v.y, z: -v.z };
}
