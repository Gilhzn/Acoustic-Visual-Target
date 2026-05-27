import { describe, it, expect } from "vitest";
import type { CameraIntrinsics } from "@avt/contracts";
import { Ekf } from "../src/ekf.js";
import { makeState, diagCov } from "../src/state.js";

const K: CameraIntrinsics = { fx: 600, fy: 600, cx: 320, cy: 240, width: 640, height: 480 };

function trueAcoustic(p: { x: number; y: number; z: number }) {
  return {
    R: Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z),
    theta: Math.atan2(p.x, p.z),
  };
}
function trueVisual(p: { x: number; y: number; z: number }) {
  return { u: (K.fx * p.x) / p.z + K.cx, v: (K.fy * p.y) / p.z + K.cy, d: p.z };
}

/** Deterministic Gaussian via Box-Muller with a seeded LCG. */
function gaussianRng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 1) / 4294967297;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

describe("Ekf prediction", () => {
  it("propagates constant velocity", () => {
    const ekf = new Ekf(makeState(0, 0, 0, 1, 2, 3), diagCov(1, 1));
    ekf.predictTo(2.0);
    const p = ekf.position();
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.y).toBeCloseTo(4, 9);
    expect(p.z).toBeCloseTo(6, 9);
    const v = ekf.velocity();
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
  });

  it("ignores backward time steps", () => {
    const ekf = new Ekf(makeState(0, 0, 1, 1, 0, 0), diagCov(1, 1));
    ekf.predictTo(1.0);
    const before = ekf.position().x;
    ekf.predictTo(0.5); // earlier — should not move
    expect(ekf.position().x).toBeCloseTo(before, 9);
  });
});

describe("Ekf correction", () => {
  it("converges to a static target from exact measurements", () => {
    const truth = { x: 0.5, y: 0.2, z: 3.0 };
    const ekf = new Ekf(makeState(0, 0, 2.5), diagCov(2, 1));
    const u0 = ekf.positionUncertainty;
    const a = trueAcoustic(truth);
    const vis = trueVisual(truth);
    for (let k = 1; k <= 60; k++) {
      ekf.predictTo(k * 0.04);
      ekf.updateAcoustic(a.R, a.theta);
      ekf.updateVisual(vis.u, vis.v, vis.d, K);
    }
    const p = ekf.position();
    expect(p.x).toBeCloseTo(truth.x, 2);
    expect(p.y).toBeCloseTo(truth.y, 2);
    expect(p.z).toBeCloseTo(truth.z, 2);
    expect(ekf.positionUncertainty).toBeLessThan(u0);
  });

  it("rejects a gross outlier via NIS gating", () => {
    const truth = { x: 0.5, y: 0.2, z: 3.0 };
    const ekf = new Ekf(makeState(0.5, 0.2, 3.0), diagCov(0.1, 0.1));
    const a = trueAcoustic(truth);
    const vis = trueVisual(truth);
    for (let k = 1; k <= 40; k++) {
      ekf.predictTo(k * 0.04);
      ekf.updateAcoustic(a.R, a.theta);
      ekf.updateVisual(vis.u, vis.v, vis.d, K);
    }
    // A range 5 m off should be gated out once the filter is confident.
    const res = ekf.updateAcoustic(a.R + 5, a.theta);
    expect(res.accepted).toBe(false);
  });

  it("tracks a constant-velocity trajectory under noise to < 15 cm mean error", () => {
    const p0 = { x: 0.5, y: 0.2, z: 3.0 };
    const vel = { x: 0.3, y: 0.0, z: -0.2 };
    const ekf = new Ekf(makeState(0, 0, 2.5), diagCov(2, 1), { sigmaA: 0.5 });
    const g = gaussianRng(12345);
    const errors: number[] = [];
    const dt = 0.04;
    for (let k = 1; k <= 100; k++) {
      const t = k * dt;
      const p = { x: p0.x + vel.x * t, y: p0.y + vel.y * t, z: p0.z + vel.z * t };
      ekf.predictTo(t);
      const a = trueAcoustic(p);
      ekf.updateAcoustic(a.R + 0.05 * g(), a.theta + 0.02 * g());
      if (k % 2 === 0) {
        const vis = trueVisual(p);
        ekf.updateVisual(vis.u + 6 * g(), vis.v + 6 * g(), vis.d * (1 + 0.05 * g()), K);
      }
      const est = ekf.position();
      errors.push(Math.hypot(est.x - p.x, est.y - p.y, est.z - p.z));
    }
    const tail = errors.slice(50);
    const mean = tail.reduce((s, e) => s + e, 0) / tail.length;
    expect(mean).toBeLessThan(0.15);
  });
});
