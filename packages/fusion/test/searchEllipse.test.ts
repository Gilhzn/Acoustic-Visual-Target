import { describe, it, expect } from "vitest";
import type { CameraIntrinsics } from "@avt/contracts";
import { makeState, diagCov } from "../src/state.js";
import { projectSearchEllipse } from "../src/searchEllipse.js";

const K: CameraIntrinsics = { fx: 600, fy: 600, cx: 320, cy: 240, width: 640, height: 480 };

describe("projectSearchEllipse", () => {
  it("centers the ellipse at the projected position", () => {
    const x = makeState(0.5, 0.2, 3.0);
    const e = projectSearchEllipse(x, diagCov(0.1, 0.1), K);
    expect(e.valid).toBe(true);
    expect(e.centerU).toBeCloseTo((600 * 0.5) / 3 + 320, 6);
    expect(e.centerV).toBeCloseTo((600 * 0.2) / 3 + 240, 6);
  });

  it("grows the ellipse as positional uncertainty grows", () => {
    const x = makeState(0.5, 0.2, 3.0);
    const small = projectSearchEllipse(x, diagCov(0.1, 0.1), K);
    const large = projectSearchEllipse(x, diagCov(1.0, 0.1), K);
    expect(large.semiMajor).toBeGreaterThan(small.semiMajor);
  });

  it("is invalid for a target behind the camera", () => {
    const x = makeState(0.5, 0.2, -1.0);
    const e = projectSearchEllipse(x, diagCov(0.1, 0.1), K);
    expect(e.valid).toBe(false);
  });
});
