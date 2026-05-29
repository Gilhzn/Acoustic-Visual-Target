import { describe, it, expect } from "vitest";
import type { CameraIntrinsics, Detection } from "@avt/contracts";
import {
  MultiTracker,
  iou,
  postureFromBbox,
  activityLabel,
} from "../src/tracking/MultiTracker.js";

const K: CameraIntrinsics = { fx: 1000, fy: 1000, cx: 640, cy: 360, width: 1280, height: 720 };

const det = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  score = 0.9,
  cls = "person",
): Detection => ({ bbox: [x0, y0, x1, y1], score, classLabel: cls });

describe("iou", () => {
  it("returns 0 for disjoint boxes", () => {
    expect(iou([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
  });
  it("returns 1 for identical boxes", () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
  });
  it("computes the standard partial overlap (1/7)", () => {
    // boxes 0..10 and 5..15: inter=25, union=175, iou≈1/7
    expect(iou([0, 0, 10, 10], [5, 5, 15, 15])).toBeCloseTo(25 / 175, 6);
  });
});

describe("postureFromBbox + activityLabel", () => {
  it("classifies a tall-narrow box as standing", () => {
    expect(postureFromBbox([0, 0, 100, 400])).toBe("standing");
  });
  it("classifies a squarish box as sitting", () => {
    expect(postureFromBbox([0, 0, 100, 150])).toBe("sitting");
  });
  it("classifies a wide-short box as lying", () => {
    expect(postureFromBbox([0, 0, 300, 100])).toBe("lying");
  });
  it("returns unknown for a degenerate box", () => {
    expect(postureFromBbox([0, 0, 0, 0])).toBe("unknown");
  });
  it("maps activity score to a label", () => {
    expect(activityLabel(0.02)).toBe("still");
    expect(activityLabel(0.2)).toBe("moving");
    expect(activityLabel(0.7)).toBe("active");
  });
});

describe("MultiTracker", () => {
  it("creates a new track per unmatched detection and assigns unique IDs", () => {
    const t = new MultiTracker({ K });
    const out = t.update([det(100, 100, 200, 400), det(500, 100, 600, 400)], 0);
    expect(out.length).toBe(2);
    expect(out[0].id).not.toBe(out[1].id);
    expect(out[0].posture).toBe("standing");
  });

  it("associates a moved bbox to the same track via IoU", () => {
    const t = new MultiTracker({ K });
    const a = t.update([det(100, 100, 200, 400)], 0);
    const b = t.update([det(110, 102, 210, 402)], 0.1); // small move
    expect(b.length).toBe(1);
    expect(b[0].id).toBe(a[0].id);
    expect(b[0].activity).toBeGreaterThanOrEqual(0);
  });

  it("spawns a fresh track when IoU drops below threshold (without killing the old one)", () => {
    const t = new MultiTracker({ K, minIoU: 0.5 });
    const a = t.update([det(100, 100, 200, 400)], 0);
    const b = t.update([det(700, 100, 800, 400)], 0.1); // far away
    expect(b.length).toBe(2);
    expect(b.some((x) => x.id === a[0].id)).toBe(true);
    expect(b.some((x) => x.id !== a[0].id)).toBe(true);
  });

  it("drops a stale track after maxAgeSec without seeing it", () => {
    const t = new MultiTracker({ K, maxAgeSec: 0.5 });
    t.update([det(100, 100, 200, 400)], 0);
    const out = t.update([], 1.0); // gone for 1 s, no detections
    expect(out.length).toBe(0);
  });

  it("setName persists the name on subsequent updates", () => {
    const t = new MultiTracker({ K });
    const first = t.update([det(100, 100, 200, 400)], 0);
    t.setName(first[0].id, "Maya");
    const next = t.update([det(105, 100, 205, 400)], 0.05);
    expect(next[0].name).toBe("Maya");
  });

  it("findAtPixel returns the track whose bbox contains the point", () => {
    const t = new MultiTracker({ K });
    t.update([det(100, 100, 200, 400), det(500, 100, 600, 400)], 0);
    const hit = t.findAtPixel(150, 250);
    expect(hit).not.toBeNull();
    expect(hit!.bbox[0]).toBe(100);
  });

  it("bbox EWMA-smoothing lags the raw detection toward it without overshooting", () => {
    const t = new MultiTracker({ K, bboxAlpha: 0.5 });
    const a = t.update([det(100, 100, 200, 400)], 0);
    expect(a[0].bbox).toEqual([100, 100, 200, 400]); // first frame = raw
    const b = t.update([det(140, 100, 240, 400)], 0.1); // raw shifted right by 40 px
    // Smoothed value is between previous (100) and new raw (140).
    expect(b[0].bbox[0]).toBeGreaterThan(100);
    expect(b[0].bbox[0]).toBeLessThan(140);
    expect(b[0].bbox[0]).toBeCloseTo(120, 5); // alpha=0.5 → midpoint
  });

  it("setName with a heightM tightens the distance estimate to that height", () => {
    const t = new MultiTracker({ K });
    // Bbox 200 px tall → defaults to person height 1.7 m → depth = 1.7*1000/200 = 8.5 m.
    const first = t.update([det(640 - 50, 360 - 100, 640 + 50, 360 + 100)], 0);
    const dDefault = first[0].distanceM;
    t.setName(first[0].id, "Maya", 1.5); // shorter than 1.7 → closer
    const second = t.update([det(640 - 50, 360 - 100, 640 + 50, 360 + 100)], 0.1);
    expect(second[0].heightOverrideM).toBe(1.5);
    expect(second[0].distanceM).toBeLessThan(dDefault);
    // Sanity: with raw smoothed bbox unchanged and 1.5 m height → ~7.5 m.
    expect(second[0].distanceM).toBeCloseTo(7.5, 1);
  });

  it("primary() prefers the highest-confidence (named slightly boosted)", () => {
    const t = new MultiTracker({ K });
    const out = t.update([det(100, 100, 200, 400, 0.6), det(500, 100, 600, 400, 0.9)], 0);
    expect(t.primary()!.id).toBe(out[1].id);
    t.setName(out[0].id, "Maya");
    // Even with name boost, 0.6+0.05 < 0.9, primary unchanged.
    expect(t.primary()!.id).toBe(out[1].id);
  });
});
