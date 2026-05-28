import { describe, it, expect } from "vitest";
import { deriveState } from "../src/tracking/behaviorState.js";
import type { PersonHistorySample } from "../src/tracking/PersonRegistry.js";

const sample = (tSec: number, activity: number, breathingBpm?: number, posture = "standing"): PersonHistorySample => ({
  tSec,
  x: 0,
  z: 0,
  distanceM: 0,
  azimuthDeg: 0,
  posture,
  activity,
  breathingBpm,
});

describe("deriveState", () => {
  it("returns 'unknown' for an empty history", () => {
    const r = deriveState([]);
    expect(r.state).toBe("unknown");
    expect(r.sampleCount).toBe(0);
  });

  it("is 'calm' under low activity with breathing present", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i * 0.1, 0.02, 14));
    const r = deriveState(samples);
    expect(r.state).toBe("calm");
    expect(r.breathingBpm).toBeCloseTo(14, 5);
  });

  it("is 'still' under low activity without breathing", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i * 0.1, 0.02));
    expect(deriveState(samples).state).toBe("still");
  });

  it("is 'engaged' under moderate activity", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i * 0.1, 0.2));
    expect(deriveState(samples).state).toBe("engaged");
  });

  it("is 'restless' under high activity", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i * 0.1, 0.7));
    expect(deriveState(samples).state).toBe("restless");
  });

  it("uses only samples inside the window", () => {
    const samples = [
      sample(0, 0.9), // outside the 10s window relative to the last sample
      ...Array.from({ length: 20 }, (_, i) => sample(20 + i * 0.1, 0.02)),
    ];
    const r = deriveState(samples, 10);
    expect(r.state).toBe("still");
    expect(r.sampleCount).toBeLessThan(samples.length);
  });

  it("reports the modal posture in the recent window", () => {
    const samples: PersonHistorySample[] = [
      sample(0, 0.1, undefined, "standing"),
      sample(0.1, 0.1, undefined, "sitting"),
      sample(0.2, 0.1, undefined, "sitting"),
      sample(0.3, 0.1, undefined, "sitting"),
    ];
    expect(deriveState(samples).postureMode).toBe("sitting");
  });
});
