import { describe, it, expect } from "vitest";
import { coverFit, thermalColor, rgba } from "../src/render/visuals.js";

describe("coverFit", () => {
  it("scales to cover and centers the overflow (wider screen)", () => {
    // src 1000x1000 onto 2000x1000 → scale 2, vertical overflow centered.
    const f = coverFit(1000, 1000, 2000, 1000);
    expect(f.s).toBe(2);
    expect(f.ox).toBe(0);
    expect(f.oy).toBe(-500);
  });

  it("covers when screen is taller", () => {
    const f = coverFit(1000, 1000, 1000, 2000);
    expect(f.s).toBe(2);
    expect(f.oy).toBe(0);
    expect(f.ox).toBe(-500);
  });

  it("maps a source point to the expected screen position", () => {
    const f = coverFit(1280, 720, 1280, 720); // identity
    expect(f.s).toBe(1);
    const sx = f.ox + 640 * f.s;
    const sy = f.oy + 360 * f.s;
    expect(sx).toBe(640);
    expect(sy).toBe(360);
  });
});

describe("thermalColor", () => {
  it("is hottest (bright) near 0 and coldest (blue) near 1", () => {
    const hot = thermalColor(0);
    const cold = thermalColor(1);
    // Hot end is bright/warm: red high, blue low.
    expect(hot[0]).toBeGreaterThan(200);
    expect(hot[0]).toBeGreaterThan(hot[2]);
    // Cold end is dark blue: blue dominates red.
    expect(cold[2]).toBeGreaterThan(cold[0]);
  });

  it("clamps out-of-range input", () => {
    expect(thermalColor(-5)).toEqual(thermalColor(0));
    expect(thermalColor(5)).toEqual(thermalColor(1));
  });

  it("returns channels within 0..255", () => {
    for (let t = 0; t <= 1.0001; t += 0.1) {
      for (const ch of thermalColor(t)) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });

  it("rgba formats a css color", () => {
    expect(rgba([255, 128, 0], 0.5)).toBe("rgba(255,128,0,0.5)");
  });
});
