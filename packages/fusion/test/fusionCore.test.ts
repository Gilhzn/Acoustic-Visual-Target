import { describe, it, expect } from "vitest";
import { seconds, meters, radians } from "@avt/core-units";
import type { CameraIntrinsics, AcousticMeasurement, VisualMeasurement } from "@avt/contracts";
import { FusionCore } from "../src/fusionCore.js";

const K: CameraIntrinsics = { fx: 1000, fy: 1000, cx: 640, cy: 360, width: 1280, height: 720 };

function vis(u: number, v: number, d: number, t: number, conf = 0.9): VisualMeasurement {
  return { u, v, depthM: meters(d), confidence: conf, classLabel: "person", tSec: seconds(t), valid: true };
}
function aco(R: number, theta: number, aliases: number[], t: number): AcousticMeasurement {
  return {
    rangeM: meters(R),
    azimuthRad: radians(theta),
    aliases: aliases.map((a) => radians(a)),
    ambiguous: aliases.length > 1,
    snrDb: 20 as never,
    tSec: seconds(t),
    valid: true,
  };
}

describe("FusionCore", () => {
  it("does nothing until initialized", () => {
    const fc = new FusionCore({ intrinsics: K });
    expect(fc.initialized).toBe(false);
    expect(fc.onAcoustic(aco(3, 0, [0], 0.1))).toBeNull();
  });

  it("initializes by back-projecting a visual detection", () => {
    const fc = new FusionCore({ intrinsics: K });
    fc.initFromVisual(vis((1000 * 0.5) / 3 + 640, (1000 * 0.2) / 3 + 360, 3, 0));
    const p = fc.position();
    expect(p.x).toBeCloseTo(0.5, 6);
    expect(p.y).toBeCloseTo(0.2, 6);
    expect(p.z).toBeCloseTo(3, 6);
    expect(fc.initialized).toBe(true);
  });

  it("converges to a static target and exposes a TrackState", () => {
    const truth = { x: 0.5, y: 0.2, z: 3.0 };
    const fc = new FusionCore({ intrinsics: K });
    const u = (1000 * truth.x) / truth.z + 640;
    const v = (1000 * truth.y) / truth.z + 360;
    const R = Math.hypot(truth.x, truth.y, truth.z);
    const th = Math.atan2(truth.x, truth.z);
    fc.initFromVisual(vis(u + 30, v - 20, truth.z * 1.1, 0)); // slightly off init
    for (let k = 1; k <= 60; k++) {
      const t = k * 0.04;
      fc.onAcoustic(aco(R, th, [th], t));
      if (k % 2 === 0) fc.onVisual(vis(u, v, truth.z, t), t);
    }
    const ts = fc.toTrackState();
    expect(ts.position.x).toBeCloseTo(truth.x, 1);
    expect(ts.position.z).toBeCloseTo(truth.z, 1);
    expect(ts.classLabel).toBe("person");
    expect(ts.tracked).toBe(true);
  });

  it("disambiguates acoustic aliases toward the predicted bearing", () => {
    const truth = { x: 0.8, y: 0.0, z: 2.0 };
    const fc = new FusionCore({ intrinsics: K });
    const u = (1000 * truth.x) / truth.z + 640;
    const R = Math.hypot(truth.x, truth.y, truth.z);
    const th = Math.atan2(truth.x, truth.z); // ~0.38 rad
    fc.initFromVisual(vis(u, 360, truth.z, 0));
    // Aliases include a decoy far from the true bearing; core must pick the near one.
    for (let k = 1; k <= 40; k++) {
      const t = k * 0.04;
      fc.onAcoustic(aco(R, th, [th, th + 1.2, th - 0.9], t));
      fc.onVisual(vis(u, 360, truth.z, t), t);
    }
    expect(fc.position().x).toBeCloseTo(truth.x, 1);
  });

  it("rejects sonar beyond the max range and stays bounded", () => {
    const fc = new FusionCore({ intrinsics: K, maxRangeM: 12 });
    fc.initFromVisual(vis(700, 360, 3, 0));
    const res = fc.onAcoustic(aco(999, 0, [0], 0.1));
    expect(res).toBeNull();
    const p = fc.position();
    expect(Math.hypot(p.x, p.y, p.z)).toBeLessThanOrEqual(12.01);
  });

  it("never runs away while coasting on receding depth", () => {
    const fc = new FusionCore({ intrinsics: K, maxRangeM: 12, ekf: { sigmaA: 3 } });
    fc.initFromVisual(vis(700, 360, 3, 0));
    for (let k = 1; k <= 12; k++) {
      const t = k * 0.1;
      fc.onVisual(vis(700, 360, 3 + k * 0.6, t), t); // appears to recede fast
    }
    for (let k = 1; k <= 60; k++) fc.predictTo(2 + k * 0.5); // long coast
    const p = fc.position();
    expect(Math.hypot(p.x, p.y, p.z)).toBeLessThanOrEqual(12.01);
  });

  it("re-acquires from a fresh detection after divergence", () => {
    // Tiny divergeVar forces the post-init state to count as diverged.
    const fc = new FusionCore({ intrinsics: K, maxRangeM: 12, divergeVar: 1e-6 });
    fc.initFromVisual(vis(700, 360, 3, 0));
    expect(fc.isDiverged()).toBe(true);
    const u2 = 400;
    const z2 = 5;
    fc.onVisual(vis(u2, 360, z2, 1), 1); // should re-init here
    const expX = ((u2 - K.cx) * z2) / K.fx;
    expect(fc.position().x).toBeCloseTo(expX, 1);
    expect(fc.position().z).toBeCloseTo(z2, 1);
  });

  it("flags coasting after sustained visual misses", () => {
    const fc = new FusionCore({ intrinsics: K });
    fc.initFromVisual(vis(700, 360, 3, 0));
    for (let k = 1; k <= 8; k++) fc.onVisual(null, k * 0.04);
    expect(fc.visuallyTracked).toBe(false);
  });
});
