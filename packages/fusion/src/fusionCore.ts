import type {
  AcousticMeasurement,
  CameraIntrinsics,
  TrackState,
  VisualMeasurement,
  Vec3,
} from "@avt/contracts";
import { seconds } from "@avt/core-units";
import { Ekf, type EkfOptions, type UpdateResult } from "./ekf.js";
import { makeState, diagCov } from "./state.js";
import { projectSearchEllipse, type SearchEllipse } from "./searchEllipse.js";

export interface FusionCoreOptions {
  intrinsics: CameraIntrinsics;
  ekf?: Partial<EkfOptions>;
  initPosStd?: number;
  initVelStd?: number;
  /** Maximum plausible target range (m); the estimate is clamped to it. */
  maxRangeM?: number;
  /** Maximum plausible target speed (m/s). */
  maxSpeed?: number;
  /** Positional variance (m²) above which the filter is considered diverged. */
  divergeVar?: number;
}

/**
 * The single sensor-fusion stepping loop shared by the live app and the lab.
 *
 * Handles measurement-based initialization, multi-rate predict-then-update,
 * acoustic-alias disambiguation against the predicted bearing, and exposes the
 * fused TrackState + search ellipse. Free of any I/O so it runs identically in
 * Node tests and the browser fusion worker.
 */
export class FusionCore {
  private ekf: Ekf | null = null;
  private readonly K: CameraIntrinsics;
  private readonly opts: FusionCoreOptions;
  private label = "target";
  private visibleMisses = 0;
  private lastNisVal = 0;
  private readonly maxRangeM: number;
  private readonly maxSpeed: number;
  private readonly divergeVar: number;

  constructor(opts: FusionCoreOptions) {
    this.K = opts.intrinsics;
    this.opts = opts;
    this.maxRangeM = opts.maxRangeM ?? 12;
    this.maxSpeed = opts.maxSpeed ?? 4;
    this.divergeVar = opts.divergeVar ?? 16;
  }

  /** True once the estimate has drifted implausibly far or grown too uncertain. */
  isDiverged(): boolean {
    if (!this.ekf) return false;
    const p = this.ekf.position();
    const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    return r > this.maxRangeM * 0.98 || this.ekf.positionUncertainty > this.divergeVar;
  }

  private clamp(): void {
    this.ekf?.clampState(this.maxRangeM, this.maxSpeed);
  }

  get initialized(): boolean {
    return this.ekf !== null;
  }

  /** Back-project a visual detection to 3D and initialize the filter. */
  initFromVisual(m: VisualMeasurement): void {
    const z = m.depthM as number;
    const x0 = makeState(
      ((m.u - this.K.cx) * z) / this.K.fx,
      ((m.v - this.K.cy) * z) / this.K.fy,
      z,
    );
    this.label = m.classLabel;
    this.ekf = new Ekf(
      x0,
      diagCov(this.opts.initPosStd ?? 0.6, this.opts.initVelStd ?? 1.0),
      this.opts.ekf,
      m.tSec as number,
    );
  }

  /** Predicted azimuth (x–z bearing) used for acoustic-alias disambiguation. */
  predictedAzimuth(): number {
    if (!this.ekf) return 0;
    const p = this.ekf.position();
    return Math.atan2(p.x, p.z);
  }

  onAcoustic(m: AcousticMeasurement, azScale = 1): UpdateResult | null {
    if (!this.ekf || !m.valid) return null;
    this.ekf.predictTo(m.tSec as number);
    // Sonar can't see past its max range — reject implausible echoes.
    if ((m.rangeM as number) > this.maxRangeM) {
      this.clamp();
      return null;
    }
    const theta = this.pickAlias(m.aliases, this.predictedAzimuth());
    const res = this.ekf.updateAcoustic(m.rangeM as number, theta, azScale);
    if (res.accepted) this.lastNisVal = res.nis;
    this.clamp();
    return res;
  }

  onVisual(m: VisualMeasurement | null, tSec: number): UpdateResult | null {
    if (!this.ekf) return null;
    // A fresh detection after divergence re-acquires from scratch instead of
    // fighting the gate — this is how the tracker recovers from a runaway.
    if (m && this.isDiverged()) {
      this.initFromVisual(m);
      return null;
    }
    this.ekf.predictTo(tSec);
    if (!m) {
      this.visibleMisses++;
      this.clamp();
      return null;
    }
    this.visibleMisses = 0;
    const rScale = Math.min(4, 0.85 / Math.max(m.confidence, 0.1));
    const res = this.ekf.updateVisual(m.u, m.v, m.depthM as number, this.K, rScale);
    if (res.accepted) this.lastNisVal = res.nis;
    this.clamp();
    return res;
  }

  get lastNis(): number {
    return this.lastNisVal;
  }

  /** Advance the prediction without a measurement (e.g. render interpolation). */
  predictTo(tSec: number): void {
    this.ekf?.predictTo(tSec);
    this.clamp();
  }

  position(): Vec3 {
    return this.ekf ? this.ekf.position() : { x: 0, y: 0, z: 0 };
  }
  velocity(): Vec3 {
    return this.ekf ? this.ekf.velocity() : { x: 0, y: 0, z: 0 };
  }
  get positionUncertainty(): number {
    return this.ekf ? this.ekf.positionUncertainty : Infinity;
  }
  /** True while visual updates have been arriving (not coasting on sonar alone). */
  get visuallyTracked(): boolean {
    return this.visibleMisses < 5;
  }

  searchEllipse(confidence = 0.95): SearchEllipse | null {
    if (!this.ekf) return null;
    return projectSearchEllipse(this.ekf.state as Float64Array, this.ekf.cov as Float64Array, this.K, confidence);
  }

  toTrackState(): TrackState {
    const p = this.position();
    const v = this.velocity();
    return {
      tSec: seconds(this.ekf ? this.ekf.time : 0),
      position: p,
      velocity: v,
      posUncertainty: this.positionUncertainty,
      tracked: this.initialized,
      classLabel: this.label,
    };
  }

  private pickAlias(aliases: ReadonlyArray<number>, ref: number): number {
    let best = aliases.length > 0 ? aliases[0] : 0;
    let bestErr = Infinity;
    for (const a of aliases) {
      const e = Math.abs(a - ref);
      if (e < bestErr) {
        bestErr = e;
        best = a;
      }
    }
    return best;
  }
}
