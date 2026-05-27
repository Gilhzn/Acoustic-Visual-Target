import { wrapAngle } from "@avt/core-units";
import type { CameraIntrinsics, Vec3 } from "@avt/contracts";
import {
  STATE_DIM,
  PX,
  PY,
  PZ,
  VX,
  VY,
  VZ,
  positionUncertainty,
  type State6,
  type Cov6,
} from "./state.js";
import { buildF, predictState, processNoiseQ } from "./motion.js";
import { hAcoustic, jacobianAcoustic, buildRAcoustic } from "./measAcoustic.js";
import { hVisual, jacobianVisual, buildRVisual } from "./measVisual.js";
import { chiSquareGate } from "./gating.js";
import { add, invert, mul, mulABt, quadFormInv, type Mat } from "./linalg.js";

export interface EkfOptions {
  /** Process-noise acceleration std (m/s²). */
  sigmaA: number;
  /** Acoustic range measurement std (m). */
  sigmaRangeM: number;
  /** Acoustic azimuth measurement std (rad) — kept large (coarse cue). */
  sigmaAzimuthRad: number;
  /** Visual pixel measurement std (px). */
  sigmaPixel: number;
  /** Visual depth relative std (depth variance = (relDepthStd·d²)²). */
  relDepthStd: number;
  /** Gate confidence for NIS rejection (e.g. 0.95). */
  gateConfidence: number;
}

export const DEFAULT_EKF_OPTIONS: EkfOptions = {
  sigmaA: 1.5,
  sigmaRangeM: 0.06,
  sigmaAzimuthRad: 0.35,
  sigmaPixel: 6,
  relDepthStd: 0.08,
  gateConfidence: 0.95,
};

export interface UpdateResult {
  accepted: boolean;
  nis: number;
}

/**
 * Extended Kalman Filter for 3D constant-velocity target tracking, fusing
 * asynchronous acoustic (R, θ) and visual (u, v, d) measurements. Each sensor
 * predicts to its own timestamp, then applies a gated, Joseph-form update. All
 * working matrices are preallocated.
 */
export class Ekf {
  private readonly x: State6;
  private readonly P: Cov6;
  private tSec: number;
  private readonly opt: EkfOptions;

  // Prediction scratch.
  private readonly F = new Float64Array(36);
  private readonly FP = new Float64Array(36);
  private readonly tmpA = new Float64Array(36);
  private readonly Q = new Float64Array(36);
  private readonly xPred = new Float64Array(6);

  // Update scratch (sized for max measurement dim m=3).
  private readonly H = new Float64Array(3 * 6);
  private readonly Rm = new Float64Array(9);
  private readonly PHt = new Float64Array(6 * 3);
  private readonly HPHt = new Float64Array(9);
  private readonly S = new Float64Array(9);
  private readonly Sinv = new Float64Array(9);
  private readonly invWork = new Float64Array(2 * 9);
  private readonly K = new Float64Array(6 * 3);
  private readonly KH = new Float64Array(36);
  private readonly A = new Float64Array(36);
  private readonly AP = new Float64Array(36);
  private readonly KR = new Float64Array(6 * 3);
  private readonly KRKt = new Float64Array(36);
  private readonly hbuf = new Float64Array(3);
  private readonly y = new Float64Array(3);

  constructor(x0: State6, P0: Cov6, opt: Partial<EkfOptions> = {}, t0 = 0) {
    this.x = x0.slice();
    this.P = P0.slice();
    this.tSec = t0;
    this.opt = { ...DEFAULT_EKF_OPTIONS, ...opt };
  }

  get state(): Readonly<State6> {
    return this.x;
  }
  get cov(): Readonly<Cov6> {
    return this.P;
  }
  get time(): number {
    return this.tSec;
  }
  get positionUncertainty(): number {
    return positionUncertainty(this.P);
  }
  position(): Vec3 {
    return { x: this.x[PX], y: this.x[PY], z: this.x[PZ] };
  }
  velocity(): Vec3 {
    return { x: this.x[VX], y: this.x[VY], z: this.x[VZ] };
  }

  /**
   * Clamp the estimate to physically sane bounds: keep the target in front of
   * the camera, cap range and speed. Prevents the filter from running away
   * during coasting on noisy monocular depth.
   */
  clampState(maxRangeM: number, maxSpeed: number): void {
    if (this.x[PZ] < 0.1) this.x[PZ] = 0.1;
    const r = Math.sqrt(this.x[PX] ** 2 + this.x[PY] ** 2 + this.x[PZ] ** 2);
    if (r > maxRangeM && r > 1e-6) {
      const k = maxRangeM / r;
      this.x[PX] *= k;
      this.x[PY] *= k;
      this.x[PZ] *= k;
    }
    const sp = Math.sqrt(this.x[VX] ** 2 + this.x[VY] ** 2 + this.x[VZ] ** 2);
    if (sp > maxSpeed && sp > 1e-6) {
      const k = maxSpeed / sp;
      this.x[VX] *= k;
      this.x[VY] *= k;
      this.x[VZ] *= k;
    }
  }

  /** Predict the state forward to time `t` (no-op / clamped for dt ≤ 0). */
  predictTo(t: number): void {
    const dt = t - this.tSec;
    if (dt <= 0) {
      if (t > this.tSec) this.tSec = t;
      return;
    }
    buildF(dt, this.F);
    predictState(this.x, dt, this.xPred);
    this.x.set(this.xPred);
    // P = F·P·Fᵀ + Q
    mul(this.F, 6, 6, this.P, 6, this.FP);
    mulABt(this.FP, 6, 6, this.F, 6, this.tmpA);
    processNoiseQ(dt, this.opt.sigmaA, this.Q);
    add(this.tmpA, this.Q, 36, this.P);
    this.tSec = t;
  }

  /** Acoustic correction with z = [R, θ]. `azScale` ≥ 1 trusts azimuth less. */
  updateAcoustic(rangeM: number, azimuthRad: number, azScale = 1): UpdateResult {
    buildRAcoustic(this.opt.sigmaRangeM, this.opt.sigmaAzimuthRad, azScale, this.Rm);
    return this.correct(
      2,
      (out) => hAcoustic(this.x, out),
      (out) => jacobianAcoustic(this.x, out),
      (h, yy) => {
        yy[0] = rangeM - h[0];
        yy[1] = wrapAngle(azimuthRad - h[1]);
      },
    );
  }

  /** Visual correction with z = [u, v, d]. `rScale` ≥ 1 trusts vision less. */
  updateVisual(
    u: number,
    v: number,
    depthM: number,
    K: CameraIntrinsics,
    rScale = 1,
  ): UpdateResult {
    buildRVisual(depthM, this.opt.sigmaPixel, this.opt.relDepthStd, this.Rm);
    if (rScale !== 1) for (let i = 0; i < 9; i++) this.Rm[i] *= rScale;
    return this.correct(
      3,
      (out) => hVisual(this.x, K, out),
      (out) => jacobianVisual(this.x, K, out),
      (h, yy) => {
        yy[0] = u - h[0];
        yy[1] = v - h[1];
        yy[2] = depthM - h[2];
      },
    );
  }

  private correct(
    m: number,
    hfn: (out: Float64Array) => void,
    Hfn: (out: Mat) => void,
    innov: (h: Float64Array, y: Float64Array) => void,
  ): UpdateResult {
    hfn(this.hbuf);
    innov(this.hbuf, this.y);
    Hfn(this.H);

    // PHt = P·Hᵀ (6×m)
    mulABt(this.P, 6, 6, this.H, m, this.PHt);
    // HPHt = H·PHt (m×m)
    mul(this.H, m, 6, this.PHt, m, this.HPHt);
    // S = HPHt + R
    add(this.HPHt, this.Rm, m * m, this.S);
    if (!invert(this.S, m, this.Sinv, this.invWork)) {
      return { accepted: false, nis: Infinity };
    }
    const nis = quadFormInv(this.y, this.Sinv, m);
    if (!chiSquareGate(nis, m, this.opt.gateConfidence)) {
      return { accepted: false, nis };
    }
    // K = PHt·Sinv (6×m)
    mul(this.PHt, 6, m, this.Sinv, m, this.K);
    // x += K·y
    for (let i = 0; i < STATE_DIM; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += this.K[i * m + j] * this.y[j];
      this.x[i] += s;
    }
    // Joseph form: A = I - K·H ; P = A·P·Aᵀ + K·R·Kᵀ
    mul(this.K, 6, m, this.H, 6, this.KH);
    for (let i = 0; i < 36; i++) this.A[i] = (i % 7 === 0 ? 1 : 0) - this.KH[i];
    mul(this.A, 6, 6, this.P, 6, this.AP);
    mulABt(this.AP, 6, 6, this.A, 6, this.tmpA);
    mul(this.K, 6, m, this.Rm, m, this.KR);
    mulABt(this.KR, 6, m, this.K, 6, this.KRKt);
    add(this.tmpA, this.KRKt, 36, this.P);
    return { accepted: true, nis };
  }
}
