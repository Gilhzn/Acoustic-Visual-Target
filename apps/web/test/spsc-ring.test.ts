import { describe, it, expect } from "vitest";
import { SpscFloatRing } from "../src/audio/spsc-ring.js";

function makeRing(capacity: number, stride: number): SpscFloatRing {
  const buf = new SharedArrayBuffer(SpscFloatRing.byteLength(capacity, stride));
  return new SpscFloatRing(buf, capacity, stride);
}

describe("SpscFloatRing", () => {
  it("rejects non-power-of-two capacity", () => {
    expect(() => makeRing(3, 2)).toThrow();
  });

  it("push/pop preserves records in order", () => {
    const ring = makeRing(4, 2);
    expect(ring.push(Float32Array.from([1, 2]))).toBe(true);
    expect(ring.push(Float32Array.from([3, 4]))).toBe(true);
    const out = new Float32Array(2);
    expect(ring.pop(out)).toBe(true);
    expect(Array.from(out)).toEqual([1, 2]);
    expect(ring.pop(out)).toBe(true);
    expect(Array.from(out)).toEqual([3, 4]);
    expect(ring.pop(out)).toBe(false);
  });

  it("reports full and refuses overflow", () => {
    const ring = makeRing(2, 1);
    expect(ring.push(Float32Array.from([1]))).toBe(true);
    expect(ring.push(Float32Array.from([2]))).toBe(true);
    expect(ring.push(Float32Array.from([3]))).toBe(false); // full
    expect(ring.size).toBe(2);
  });

  it("popLatest drops stale records", () => {
    const ring = makeRing(4, 1);
    for (const x of [10, 20, 30]) ring.push(Float32Array.from([x]));
    const out = new Float32Array(1);
    expect(ring.popLatest(out)).toBe(true);
    expect(out[0]).toBe(30);
    expect(ring.size).toBe(0);
  });

  it("wraps around the capacity boundary", () => {
    const ring = makeRing(2, 1);
    const out = new Float32Array(1);
    for (let i = 0; i < 10; i++) {
      ring.push(Float32Array.from([i]));
      ring.pop(out);
      expect(out[0]).toBe(i);
    }
  });
});
