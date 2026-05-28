import { describe, it, expect } from "vitest";
import { panelProject } from "../src/render/Minimap.js";

describe("Minimap.panelProject", () => {
  const panelW = 168;
  const panelH = 168;
  const maxRange = 12;

  it("places the phone (0,0) at the bottom center of the panel", () => {
    const p = panelProject(0, 0, panelW, panelH, maxRange);
    expect(p.px).toBe(panelW / 2);
    expect(p.py).toBe(panelH - 16);
  });

  it("places a target directly forward (+Z) above the phone", () => {
    const p = panelProject(0, 6, panelW, panelH, maxRange);
    const expected = panelH - 16 - 6 * ((panelH - 24) / maxRange);
    expect(p.px).toBe(panelW / 2);
    expect(p.py).toBeCloseTo(expected, 5);
  });

  it("places +X (right of phone) to the right of center", () => {
    const p = panelProject(1, 4, panelW, panelH, maxRange);
    expect(p.px).toBeGreaterThan(panelW / 2);
  });
});
