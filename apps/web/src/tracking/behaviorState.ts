import type { PersonHistorySample } from "./PersonRegistry.js";

/**
 * Observable behavioural state — derived ONLY from things we actually measure
 * (motion magnitude, posture changes, breathing pattern). It is NOT "emotion"
 * inferred from a face or voice; that is scientifically unreliable and
 * intentionally avoided. "Agitated" only fires when both motion is elevated
 * AND breathing is fast / irregular — never as a guess at internal feeling.
 */
export type ObservableState =
  | "calm"
  | "still"
  | "engaged"
  | "restless"
  | "agitated"
  | "unknown";

export type BreathingPattern = "regular" | "irregular" | "fast" | "slow" | "none";

export interface BehaviorSummary {
  state: ObservableState;
  meanActivity: number;
  breathingBpm: number;
  breathingPattern: BreathingPattern;
  postureMode: string;
  postureChanges: number;
  timePresentSec: number;
  meanDistance: number;
  minDistance: number;
  centeredFraction: number;
  activityPeaks: number;
  sampleCount: number;
}

const CENTERED_DEG = 10;
const ACTIVITY_PEAK_THRESHOLD = 0.4;

export function deriveBreathingPattern(bpms: number[]): { pattern: BreathingPattern; meanBpm: number } {
  if (bpms.length < 3) return { pattern: "none", meanBpm: 0 };
  let sum = 0;
  for (const b of bpms) sum += b;
  const mean = sum / bpms.length;
  let varSum = 0;
  for (const b of bpms) varSum += (b - mean) * (b - mean);
  const std = Math.sqrt(varSum / bpms.length);
  if (mean > 22) return { pattern: "fast", meanBpm: mean };
  if (mean < 10) return { pattern: "slow", meanBpm: mean };
  if (std > 3) return { pattern: "irregular", meanBpm: mean };
  return { pattern: "regular", meanBpm: mean };
}

export function deriveState(
  samples: ReadonlyArray<PersonHistorySample>,
  windowSec = 10,
): BehaviorSummary {
  const empty: BehaviorSummary = {
    state: "unknown",
    meanActivity: 0,
    breathingBpm: 0,
    breathingPattern: "none",
    postureMode: "unknown",
    postureChanges: 0,
    timePresentSec: 0,
    meanDistance: 0,
    minDistance: 0,
    centeredFraction: 0,
    activityPeaks: 0,
    sampleCount: 0,
  };
  if (samples.length === 0) return empty;

  const lastT = samples[samples.length - 1].tSec;
  const recent: PersonHistorySample[] = [];
  for (const s of samples) if (s.tSec >= lastT - windowSec) recent.push(s);
  if (recent.length === 0) return empty;

  let sumA = 0;
  let sumDist = 0;
  let minDist = Infinity;
  let centered = 0;
  let peaks = 0;
  let postureChanges = 0;
  const postureCount: Record<string, number> = {};
  const bpms: number[] = [];
  let prevPosture: string | null = null;
  for (const s of recent) {
    sumA += s.activity;
    sumDist += s.distanceM;
    if (s.distanceM < minDist) minDist = s.distanceM;
    if (Math.abs(s.azimuthDeg) <= CENTERED_DEG) centered++;
    if (s.activity >= ACTIVITY_PEAK_THRESHOLD) peaks++;
    postureCount[s.posture] = (postureCount[s.posture] ?? 0) + 1;
    if (prevPosture !== null && prevPosture !== s.posture && s.posture !== "unknown" && prevPosture !== "unknown") {
      postureChanges++;
    }
    prevPosture = s.posture;
    if (s.breathingBpm && s.breathingBpm > 0) bpms.push(s.breathingBpm);
  }
  const n = recent.length;
  const meanActivity = sumA / n;
  const meanDistance = sumDist / n;
  const { pattern: breathingPattern, meanBpm } = deriveBreathingPattern(bpms);

  let postureMode = "unknown";
  let modeCount = 0;
  for (const [k, v] of Object.entries(postureCount)) {
    if (v > modeCount) {
      modeCount = v;
      postureMode = k;
    }
  }

  const timePresent = Math.max(0, recent[recent.length - 1].tSec - recent[0].tSec);

  let state: ObservableState;
  const abnormalBreath = breathingPattern === "fast" || breathingPattern === "irregular";
  if (abnormalBreath && meanActivity >= 0.3) {
    state = "agitated";
  } else if (meanActivity >= 0.3) {
    state = "restless";
  } else if (meanActivity >= 0.08) {
    state = "engaged";
  } else if (bpms.length > 0) {
    state = "calm";
  } else {
    state = "still";
  }

  return {
    state,
    meanActivity,
    breathingBpm: meanBpm,
    breathingPattern,
    postureMode,
    postureChanges,
    timePresentSec: timePresent,
    meanDistance,
    minDistance: minDist === Infinity ? 0 : minDist,
    centeredFraction: centered / n,
    activityPeaks: peaks,
    sampleCount: n,
  };
}
