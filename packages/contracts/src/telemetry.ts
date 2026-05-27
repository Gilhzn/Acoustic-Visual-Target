/**
 * Telemetry + control surface for the Council of Agents.
 *
 * Agents are pure decision functions: they read a TelemetrySnapshot plus the
 * current ControlState and return a ControlPatch (or null). The Council merges
 * patches with priority arbitration. This keeps the whole control layer
 * deterministically testable in Node.
 */

export interface AcousticTelemetry {
  /** Fraction of ADC samples at full scale (clipping). */
  adcSaturationFrac: number;
  /** Energy outside the chirp band, in dB relative to full scale. */
  outOfBandNoiseDb: number;
  /** Received carrier signal-to-noise ratio (dB). */
  carrierSnrDb: number;
}

export interface VisionTelemetry {
  /** Wall-clock per-inference latency (ms). */
  inferenceMs: number;
  /** Intersection-over-union of consecutive boxes (track stability). */
  iou: number;
  /** GPU memory load fraction [0,1]. */
  gpuMemFrac: number;
  /** Latest detector confidence [0,1]. */
  detectionConfidence: number;
}

export interface FusionTelemetry {
  /** Normalized innovation squared of the last update. */
  nis: number;
  nisDof: number;
  /** Variance of estimated target speed (m²/s²). */
  velocityVariance: number;
  visualConfidence: number;
}

export interface RenderTelemetry {
  frameDtMs: number;
  fps: number;
  coreTempC: number;
  batteryFrac: number;
  contextLost: boolean;
}

export interface TrackingTelemetry {
  /** Spatial error vs ground truth (m); NaN when no ground truth (live). */
  spatialErrorM: number;
  /** Std-dev of frame-to-frame position delta (m). */
  jitterStd: number;
}

export interface TelemetrySnapshot {
  tSec: number;
  acoustic: AcousticTelemetry;
  vision: VisionTelemetry;
  fusion: FusionTelemetry;
  render: RenderTelemetry;
  tracking: TrackingTelemetry;
}

export interface AcousticControl {
  /** Speaker output level [0,1]. */
  speakerGain: number;
  firLowHz: number;
  firHighHz: number;
  carrierHz: number;
  clutterAlpha: number;
}

export interface VisionControl {
  model: "coco-ssd" | "yolo-nano";
  confidenceThreshold: number;
  /** Restrict inference to the EKF-predicted search ellipse. */
  restrictToEllipse: boolean;
}

export interface FusionControl {
  /** Process-noise acceleration std (m/s²). */
  sigmaA: number;
  /** Multiplier on visual measurement covariance (>1 = trust vision less). */
  rVisScale: number;
  /** Multiplier on acoustic azimuth covariance. */
  rAcousticAzScale: number;
}

export interface RenderControl {
  dpr: number;
  postProcessing: boolean;
  cullDistanceM: number;
}

export interface TestControl {
  hotReloadRequested: boolean;
  lastReport: string;
}

export interface ControlState {
  acoustic: AcousticControl;
  vision: VisionControl;
  fusion: FusionControl;
  render: RenderControl;
  test: TestControl;
}

export interface ControlPatch {
  reason: string;
  acoustic?: Partial<AcousticControl>;
  vision?: Partial<VisionControl>;
  fusion?: Partial<FusionControl>;
  render?: Partial<RenderControl>;
  test?: Partial<TestControl>;
}

export interface Agent {
  readonly id: string;
  /** Return a control patch to apply, or null to do nothing this tick. */
  evaluate(t: TelemetrySnapshot, ctl: Readonly<ControlState>): ControlPatch | null;
}

export const DEFAULT_CONTROL_STATE: ControlState = {
  acoustic: {
    speakerGain: 0.6,
    firLowHz: 17500,
    firHighHz: 22500,
    carrierHz: 20000,
    clutterAlpha: 0.95,
  },
  vision: {
    model: "coco-ssd",
    confidenceThreshold: 0.5,
    restrictToEllipse: false,
  },
  fusion: {
    sigmaA: 1.5,
    rVisScale: 1.0,
    rAcousticAzScale: 1.0,
  },
  render: {
    dpr: 1.5,
    postProcessing: true,
    cullDistanceM: 12,
  },
  test: {
    hotReloadRequested: false,
    lastReport: "",
  },
};
