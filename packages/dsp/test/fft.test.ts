import { describe, it, expect } from "vitest";
import { FftPlan, naiveDft, magnitudeSpectrum } from "../src/fft.js";

function randomSignal(n: number, seed = 1): { re: Float32Array; im: Float32Array } {
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  let s = seed;
  const rng = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff - 0.5;
  };
  for (let i = 0; i < n; i++) {
    re[i] = rng();
    im[i] = rng();
  }
  return { re, im };
}

describe("FftPlan", () => {
  it("rejects non-power-of-two sizes", () => {
    expect(() => new FftPlan(100)).toThrow();
  });

  it("matches the naive DFT", () => {
    for (const n of [8, 16, 64, 256]) {
      const { re, im } = randomSignal(n, n);
      const ref = naiveDft(re, im);
      const plan = new FftPlan(n);
      const fr = re.slice();
      const fi = im.slice();
      plan.forward(fr, fi);
      for (let k = 0; k < n; k++) {
        expect(fr[k]).toBeCloseTo(ref.re[k], 3);
        expect(fi[k]).toBeCloseTo(ref.im[k], 3);
      }
    }
  });

  it("forward then inverse round-trips to the original", () => {
    const n = 512;
    const { re, im } = randomSignal(n, 7);
    const fr = re.slice();
    const fi = im.slice();
    const plan = new FftPlan(n);
    plan.forward(fr, fi);
    plan.inverse(fr, fi);
    for (let i = 0; i < n; i++) {
      expect(fr[i]).toBeCloseTo(re[i], 4);
      expect(fi[i]).toBeCloseTo(im[i], 4);
    }
  });

  it("locates a pure tone in the correct bin", () => {
    const n = 256;
    const bin = 17;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = Math.cos((2 * Math.PI * bin * i) / n);
      im[i] = Math.sin((2 * Math.PI * bin * i) / n);
    }
    new FftPlan(n).forward(re, im);
    const mag = new Float32Array(n);
    magnitudeSpectrum(re, im, mag);
    let peak = 0;
    for (let k = 1; k < n; k++) if (mag[k] > mag[peak]) peak = k;
    expect(peak).toBe(bin);
  });
});
