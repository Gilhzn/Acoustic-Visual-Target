import type { Vec3 } from "@avt/contracts";

export interface TrackSample {
  tSec: number;
  position: Vec3;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export interface ErrorStats {
  mean: number;
  p95: number;
  max: number;
}

/** Per-sample Euclidean error stats between estimate and truth (matched by index). */
export function euclideanError(
  est: TrackSample[],
  truth: TrackSample[],
  fromSec = 0,
): ErrorStats {
  const errs: number[] = [];
  const n = Math.min(est.length, truth.length);
  for (let i = 0; i < n; i++) {
    if (est[i].tSec < fromSec) continue;
    errs.push(dist(est[i].position, truth[i].position));
  }
  if (errs.length === 0) return { mean: 0, p95: 0, max: 0 };
  errs.sort((a, b) => a - b);
  const mean = errs.reduce((s, e) => s + e, 0) / errs.length;
  const p95 = errs[Math.min(errs.length - 1, Math.floor(0.95 * errs.length))];
  return { mean, p95, max: errs[errs.length - 1] };
}

/** Std-dev of frame-to-frame position change (tracking jitter). */
export function jitterStd(est: TrackSample[], fromSec = 0): number {
  const deltas: number[] = [];
  for (let i = 1; i < est.length; i++) {
    if (est[i].tSec < fromSec) continue;
    deltas.push(dist(est[i].position, est[i - 1].position));
  }
  if (deltas.length === 0) return 0;
  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const varc = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;
  return Math.sqrt(varc);
}

/** First time (s) the error drops below `thresh` and stays below it. */
export function convergenceTime(
  est: TrackSample[],
  truth: TrackSample[],
  thresh: number,
): number {
  const n = Math.min(est.length, truth.length);
  for (let i = 0; i < n; i++) {
    if (dist(est[i].position, truth[i].position) < thresh) {
      let stays = true;
      for (let j = i; j < n; j++) {
        if (dist(est[j].position, truth[j].position) >= thresh) {
          stays = false;
          break;
        }
      }
      if (stays) return est[i].tSec;
    }
  }
  return Infinity;
}

/**
 * Fraction of NIS samples within the χ² confidence band [lo, hi]. A consistent
 * filter sits near the band; persistently above ⇒ overconfident, below ⇒ sluggish.
 */
export function nisConsistency(
  nisLog: number[],
  loThresh: number,
  hiThresh: number,
): { inBoundsFraction: number; mean: number } {
  if (nisLog.length === 0) return { inBoundsFraction: 1, mean: 0 };
  let inBounds = 0;
  let sum = 0;
  for (const n of nisLog) {
    sum += n;
    if (n >= loThresh && n <= hiThresh) inBounds++;
  }
  return { inBoundsFraction: inBounds / nisLog.length, mean: sum / nisLog.length };
}
