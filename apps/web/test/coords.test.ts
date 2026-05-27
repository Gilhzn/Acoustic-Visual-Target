import { describe, it, expect } from "vitest";
import { cameraFrameToView, viewToCameraFrame, cameraFrameVelToView } from "../src/render/coords.js";

describe("coords", () => {
  it("flips y (down→up) and z (forward→−Z)", () => {
    expect(cameraFrameToView({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: -2, z: -3 });
  });
  it("round-trips", () => {
    const p = { x: 0.5, y: -0.3, z: 2.2 };
    expect(viewToCameraFrame(cameraFrameToView(p))).toEqual(p);
  });
  it("transforms velocity with the same flips", () => {
    expect(cameraFrameVelToView({ x: 1, y: 1, z: 1 })).toEqual({ x: 1, y: -1, z: -1 });
  });
});
