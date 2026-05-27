import { describe, it, expect } from "vitest";
import type { CameraIntrinsics } from "@avt/contracts";
import { makeState, type State6 } from "../src/state.js";
import { hAcoustic, jacobianAcoustic } from "../src/measAcoustic.js";
import { hVisual, jacobianVisual } from "../src/measVisual.js";

const K: CameraIntrinsics = { fx: 600, fy: 600, cx: 320, cy: 240, width: 640, height: 480 };

function numericJacobian(
  x: State6,
  m: number,
  h: (s: State6, out: Float64Array) => void,
): Float64Array {
  const J = new Float64Array(m * 6);
  const eps = 1e-6;
  const hp = new Float64Array(m);
  const hm = new Float64Array(m);
  for (let c = 0; c < 6; c++) {
    const xp = x.slice();
    const xm = x.slice();
    xp[c] += eps;
    xm[c] -= eps;
    h(xp, hp);
    h(xm, hm);
    for (let r = 0; r < m; r++) J[r * 6 + c] = (hp[r] - hm[r]) / (2 * eps);
  }
  return J;
}

describe("analytic Jacobians match finite differences", () => {
  const states: State6[] = [
    makeState(0.5, 0.3, 2.0, 0.1, -0.2, 0.3),
    makeState(-1.0, 0.8, 3.5, -0.5, 0.0, 0.1),
    makeState(1.2, -0.4, 1.5, 0.0, 0.0, 0.0),
  ];

  it("acoustic Jacobian", () => {
    for (const x of states) {
      const analytic = new Float64Array(12);
      jacobianAcoustic(x, analytic);
      const numeric = numericJacobian(x, 2, hAcoustic);
      for (let i = 0; i < 12; i++) expect(analytic[i]).toBeCloseTo(numeric[i], 5);
    }
  });

  it("visual Jacobian", () => {
    for (const x of states) {
      const analytic = new Float64Array(18);
      jacobianVisual(x, K, analytic);
      const numeric = numericJacobian(x, 3, (s, out) => hVisual(s, K, out));
      for (let i = 0; i < 18; i++) expect(analytic[i]).toBeCloseTo(numeric[i], 4);
    }
  });
});
