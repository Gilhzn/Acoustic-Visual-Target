import { describe, it, expect } from "vitest";
import { hz, sampleRate, seconds } from "@avt/core-units";
import type { CameraIntrinsics } from "@avt/contracts";
import { AcousticPipeline, type ChirpSpec } from "@avt/dsp";
import { Rng } from "../src/rng.js";
import { staticTrajectory, linearTrajectory } from "../src/scene.js";
import { synthEcho } from "../src/acousticGen.js";
import { synthDetection } from "../src/visualGen.js";

const spec: ChirpSpec = { fStart: hz(18500), fEnd: hz(21500), durationS: 0.04, fs: sampleRate(48000) };
const K: CameraIntrinsics = { fx: 1000, fy: 1000, cx: 640, cy: 360, width: 1280, height: 720 };

describe("Rng", () => {
  it("is deterministic for a fixed seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it("produces an approximately standard-normal gaussian", () => {
    const r = new Rng(7);
    let sum = 0;
    let sumSq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const g = r.gaussian();
      sum += g;
      sumSq += g * g;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(Math.abs(sumSq / n - 1)).toBeLessThan(0.05);
  });
});

describe("synthEcho", () => {
  it("produces an echo whose recovered range matches the target", () => {
    const traj = staticTrajectory({ x: 0, y: 0, z: 2.5 });
    const rng = new Rng(1);
    const { mic0, mic1 } = synthEcho(traj, spec, 0.1, { attenuation: 1 }, 0, rng);
    const p = new AcousticPipeline(spec, { clutter: false, bandpass: false });
    const m = p.process(mic0, mic1, seconds(0));
    // True range = sqrt(0+0+2.5²) = 2.5
    expect(m.valid).toBe(true);
    expect(Math.abs((m.rangeM as number) - 2.5)).toBeLessThan(p.rangeResolutionM as number);
  });
});

describe("synthDetection", () => {
  it("projects a target to the correct pixel and depth", () => {
    const traj = staticTrajectory({ x: 0.3, y: 0.1, z: 3.0 });
    const det = synthDetection(traj, K, 1.7, "person", {}, 0, new Rng(1));
    expect(det).not.toBeNull();
    expect(det!.u).toBeCloseTo((1000 * 0.3) / 3 + 640, 6);
    expect(det!.v).toBeCloseTo((1000 * 0.1) / 3 + 360, 6);
    expect(det!.depthM as number).toBeCloseTo(3.0, 6);
  });

  it("returns null during an occlusion window", () => {
    const traj = linearTrajectory({ x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 });
    const det = synthDetection(traj, K, 1.7, "person", { occlusionWindows: [[1, 2]] }, 1.5, new Rng(1));
    expect(det).toBeNull();
  });

  it("returns null when the target leaves the frame", () => {
    const traj = staticTrajectory({ x: 5, y: 0, z: 1 }); // u = 5000+640 off screen
    const det = synthDetection(traj, K, 1.7, "person", {}, 0, new Rng(1));
    expect(det).toBeNull();
  });
});
