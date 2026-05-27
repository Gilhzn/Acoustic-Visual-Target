import { describe, it, expect } from "vitest";
import { sampleRate, hz, ampToDb } from "@avt/core-units";
import { designBandpass, designLowpass, FirFilter, frequencyResponseMag } from "../src/fir.js";

const fs = sampleRate(48000);

/** Steady-state gain of a streaming filter at a given frequency. */
function measureGain(taps: Float32Array, freqHz: number): number {
  const filt = new FirFilter(taps);
  const len = 8192;
  const w = (2 * Math.PI * freqHz) / 48000;
  const input = new Float32Array(len);
  for (let i = 0; i < len; i++) input[i] = Math.sin(w * i);
  const out = new Float32Array(len);
  filt.process(input, out);
  // Peak amplitude over the settled tail.
  let peak = 0;
  for (let i = len - 2048; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  return peak;
}

describe("designBandpass", () => {
  const taps = designBandpass(hz(17500), hz(22500), fs, 127);

  it("produces the requested number of taps and is symmetric (linear phase)", () => {
    expect(taps.length).toBe(127);
    for (let i = 0; i < 63; i++) {
      expect(taps[i]).toBeCloseTo(taps[126 - i], 6);
    }
  });

  it("passes the band center near unity gain", () => {
    const center = frequencyResponseMag(taps, 20000 / 48000);
    expect(ampToDb(center)).toBeGreaterThan(-1);
  });

  it("attenuates out-of-band frequencies", () => {
    const low = measureGain(taps, 8000);
    const high = measureGain(taps, 24000 - 1);
    expect(ampToDb(low)).toBeLessThan(-30);
    expect(ampToDb(high)).toBeLessThan(-30);
  });

  it("passes an in-band tone near unity", () => {
    const inBand = measureGain(taps, 20000);
    expect(ampToDb(inBand)).toBeGreaterThan(-2);
  });
});

describe("designLowpass", () => {
  const taps = designLowpass(hz(2700), fs, 63);

  it("has unity DC gain", () => {
    let sum = 0;
    for (let i = 0; i < taps.length; i++) sum += taps[i];
    expect(sum).toBeCloseTo(1, 4);
  });

  it("passes low frequencies and rejects high ones", () => {
    expect(ampToDb(measureGain(taps, 500))).toBeGreaterThan(-1);
    expect(ampToDb(measureGain(taps, 8000))).toBeLessThan(-30);
  });
});
