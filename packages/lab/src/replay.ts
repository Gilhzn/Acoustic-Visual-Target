import { seconds } from "@avt/core-units";
import type { Vec3 } from "@avt/contracts";
import { AcousticPipeline } from "@avt/dsp";
import { FusionCore } from "@avt/fusion";
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
 * Deterministically replay a scenario through the REAL DSP pipeline and the
 * shared FusionCore — the in-Node analogue of the live fusion loop. Returns
 * estimates vs ground truth plus filter diagnostics for the metrics layer.
 */
export function runReplay(scn: Scenario, seed: number): ReplayResult {
  const rng = new Rng(seed);
  const pipeline = new AcousticPipeline(scn.chirp, {
    micBaselineM: scn.micBaselineM,
    ...scn.pipelineOpts,
  });
  const K = scn.intrinsics;
  const fusion = new FusionCore({ intrinsics: K, ekf: scn.ekfOptions });
  const events = buildEvents(scn);

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
    if (ev.kind === "acoustic") {
      const { mic0, mic1 } = synthEcho(scn.trajectory, scn.chirp, scn.micBaselineM, scn.acoustic, ev.t, rng);
      const meas = pipeline.process(mic0, mic1, seconds(ev.t));
      if (!fusion.initialized) continue; // prime clutter, wait for visual init
      result.acousticTotal++;
      const res = fusion.onAcoustic(meas);
      if (res?.accepted) {
        result.acousticAccepted++;
        result.nisLog.push(res.nis);
      }
    } else {
      const det = synthDetection(scn.trajectory, K, scn.knownHeightM, scn.classLabel, scn.visual, ev.t, rng);
      if (!fusion.initialized) {
        if (det) fusion.initFromVisual(det);
        continue;
      }
      result.visualTotal++;
      if (!det) result.visualMissed++;
      const res = fusion.onVisual(det, ev.t);
      if (res?.accepted) result.visualAccepted++;
    }

    if (fusion.initialized) {
      const est = fusion.position();
      const truth: Vec3 = scn.trajectory.posAt(ev.t);
      result.estimates.push({ tSec: ev.t, position: { ...est } });
      result.truth.push({ tSec: ev.t, position: truth });
    }
  }

  return result;
}
