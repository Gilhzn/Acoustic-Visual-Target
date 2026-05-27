import { describe, it, expect } from "vitest";
import { hz, sampleRate, seconds, SPEED_OF_SOUND_MPS } from "@avt/core-units";
import { AcousticPipeline } from "../src/pipeline.js";
import { chirpSamples, chirpSweepRate, type ChirpSpec } from "../src/chirp.js";

const spec: ChirpSpec = {
  fStart: hz(18500),
  fEnd: hz(21500),
  durationS: 0.04,
  fs: sampleRate(48000),
};

const c = SPEED_OF_SOUND_MPS as number;
const fs = spec.fs as number;
const f0 = spec.fStart as number;
const beta = chirpSweepRate(spec);

/** Synthetic delayed echo: rx[i] = amp·cos(φ(t_i − τ)) + noise. */
function generateEcho(rangeM: number, amp = 1, noiseStd = 0, seed = 1): Float32Array {
  const n = chirpSamples(spec);
  const out = new Float32Array(n);
  const tau = (2 * rangeM) / c;
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const t = i / fs - tau;
    const phase = 2 * Math.PI * (f0 * t + 0.5 * beta * t * t);
    out[i] = amp * Math.cos(phase) + (noiseStd > 0 ? noiseStd * (rng() + rng()) : 0);
  }
  return out;
}

describe("AcousticPipeline range recovery", () => {
  it("reports the configured resolution and max range", () => {
    const p = new AcousticPipeline(spec, { clutter: false, bandpass: false });
    expect(p.rangeResolutionM as number).toBeCloseTo(c / 6000, 6);
    expect(p.maxRangeM as number).toBeGreaterThan(6);
  });

  it("recovers a clean target range within one resolution cell", () => {
    const p = new AcousticPipeline(spec, { clutter: false, bandpass: false });
    const res = p.rangeResolutionM as number;
    for (const R of [0.5, 1.0, 2.0, 3.5, 5.0]) {
      const echo = generateEcho(R, 1);
      const m = p.process(echo, echo, seconds(0));
      expect(m.valid).toBe(true);
      expect(Math.abs((m.rangeM as number) - R)).toBeLessThan(res);
    }
  });

  it("recovers range with the band-pass front-end enabled", () => {
    const p = new AcousticPipeline(spec, { clutter: false, bandpass: true });
    const res = p.rangeResolutionM as number;
    const echo = generateEcho(2.5, 1);
    const m = p.process(echo, echo, seconds(0));
    expect(m.valid).toBe(true);
    expect(Math.abs((m.rangeM as number) - 2.5)).toBeLessThan(res);
  });

  it("stays robust under additive noise", () => {
    const p = new AcousticPipeline(spec, { clutter: false, bandpass: true });
    const res = p.rangeResolutionM as number;
    const echo = generateEcho(2.0, 1, 0.3, 42);
    const m = p.process(echo, echo, seconds(0));
    expect(m.valid).toBe(true);
    expect(Math.abs((m.rangeM as number) - 2.0)).toBeLessThan(2 * res);
  });

  it("flags azimuth as ambiguous at a 10cm near-ultrasonic baseline", () => {
    const p = new AcousticPipeline(spec, { clutter: false, bandpass: false, micBaselineM: 0.1 });
    const echo = generateEcho(2.0, 1);
    const m = p.process(echo, echo, seconds(0));
    expect(m.ambiguous).toBe(true);
    expect(m.aliases.length).toBeGreaterThan(1);
  });

  it("rejects a static target via clutter cancellation but keeps a moving one", () => {
    const p = new AcousticPipeline(spec, { clutter: true, bandpass: false });
    // Feed the same static echo repeatedly: EWMA learns it as background.
    const stat = generateEcho(2.0, 1);
    let last = p.process(stat, stat, seconds(0));
    for (let k = 0; k < 40; k++) last = p.process(stat, stat, seconds(k * 0.04));
    const staticSnr = last.snrDb as number;

    // A target that jumps to a new range produces a fresh strong return.
    const moved = generateEcho(3.5, 1);
    const movedM = p.process(moved, moved, seconds(2));
    expect(movedM.snrDb as number).toBeGreaterThan(staticSnr);
  });
});
