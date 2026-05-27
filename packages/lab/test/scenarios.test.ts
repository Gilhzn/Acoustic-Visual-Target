import { describe, it, expect } from "vitest";
import { runReplay } from "../src/replay.js";
import { euclideanError, jitterStd, type TrackSample } from "../src/metrics.js";
import { SCENARIOS, SCENARIO_NAMES } from "../src/scenarios/index.js";

const FROM_FRAC = 0.4; // ignore the convergence transient

describe("Synthetic Signal Lab — scenario QA matrix", () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name}: mean error within spec`, () => {
      const scn = SCENARIOS[name];
      const r = runReplay(scn, 1);
      const from = scn.durationS * FROM_FRAC;
      const err = euclideanError(r.estimates, r.truth, from);
      expect(err.mean).toBeLessThan(scn.expect.meanErrorM);
      if (scn.expect.jitterStdM !== undefined) {
        expect(jitterStd(r.estimates, from)).toBeLessThan(scn.expect.jitterStdM);
      }
    });
  }

  it("is bit-for-bit deterministic for a fixed seed", () => {
    const a = runReplay(SCENARIOS.ideal, 99);
    const b = runReplay(SCENARIOS.ideal, 99);
    expect(a.estimates).toEqual(b.estimates);
  });

  it("remains accurate across different seeds", () => {
    for (const seed of [2, 3, 4]) {
      const r = runReplay(SCENARIOS.noisy, seed);
      const err = euclideanError(r.estimates, r.truth, SCENARIOS.noisy.durationS * FROM_FRAC);
      expect(err.mean).toBeLessThan(SCENARIOS.noisy.expect.meanErrorM);
    }
  });

  it("occlusion: EKF coasts through the blackout and re-acquires", () => {
    const scn = SCENARIOS.occlusion;
    const r = runReplay(scn, 1);
    const inWindow = (s: TrackSample) => s.tSec >= 1.5 && s.tSec <= 2.5;
    const afterWindow = (s: TrackSample) => s.tSec > 2.6;

    const duringEst = r.estimates.filter(inWindow);
    const duringTruth = r.truth.filter(inWindow);
    const afterEst = r.estimates.filter(afterWindow);
    const afterTruth = r.truth.filter(afterWindow);

    expect(r.visualMissed).toBeGreaterThan(0); // occlusion actually dropped frames
    // Error stays bounded while visually blind (sonar coasts).
    expect(euclideanError(duringEst, duringTruth).max).toBeLessThan(0.3);
    // After re-acquisition the error is back to normal tracking levels.
    expect(euclideanError(afterEst, afterTruth).mean).toBeLessThan(0.1);
  });

  it("lowLight: tracking survives despite mass visual dropout", () => {
    const scn = SCENARIOS.lowLight;
    const r = runReplay(scn, 1);
    expect(r.visualMissed).toBeGreaterThan(r.visualAccepted); // most vision lost
    const err = euclideanError(r.estimates, r.truth, scn.durationS * FROM_FRAC);
    expect(err.mean).toBeLessThan(scn.expect.meanErrorM);
  });
});
