import gsap from "gsap";
import type { Object3D } from "three";
import type { Vec3 } from "@avt/contracts";

/**
 * Smoothly tween an object's position toward the latest fused coordinate. GSAP
 * filters high-frequency sensor jitter; `overwrite: "auto"` retargets the live
 * tween instead of stacking them. Duration matches the sensor update window.
 */
export function tweenPosition(obj: Object3D, target: Vec3, duration = 0.08): void {
  gsap.to(obj.position, {
    x: target.x,
    y: target.y,
    z: target.z,
    duration,
    ease: "power2.out",
    overwrite: "auto",
  });
}

export function killTweens(obj: Object3D): void {
  gsap.killTweensOf(obj.position);
}
