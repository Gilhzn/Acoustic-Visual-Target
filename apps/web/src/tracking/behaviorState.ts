import type { PersonHistorySample } from "./PersonRegistry.js";

/**
 * Observable behavioural state — derived ONLY from things we actually measure
 * (motion magnitude, posture, breathing). It is NOT "emotion" inferred from a
 * face or voice; that is scientifically unreliable and intentionally avoided.
 */
export type ObservableState = "calm" | "still" | "engaged" | "restless" | "unknown";

export interface BehaviorSummary {
  state: ObservableState;
  meanActivity: number;
  breathingBpm: number;
  postureMode: string;
  sampleCount: number;
}

export function deriveState(
  samples: ReadonlyArray<PersonHistorySample>,
  windowSec = 10,
): BehaviorSummary {
  if (samples.length === 0) {
    return { state: "unknown", meanActivity: 0, breathingBpm: 0, postureMode: "unknown", sampleCount: 0 };
  }
  const lastT = samples[samples.length - 1].tSec;
  const recent: PersonHistorySample[] = [];
  for (const s of samples) if (s.tSec >= lastT - windowSec) recent.push(s);

  let sumA = 0;
  let sumBpm = 0;
  let countBpm = 0;
  const postureCount: Record<string, number> = {};
  for (const s of recent) {
    sumA += s.activity;
    postureCount[s.posture] = (postureCount[s.posture] ?? 0) + 1;
    if (s.breathingBpm && s.breathingBpm > 0) {
      sumBpm += s.breathingBpm;
      countBpm++;
    }
  }
  const n = Math.max(recent.length, 1);
  const meanActivity = sumA / n;
  const breathingBpm = countBpm > 0 ? sumBpm / countBpm : 0;
  let postureMode = "unknown";
  let modeCount = 0;
  for (const [k, v] of Object.entries(postureCount)) {
    if (v > modeCount) {
      modeCount = v;
      postureMode = k;
    }
  }
  let state: ObservableState;
  if (meanActivity < 0.08) state = breathingBpm > 0 ? "calm" : "still";
  else if (meanActivity < 0.3) state = "engaged";
  else state = "restless";

  return { state, meanActivity, breathingBpm, postureMode, sampleCount: recent.length };
}
