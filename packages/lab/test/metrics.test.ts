import { describe, it, expect } from "vitest";
import { euclideanError, jitterStd, convergenceTime, nisConsistency, type TrackSample } from "../src/metrics.js";

const mk = (t: number, x: number, y = 0, z = 0): TrackSample => ({ tSec: t, position: { x, y, z } });

describe("metrics", () => {
  it("euclideanError computes mean/p95/max", () => {
    const est = [mk(0, 0), mk(1, 1), mk(2, 2)];
    const truth = [mk(0, 0), mk(1, 0), mk(2, 0)];
    const s = euclideanError(est, truth);
    expect(s.mean).toBeCloseTo((0 + 1 + 2) / 3, 9);
    expect(s.max).toBeCloseTo(2, 9);
  });

  it("euclideanError honours fromSec", () => {
    const est = [mk(0, 10), mk(1, 1), mk(2, 1)];
    const truth = [mk(0, 0), mk(1, 0), mk(2, 0)];
    const s = euclideanError(est, truth, 1);
    expect(s.mean).toBeCloseTo(1, 9); // first big-error sample excluded
  });

  it("jitterStd is zero for a smooth ramp", () => {
    const est = [mk(0, 0), mk(1, 1), mk(2, 2), mk(3, 3)];
    expect(jitterStd(est)).toBeCloseTo(0, 9);
  });

  it("convergenceTime finds the first sustained sub-threshold time", () => {
    const est = [mk(0, 1), mk(1, 0.05), mk(2, 0.05)];
    const truth = [mk(0, 0), mk(1, 0), mk(2, 0)];
    expect(convergenceTime(est, truth, 0.1)).toBe(1);
  });

  it("nisConsistency reports in-bounds fraction", () => {
    const r = nisConsistency([0.5, 3, 6, 20], 0.05, 7.815);
    expect(r.inBoundsFraction).toBeCloseTo(0.75, 9);
  });
});
