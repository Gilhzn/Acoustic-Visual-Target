import { describe, it, expect } from "vitest";
import { DEFAULT_CONTROL_STATE, type ControlState, type TelemetrySnapshot } from "@avt/contracts";
import {
  AcousticTunerAgent,
  InferenceAgent,
  FusionCalibratorAgent,
  RenderScalerAgent,
  RegressionAgent,
  createDefaultCouncil,
} from "../src/agents/index.js";

function tele(overrides: Partial<{ [K in keyof TelemetrySnapshot]: Partial<TelemetrySnapshot[K]> }> = {}): TelemetrySnapshot {
  const base: TelemetrySnapshot = {
    tSec: 1,
    acoustic: { adcSaturationFrac: 0.01, outOfBandNoiseDb: -80, carrierSnrDb: 20 },
    vision: { inferenceMs: 15, iou: 0.8, gpuMemFrac: 0.4, detectionConfidence: 0.9 },
    fusion: { nis: 1.0, nisDof: 2, velocityVariance: 0.1, visualConfidence: 0.9 },
    render: { frameDtMs: 16, fps: 60, coreTempC: 35, batteryFrac: 0.8, contextLost: false },
    tracking: { spatialErrorM: NaN, jitterStd: 0.01 },
  };
  return {
    ...base,
    acoustic: { ...base.acoustic, ...overrides.acoustic },
    vision: { ...base.vision, ...overrides.vision },
    fusion: { ...base.fusion, ...overrides.fusion },
    render: { ...base.render, ...overrides.render },
    tracking: { ...base.tracking, ...overrides.tracking },
  };
}

const ctl = (): ControlState =>
  JSON.parse(JSON.stringify(DEFAULT_CONTROL_STATE)) as ControlState;

describe("AcousticTunerAgent", () => {
  const a = new AcousticTunerAgent();
  it("lowers speaker gain on ADC saturation", () => {
    const p = a.evaluate(tele({ acoustic: { adcSaturationFrac: 0.1 } }), ctl());
    expect(p?.acoustic?.speakerGain).toBeLessThan(DEFAULT_CONTROL_STATE.acoustic.speakerGain);
  });
  it("sweeps the carrier on low SNR", () => {
    const p = a.evaluate(tele({ acoustic: { carrierSnrDb: 3 } }), ctl());
    expect(p?.acoustic?.carrierHz).toBe(20500);
  });
  it("does nothing under nominal conditions", () => {
    expect(a.evaluate(tele(), ctl())).toBeNull();
  });
});

describe("InferenceAgent", () => {
  const a = new InferenceAgent();
  it("swaps to a lighter model under high latency", () => {
    const p = a.evaluate(tele({ vision: { inferenceMs: 50 } }), ctl());
    expect(p?.vision?.model).toBe("yolo-nano");
  });
  it("restricts search to the ellipse when IoU is low", () => {
    const p = a.evaluate(tele({ vision: { iou: 0.2 } }), ctl());
    expect(p?.vision?.restrictToEllipse).toBe(true);
  });
});

describe("FusionCalibratorAgent", () => {
  const a = new FusionCalibratorAgent();
  it("inflates visual covariance when NIS exceeds the gate", () => {
    const p = a.evaluate(tele({ fusion: { nis: 10 } }), ctl());
    expect(p?.fusion?.rVisScale).toBeGreaterThan(DEFAULT_CONTROL_STATE.fusion.rVisScale);
  });
  it("raises process noise for agile targets", () => {
    const p = a.evaluate(tele({ fusion: { velocityVariance: 8 } }), ctl());
    expect(p?.fusion?.sigmaA).toBeGreaterThan(DEFAULT_CONTROL_STATE.fusion.sigmaA);
  });
});

describe("RenderScalerAgent", () => {
  const a = new RenderScalerAgent();
  it("drops DPR and post-processing under low FPS", () => {
    const p = a.evaluate(tele({ render: { fps: 30 } }), ctl());
    expect(p?.render?.dpr).toBe(1.0);
    expect(p?.render?.postProcessing).toBe(false);
  });
  it("recovers quality when headroom returns", () => {
    const degraded = ctl();
    degraded.render.dpr = 1.0;
    degraded.render.postProcessing = false;
    const p = a.evaluate(tele(), degraded);
    expect(p?.render?.dpr).toBe(1.5);
    expect(p?.render?.postProcessing).toBe(true);
  });
});

describe("RegressionAgent", () => {
  const a = new RegressionAgent(0.05);
  it("flags excessive spatial error", () => {
    const p = a.evaluate(tele({ tracking: { spatialErrorM: 0.12 } }), ctl());
    expect(p?.test?.lastReport).toContain("exceeds");
    expect(p?.test?.hotReloadRequested).toBe(false);
  });
  it("requests recovery on a lost WebGL context", () => {
    const p = a.evaluate(tele({ render: { contextLost: true } }), ctl());
    expect(p?.test?.hotReloadRequested).toBe(true);
  });
  it("ignores NaN ground-truth error (live mode)", () => {
    expect(a.evaluate(tele(), ctl())).toBeNull();
  });
});

describe("Council", () => {
  it("merges and clamps multi-agent patches under combined stress", () => {
    const council = createDefaultCouncil();
    const applied = council.tick(
      tele({
        acoustic: { adcSaturationFrac: 0.2 },
        vision: { inferenceMs: 60, iou: 0.1 },
        fusion: { nis: 20 },
        render: { fps: 20, coreTempC: 50 },
      }),
    );
    expect(applied.length).toBeGreaterThanOrEqual(4);
    const s = council.state;
    expect(s.render.dpr).toBe(1.0);
    expect(s.vision.model).toBe("yolo-nano");
    expect(s.vision.restrictToEllipse).toBe(true);
    expect(s.fusion.rVisScale).toBeGreaterThan(1);
    expect(s.acoustic.speakerGain).toBeLessThan(DEFAULT_CONTROL_STATE.acoustic.speakerGain);
    // clamps hold
    expect(s.render.dpr).toBeGreaterThanOrEqual(1.0);
    expect(s.fusion.rVisScale).toBeLessThanOrEqual(50);
  });
});
