import type { Agent, ControlPatch, ControlState, TelemetrySnapshot } from "@avt/contracts";
import { chiSquareThreshold } from "@avt/fusion";

/**
 * Monitors microphone clipping and channel cleanliness; lowers speaker output,
 * tightens the FIR band, and sweeps the carrier toward a cleaner frequency.
 */
export class AcousticTunerAgent implements Agent {
  readonly id = "acoustic-tuner";
  evaluate(t: TelemetrySnapshot, ctl: Readonly<ControlState>): ControlPatch | null {
    const a = t.acoustic;
    const patch: ControlPatch["acoustic"] = {};
    let touched = false;
    if (a.adcSaturationFrac > 0.05) {
      patch.speakerGain = ctl.acoustic.speakerGain * 0.8;
      touched = true;
    }
    if (a.outOfBandNoiseDb > -60) {
      patch.firLowHz = Math.min(ctl.acoustic.firLowHz + 250, 19000);
      patch.firHighHz = Math.max(ctl.acoustic.firHighHz - 250, 21000);
      touched = true;
    }
    if (a.carrierSnrDb < 6) {
      // Step the carrier within the band to escape a noisy frequency.
      const next = ctl.acoustic.carrierHz + 500;
      patch.carrierHz = next > 21500 ? 18500 : next;
      touched = true;
    }
    return touched ? { reason: "acoustic-conditions", acoustic: patch } : null;
  }
}

/**
 * Watches inference latency, track stability (IoU), and GPU load; swaps to a
 * lighter model and constrains the search to the predicted ellipse under load.
 */
export class InferenceAgent implements Agent {
  readonly id = "inference-optimizer";
  evaluate(t: TelemetrySnapshot, ctl: Readonly<ControlState>): ControlPatch | null {
    const v = t.vision;
    const patch: ControlPatch["vision"] = {};
    let touched = false;
    if (v.inferenceMs > 40 || v.gpuMemFrac > 0.85) {
      if (ctl.vision.model !== "yolo-nano") {
        patch.model = "yolo-nano";
        touched = true;
      }
    }
    if (v.iou < 0.3 && !ctl.vision.restrictToEllipse) {
      patch.restrictToEllipse = true;
      touched = true;
    }
    if (v.inferenceMs < 20 && v.iou > 0.6 && ctl.vision.restrictToEllipse) {
      patch.restrictToEllipse = false;
      touched = true;
    }
    return touched ? { reason: "inference-load", vision: patch } : null;
  }
}

/**
 * Keeps the EKF statistically consistent: inflates measurement covariances when
 * innovations or confidence degrade, and raises process noise for agile targets.
 */
export class FusionCalibratorAgent implements Agent {
  readonly id = "fusion-calibrator";
  evaluate(t: TelemetrySnapshot, ctl: Readonly<ControlState>): ControlPatch | null {
    const f = t.fusion;
    const patch: ControlPatch["fusion"] = {};
    let touched = false;
    const gate = chiSquareThreshold(f.nisDof || 2, 0.95);
    if (f.nis > gate) {
      patch.rVisScale = ctl.fusion.rVisScale * 1.5;
      touched = true;
    }
    if (f.visualConfidence < 0.4) {
      patch.rVisScale = Math.max(patch.rVisScale ?? ctl.fusion.rVisScale, ctl.fusion.rVisScale * 1.5);
      touched = true;
    }
    if (f.velocityVariance > 4) {
      patch.sigmaA = ctl.fusion.sigmaA * 1.5;
      touched = true;
    } else if (f.velocityVariance < 0.5 && f.nis < gate * 0.5 && ctl.fusion.rVisScale > 1) {
      // Conditions calm — relax back toward nominal trust.
      patch.rVisScale = Math.max(1, ctl.fusion.rVisScale * 0.8);
      touched = true;
    }
    return touched ? { reason: "fusion-consistency", fusion: patch } : null;
  }
}

/**
 * Protects frame rate and thermals: scales device pixel ratio and toggles heavy
 * post-processing, recovering quality when headroom returns.
 */
export class RenderScalerAgent implements Agent {
  readonly id = "render-scaler";
  evaluate(t: TelemetrySnapshot, ctl: Readonly<ControlState>): ControlPatch | null {
    const r = t.render;
    const patch: ControlPatch["render"] = {};
    let touched = false;
    const stressed = r.fps < 45 || r.coreTempC > 42 || r.batteryFrac < 0.15;
    if (stressed) {
      if (ctl.render.dpr > 1.0) {
        patch.dpr = 1.0;
        touched = true;
      }
      if (ctl.render.postProcessing) {
        patch.postProcessing = false;
        touched = true;
      }
    } else if (r.fps > 55 && r.coreTempC < 38 && r.batteryFrac > 0.3) {
      if (ctl.render.dpr < 1.5) {
        patch.dpr = 1.5;
        touched = true;
      }
      if (!ctl.render.postProcessing) {
        patch.postProcessing = true;
        touched = true;
      }
    }
    return touched ? { reason: "render-budget", render: patch } : null;
  }
}

/**
 * Autonomous QA watchdog: flags excessive tracking error or rendering crashes
 * for hot-reload recovery and records a telemetry report line.
 */
export class RegressionAgent implements Agent {
  readonly id = "autonomous-test";
  constructor(private readonly errorLimitM = 0.05) {}
  evaluate(t: TelemetrySnapshot, _ctl: Readonly<ControlState>): ControlPatch | null {
    const failing =
      (Number.isFinite(t.tracking.spatialErrorM) && t.tracking.spatialErrorM > this.errorLimitM) ||
      t.render.contextLost;
    if (!failing) return null;
    const report = t.render.contextLost
      ? `t=${t.tSec.toFixed(2)}s WebGL context lost — requesting recovery`
      : `t=${t.tSec.toFixed(2)}s spatial error ${t.tracking.spatialErrorM.toFixed(3)}m exceeds ${this.errorLimitM}m`;
    return { reason: "qa-watchdog", test: { hotReloadRequested: t.render.contextLost, lastReport: report } };
  }
}
