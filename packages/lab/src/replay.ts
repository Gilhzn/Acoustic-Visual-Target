import { seconds, type Radians } from "@avt/core-units";
import type { Vec3 } from "@avt/contracts";
import { AcousticPipeline, disambiguate } from "@avt/dsp";
import { Ekf, makeState, diagCov } from "@avt/fusion";
import { Rng } from "./rng.js";
import { synthEcho } from "./acousticGen.js";
import { synthDetection } from "./visualGen.js";
import type { Scenario } from "./scenarios/index.js";
import type { TrackSample } from "./metrics.js";

export interface ReplayResult {
  estimates: TrackSample[];
  truth: TrackSample[];
  nisLog: number[];
  acousticAccepted: number;
  acousticTotal: number;
  visualAccepted: number;
  visualTotal: number;
  visualMissed: number;
}

type Ev = { t: number; kind: "acoustic" | "visual" };

function buildEvents(scn: Scenario): Ev[] {
  const evs: Ev[] = [];
  const aDt = 1 / scn.acousticRateHz;
  const vDt = 1 / scn.visualRateHz;
  for (let t = 0; t <= scn.durationS + 1e-9; t += aDt) evs.push({ t, kind: "acoustic" });
  for (let t = 0; t <= scn.durationS + 1e-9; t += vDt) evs.push({ t, kind: "visual" });
  // Acoustic before visual when timestamps tie.
  evs.sort((a, b) => a.t - b.t || (a.kind === "acoustic" ? -1 : 1));
  return evs;
}

/**
 * Deterministically replay a scenario through the REAL DSP pipeline and EKF —
 * the in-Node analogue of the live fusion loop. Returns estimates vs ground
 * truth plus filter diagnostics for the metrics layer.
 */
export function runReplay(scn: Scenario, seed: number): ReplayResult {
  const rng = new Rng(seed);
  const pipeline = new AcousticPipeline(scn.chirp, {
    micBaselineM: scn.micBaselineM,
    ...scn.pipelineOpts,
  });
  const K = scn.intrinsics;
  const events = buildEvents(scn);

  // Measurement-based init: first visual detection back-projected to 3D.
  let ekf: Ekf | null = null;
  const result: ReplayResult = {
    estimates: [],
    truth: [],
    nisLog: [],
    acousticAccepted: 0,
    acousticTotal: 0,
    visualAccepted: 0,
    visualTotal: 0,
    visualMissed: 0,
  };

  for (const ev of events) {
    if (!ekf) {
      // Keep priming the acoustic clutter model even before init.
      if (ev.kind === "acoustic") {
        const { mic0, mic1 } = synthEcho(scn.trajectory, scn.chirp, scn.micBaselineM, scn.acoustic, ev.t, rng);
        pipeline.process(mic0, mic1, seconds(ev.t));
      } else {
        const det = synthDetection(scn.trajectory, K, scn.knownHeightM, scn.classLabel, scn.visual, ev.t, rng);
        if (det) {
          const z = det.depthM as number;
          const x0 = makeState(((det.u - K.cx) * z) / K.fx, ((det.v - K.cy) * z) / K.fy, z);
          ekf = new Ekf(x0, diagCov(0.6, 1.0), scn.ekfOptions, ev.t);
        }
      }
      continue;
    }

    if (ev.kind === "acoustic") {
      result.acousticTotal++;
      const { mic0, mic1 } = synthEcho(scn.trajectory, scn.chirp, scn.micBaselineM, scn.acoustic, ev.t, rng);
      const meas = pipeline.process(mic0, mic1, seconds(ev.t));
      ekf.predictTo(ev.t);
      if (meas.valid) {
        const pred = ekf.position();
        const predTheta = Math.atan2(pred.x, pred.z);
        const theta = disambiguate(meas.aliases, predTheta) as Radians;
        const res = ekf.updateAcoustic(meas.rangeM as number, theta as number);
        if (res.accepted) {
          result.acousticAccepted++;
          result.nisLog.push(res.nis);
        }
      }
    } else {
      result.visualTotal++;
      const det = synthDetection(scn.trajectory, K, scn.knownHeightM, scn.classLabel, scn.visual, ev.t, rng);
      ekf.predictTo(ev.t);
      if (det) {
        const rScale = Math.min(4, 0.85 / Math.max(det.confidence, 0.1));
        const res = ekf.updateVisual(det.u, det.v, det.depthM as number, K, rScale);
        if (res.accepted) result.visualAccepted++;
      } else {
        result.visualMissed++;
      }
    }

    const est = ekf.position();
    const truth: Vec3 = scn.trajectory.posAt(ev.t);
    result.estimates.push({ tSec: ev.t, position: { ...est } });
    result.truth.push({ tSec: ev.t, position: truth });
  }

  return result;
}
