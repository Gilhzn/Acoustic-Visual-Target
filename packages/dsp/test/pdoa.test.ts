import { describe, it, expect } from "vitest";
import { meters, radians, wavelength, hz, TWO_PI } from "@avt/core-units";
import { phaseDiff, pdoaToAzimuth, disambiguate } from "../src/pdoa.js";

describe("phaseDiff", () => {
  it("recovers a known phase offset between two phasors", () => {
    const phi = 0.7;
    const d = phaseDiff(1, 0, Math.cos(phi), Math.sin(phi));
    expect(d as number).toBeCloseTo(phi, 6);
  });

  it("wraps to (-pi, pi]", () => {
    const d = phaseDiff(1, 0, Math.cos(3.0), Math.sin(3.0));
    expect(Math.abs(d as number)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});

describe("pdoaToAzimuth", () => {
  it("is unambiguous when baseline <= lambda/2", () => {
    const lambda = wavelength(hz(20000)); // ~1.7cm
    const baseline = meters((lambda as number) / 2);
    const sol = pdoaToAzimuth(radians(0.5), baseline, lambda);
    expect(sol.ambiguous).toBe(false);
    expect(sol.aliases.length).toBe(1);
  });

  it("enumerates many aliases for a large near-ultrasonic baseline", () => {
    const lambda = wavelength(hz(20000));
    const baseline = meters(0.1); // ~5.8 lambda -> highly ambiguous
    const sol = pdoaToAzimuth(radians(0.3), baseline, lambda);
    expect(sol.ambiguous).toBe(true);
    expect(sol.aliases.length).toBeGreaterThan(5);
    for (const a of sol.aliases) {
      expect(Math.abs(a as number)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
    }
  });

  it("recovers the true azimuth as one alias given the matching phase", () => {
    const lambda = wavelength(hz(20000));
    const d = meters(0.1);
    const trueTheta = 0.2; // rad
    // Forward model: dPhi = (2π/λ)·d·sinθ, then wrapped.
    let dphi = (TWO_PI * (d as number) * Math.sin(trueTheta)) / (lambda as number);
    dphi = Math.atan2(Math.sin(dphi), Math.cos(dphi)); // wrap
    const sol = pdoaToAzimuth(radians(dphi), d, lambda);
    const matched = sol.aliases.some((a) => Math.abs((a as number) - trueTheta) < 1e-3);
    expect(matched).toBe(true);
  });

  it("disambiguate picks the alias nearest a reference bearing", () => {
    const aliases = [radians(-1.2), radians(0.18), radians(1.0)];
    const picked = disambiguate(aliases, 0.2);
    expect(picked as number).toBeCloseTo(0.18, 6);
  });
});
