import { describe, it, expect } from "vitest";
import { identity, mul, transpose, mulABt, invert, quadFormInv } from "../src/linalg.js";

describe("linalg", () => {
  it("identity", () => {
    const I = new Float64Array(9);
    identity(I, 3);
    expect(Array.from(I)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("mul: 2x3 · 3x2", () => {
    const a = new Float64Array([1, 2, 3, 4, 5, 6]); // 2×3
    const b = new Float64Array([7, 8, 9, 10, 11, 12]); // 3×2
    const out = new Float64Array(4);
    mul(a, 2, 3, b, 2, out);
    // row0: [1*7+2*9+3*11, 1*8+2*10+3*12] = [58, 64]
    // row1: [4*7+5*9+6*11, 4*8+5*10+6*12] = [139, 154]
    expect(Array.from(out)).toEqual([58, 64, 139, 154]);
  });

  it("transpose", () => {
    const a = new Float64Array([1, 2, 3, 4, 5, 6]); // 2×3
    const out = new Float64Array(6);
    transpose(a, 2, 3, out); // 3×2
    expect(Array.from(out)).toEqual([1, 4, 2, 5, 3, 6]);
  });

  it("mulABt equals mul with explicit transpose", () => {
    const a = new Float64Array([1, 2, 3, 4, 5, 6]); // 2×3
    const b = new Float64Array([1, 0, 1, 2, 1, 0]); // 2×3
    const bt = new Float64Array(6);
    transpose(b, 2, 3, bt); // 3×2
    const viaMul = new Float64Array(4);
    mul(a, 2, 3, bt, 2, viaMul);
    const viaABt = new Float64Array(4);
    mulABt(a, 2, 3, b, 2, viaABt);
    for (let i = 0; i < 4; i++) expect(viaABt[i]).toBeCloseTo(viaMul[i], 12);
  });

  it("invert: A·A⁻¹ = I for a well-conditioned matrix", () => {
    const A = new Float64Array([4, 3, 2, 1, 5, 3, 2, 1, 6]);
    const Ainv = new Float64Array(9);
    const work = new Float64Array(18);
    expect(invert(A, 3, Ainv, work)).toBe(true);
    const prod = new Float64Array(9);
    mul(A, 3, 3, Ainv, 3, prod);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(prod[i * 3 + j]).toBeCloseTo(i === j ? 1 : 0, 9);
  });

  it("invert: reports singular matrices", () => {
    const A = new Float64Array([1, 2, 2, 4]); // rank 1
    const out = new Float64Array(4);
    const work = new Float64Array(8);
    expect(invert(A, 2, out, work)).toBe(false);
  });

  it("quadFormInv computes yᵀ M⁻¹ y", () => {
    const Minv = new Float64Array([2, 0, 0, 0.5]);
    const y = new Float64Array([3, 4]);
    expect(quadFormInv(y, Minv, 2)).toBeCloseTo(2 * 9 + 0.5 * 16, 9);
  });
});
