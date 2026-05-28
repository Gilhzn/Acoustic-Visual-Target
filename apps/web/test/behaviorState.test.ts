import { describe, it, expect } from "vitest";
import { deriveBreathingPattern, deriveState } from "../src/tracking/behaviorState.js";
import type { PersonHistorySample } from "../src/tracking/PersonRegistry.js";

interface S {
  tSec: number;
  activity: number;
  breathingBpm?: number;
  posture?: string;
  distanceM?: number;
  azimuthDeg?: number;
}
const sample = (o: S): PersonHistorySample => ({
  tSec: o.tSec,
  x: 0,
  z: 0,
  distanceM: o.distanceM ?? 2,
  azimuthDeg: o.azimuthDeg ?? 0,
  posture: o.posture ?? "standing",
  activity: o.activity,
  breathingBpm: o.breathingBpm,
});

describe("deriveState", () => {
  it("returns 'unknown' for an empty history", () => {
    const r = deriveState([]);
    expect(r.state).toBe("unknown");
    expect(r.sampleCount).toBe(0);
  });

  it("is 'calm' under low activity with breathing present", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample({ tSec: i * 0.1, activity: 0.02, breathingBpm: 14 }));
    const r = deriveState(samples);
    expect(r.state).toBe("calm");
    expect(r.breathingBpm).toBeCloseTo(14, 5);
  });

  it("is 'still' under low activity without breathing", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample({ tSec: i * 0.1, activity: 0.02 }));
    expect(deriveState(samples).state).toBe("still");
  });

  it("is 'engaged' under moderate activity", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample({ tSec: i * 0.1, activity: 0.2 }));
    expect(deriveState(samples).state).toBe("engaged");
  });

  it("is 'restless' under high activity", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample({ tSec: i * 0.1, activity: 0.7 }));
    expect(deriveState(samples).state).toBe("restless");
  });

  it("uses only samples inside the window", () => {
    const samples = [
      sample({ tSec: 0, activity: 0.9 }), // outside the 10 s window
      ...Array.from({ length: 20 }, (_, i) => sample({ tSec: 20 + i * 0.1, activity: 0.02 })),
    ];
    const r = deriveState(samples, 10);
    expect(r.state).toBe("still");
    expect(r.sampleCount).toBeLessThan(samples.length);
  });

  it("reports the modal posture in the recent window", () => {
    const samples: PersonHistorySample[] = [
      sample({ tSec: 0, activity: 0.1, posture: "standing" }),
      sample({ tSec: 0.1, activity: 0.1, posture: "sitting" }),
      sample({ tSec: 0.2, activity: 0.1, posture: "sitting" }),
      sample({ tSec: 0.3, activity: 0.1, posture: "sitting" }),
    ];
    expect(deriveState(samples).postureMode).toBe("sitting");
  });

  it("counts posture transitions", () => {
    const samples: PersonHistorySample[] = [
      sample({ tSec: 0, activity: 0.1, posture: "standing" }),
      sample({ tSec: 0.1, activity: 0.1, posture: "sitting" }),
      sample({ tSec: 0.2, activity: 0.1, posture: "standing" }),
      sample({ tSec: 0.3, activity: 0.1, posture: "standing" }),
    ];
    expect(deriveState(samples).postureChanges).toBe(2);
  });

  it("computes centeredFraction, mean/min distance, and activity peaks", () => {
    const samples: PersonHistorySample[] = [
      sample({ tSec: 0, activity: 0.5, distanceM: 3, azimuthDeg: 5 }),
      sample({ tSec: 0.1, activity: 0.1, distanceM: 2, azimuthDeg: 30 }),
      sample({ tSec: 0.2, activity: 0.6, distanceM: 1.5, azimuthDeg: -3 }),
      sample({ tSec: 0.3, activity: 0.1, distanceM: 4, azimuthDeg: 20 }),
    ];
    const r = deriveState(samples);
    expect(r.minDistance).toBe(1.5);
    expect(r.meanDistance).toBeCloseTo((3 + 2 + 1.5 + 4) / 4, 5);
    expect(r.centeredFraction).toBeCloseTo(2 / 4, 5);
    expect(r.activityPeaks).toBe(2);
  });

  it("classifies breathing pattern as regular, fast, slow, or irregular", () => {
    expect(deriveBreathingPattern([14, 15, 14, 15, 14]).pattern).toBe("regular");
    expect(deriveBreathingPattern([26, 28, 27, 25, 29]).pattern).toBe("fast");
    expect(deriveBreathingPattern([7, 8, 7, 8, 7]).pattern).toBe("slow");
    expect(deriveBreathingPattern([12, 22, 13, 25, 14]).pattern).toBe("irregular");
    expect(deriveBreathingPattern([15]).pattern).toBe("none");
  });

  it("only fires 'agitated' when high activity AND abnormal breathing coincide", () => {
    const agitated = Array.from({ length: 12 }, (_, i) =>
      sample({ tSec: i * 0.2, activity: 0.6, breathingBpm: i % 2 ? 14 : 24 }),
    );
    expect(deriveState(agitated).state).toBe("agitated");

    const restless = Array.from({ length: 12 }, (_, i) =>
      sample({ tSec: i * 0.2, activity: 0.6, breathingBpm: 16 }),
    );
    expect(deriveState(restless).state).toBe("restless");
  });
});
