import { describe, it, expect } from "vitest";
import { hz, sampleRate, seconds } from "@avt/core-units";
import { AcousticPipeline } from "../src/pipeline.js";
import { BreathingDetector } from "../src/breathing.js";
import { chirpSamples, chirpSweepRate, type ChirpSpec } from "../src/chirp.js";
import { SPEED_OF_SOUND_MPS } from "@avt/core-units";

const spec: ChirpSpec = { fStart: hz(18500), fEnd: hz(21500), durationS: 0.04, fs: sampleRate(48000) };
const c = SPEED_OF_SOUND_MPS as number;
const fs = spec.fs as number;
const f0 = spec.fStart as number;
const beta = chirpSweepRate(spec);

/** Echo for a target at instantaneous range R(t). */
function echoAt(rangeM: number): Float32Array {
  const n = chirpSamples(spec);
  const out = new Float32Array(n);
  const tau = (2 * rangeM) / c;
  for (let i = 0; i < n; i++) {
    const t = i / fs - tau;
    out[i] = Math.cos(2 * Math.PI * (f0 * t + 0.5 * beta * t * t));
  }
  return out;
}

describe("BreathingDetector", () => {
  it("recovers a known breathing rate from echo-phase micro-motion", () => {
    const p = new AcousticPipeline(spec, {
      clutter: false,
      bandpass: false,
      breathing: true,
      breathingWindowSec: 12,
    });
    const rateBpm = 18;
    const fBreath = rateBpm / 60; // 0.3 Hz
    const ampM = 0.004; // 4 mm chest motion
    const frameDt = 0.04; // 25 Hz
    let last = p.process(echoAt(2.0), echoAt(2.0), seconds(0));
    const frames = Math.round(16 / frameDt); // 16 s
    for (let k = 1; k <= frames; k++) {
      const t = k * frameDt;
      const R = 2.0 + ampM * Math.sin(2 * Math.PI * fBreath * t);
      const e = echoAt(R);
      last = p.process(e, e, seconds(t));
    }
    expect(last.alive).toBe(true);
    expect(last.breathingRateBpm).toBeGreaterThan(rateBpm - 3);
    expect(last.breathingRateBpm).toBeLessThan(rateBpm + 3);
  });

  it("reports no life sign for a perfectly static target", () => {
    const p = new AcousticPipeline(spec, { clutter: false, bandpass: false, breathing: true });
    const e = echoAt(2.0);
    let last = p.process(e, e, seconds(0));
    for (let k = 1; k <= 400; k++) last = p.process(e, e, seconds(k * 0.04));
    expect(last.alive).toBe(false);
  });

  it("standalone detector finds the oscillation frequency", () => {
    const det = new BreathingDetector({ frameRateHz: 25, carrierHz: 20000, windowSec: 12 });
    const fBreath = 0.25; // 15 bpm
    for (let k = 0; k < 25 * 14; k++) {
      const t = k / 25;
      const ph = 1.5 * Math.sin(2 * Math.PI * fBreath * t);
      det.push(Math.cos(ph), Math.sin(ph));
    }
    const r = det.analyze();
    expect(r.alive).toBe(true);
    expect(r.rateBpm).toBeGreaterThan(12);
    expect(r.rateBpm).toBeLessThan(18);
    expect(r.displacementMm).toBeGreaterThan(0);
  });
});
