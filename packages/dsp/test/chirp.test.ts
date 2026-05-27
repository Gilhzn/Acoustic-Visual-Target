import { describe, it, expect } from "vitest";
import { hz, sampleRate, meters, SPEED_OF_SOUND_MPS } from "@avt/core-units";
import {
  chirpSamples,
  chirpBandwidthHz,
  chirpRangeResolution,
  rangeToBeat,
  beatToRange,
  synthChirp,
  type ChirpSpec,
} from "../src/chirp.js";

const spec: ChirpSpec = {
  fStart: hz(18500),
  fEnd: hz(21500),
  durationS: 0.04,
  fs: sampleRate(48000),
};

describe("chirp", () => {
  it("computes sample count and bandwidth", () => {
    expect(chirpSamples(spec)).toBe(1920);
    expect(chirpBandwidthHz(spec)).toBe(3000);
  });

  it("range resolution is c/(2B)", () => {
    const expected = (SPEED_OF_SOUND_MPS as number) / (2 * 3000);
    expect(chirpRangeResolution(spec) as number).toBeCloseTo(expected, 6);
  });

  it("range<->beat are inverse", () => {
    for (const R of [0.5, 1.0, 2.5, 5.0]) {
      const beat = rangeToBeat(meters(R), spec);
      expect(beatToRange(beat, spec) as number).toBeCloseTo(R, 6);
    }
  });

  it("synthesizes a bounded, correctly-sized real chirp", () => {
    const sig = synthChirp(spec, undefined, { amplitude: 0.8, taperFraction: 0.05 });
    expect(sig.length).toBe(1920);
    for (let i = 0; i < sig.length; i++) expect(Math.abs(sig[i])).toBeLessThanOrEqual(0.8 + 1e-6);
    // Tapered edges start near zero.
    expect(Math.abs(sig[0])).toBeLessThan(0.1);
  });
});
