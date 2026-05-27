import { describe, it, expect } from "vitest";
import { hz, sampleRate, seconds } from "@avt/core-units";
import type { AcousticMeasurement } from "@avt/contracts";
import { AcousticPipeline, chirpSamples, type ChirpSpec } from "@avt/dsp";
import { staticTrajectory, synthEcho, Rng } from "@avt/lab";
import { AcousticEngine } from "../src/audio/acoustic-engine.js";

const spec: ChirpSpec = { fStart: hz(18500), fEnd: hz(21500), durationS: 0.04, fs: sampleRate(48000) };

describe("AcousticEngine ↔ pipeline parity", () => {
  it("emits the same measurement as a direct pipeline call on the same frame", () => {
    const pipeOpts = { clutter: false, bandpass: false, micBaselineM: 0.1 };
    const traj = staticTrajectory({ x: 0.4, y: 0, z: 2.5 });
    const { mic0, mic1 } = synthEcho(traj, spec, 0.1, { attenuation: 1 }, 0, new Rng(1));

    // Reference: direct pipeline on the whole frame.
    const ref = new AcousticPipeline(spec, pipeOpts).process(mic0, mic1, seconds(0));

    // Engine: feed the same frame in 128-sample render quanta.
    const engine = new AcousticEngine(spec, { pipeline: pipeOpts });
    let emitted: AcousticMeasurement | null = null;
    engine.onMeasurement = (m) => (emitted = m);
    const n = chirpSamples(spec); // 1920 = 15 * 128
    const out = new Float32Array(128);
    for (let off = 0; off < n; off += 128) {
      engine.process(mic0.subarray(off, off + 128), mic1.subarray(off, off + 128), out);
    }

    expect(emitted).not.toBeNull();
    const m = emitted as unknown as AcousticMeasurement;
    expect(m.rangeM as number).toBeCloseTo(ref.rangeM as number, 6);
    expect(m.azimuthRad as number).toBeCloseTo(ref.azimuthRad as number, 6);
    expect(m.aliases.length).toBe(ref.aliases.length);
    expect(m.valid).toBe(ref.valid);
  });

  it("writes the transmit chirp to the output buffer scaled by txGain", () => {
    const engine = new AcousticEngine(spec, { txGain: 0.5 });
    const out = new Float32Array(128);
    const silent = new Float32Array(128);
    engine.process(silent, silent, out);
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(0.5 + 1e-6);
  });
});
