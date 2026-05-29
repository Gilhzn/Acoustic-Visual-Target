import { KNOWN_OBJECT_HEIGHTS_M, type CameraIntrinsics, type Detection, type Vec3 } from "@avt/contracts";

export type Posture = "standing" | "sitting" | "lying" | "unknown";
export type ActivityLabel = "still" | "moving" | "active" | "unknown";

export interface TrackedPerson {
  id: string;
  name: string | null;
  bbox: [number, number, number, number];
  centerPx: { u: number; v: number };
  position: Vec3;
  distanceM: number;
  /** Signed azimuth (deg, + = right of center). */
  azimuthDeg: number;
  posture: Posture;
  /** Normalized recent motion in [0,1]. */
  activity: number;
  activityLabel: ActivityLabel;
  classLabel: string;
  confidence: number;
  firstSeenSec: number;
  lastSeenSec: number;
  /** User-calibrated real height (m) for this person. Overrides the class default. */
  heightOverrideM?: number;
}

export interface MultiTrackerOpts {
  K: CameraIntrinsics;
  minIoU?: number;
  maxAgeSec?: number;
  maxRangeM?: number;
  /** Frames of history kept per track for activity estimation. */
  historyFrames?: number;
  /** EWMA factor (0..1) for bbox smoothing. Higher = more responsive, less smooth. */
  bboxAlpha?: number;
}

/** Standard intersection-over-union for two axis-aligned boxes. */
export function iou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const x0 = Math.max(a[0], b[0]);
  const y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const y1 = Math.min(a[3], b[3]);
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const inter = w * h;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Coarse posture heuristic from bounding-box aspect ratio. A tall-narrow box is
 * a standing person; a roughly square box is a sitting person; a wide-short
 * box is a lying body. Not a classifier — it's an observable geometric proxy.
 */
export function postureFromBbox(bbox: [number, number, number, number]): Posture {
  const w = bbox[2] - bbox[0];
  const h = bbox[3] - bbox[1];
  if (w <= 1 || h <= 1) return "unknown";
  const aspect = h / w;
  if (aspect > 2.2) return "standing";
  if (aspect >= 1.15) return "sitting";
  return "lying";
}

export function activityLabel(a: number): ActivityLabel {
  if (a < 0.08) return "still";
  if (a < 0.35) return "moving";
  return "active";
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

type Bbox = [number, number, number, number];

interface InternalTrack {
  pub: TrackedPerson;
  history: { tSec: number; cx: number; cz: number }[];
  /** Last raw detection bbox (used to compute instantaneous velocity). */
  rawBbox: Bbox;
  /** Smoothed bbox velocity in pixels / second. */
  vBbox: Bbox;
  /** Time of the last bbox update (real detection OR a coast step). */
  lastUpdateSec: number;
}

/** Half-life over which a "coast" extrapolation remains trustworthy (s). */
const COAST_LIMIT_SEC = 0.5;
const VELOCITY_ALPHA = 0.4;

/**
 * IoU-based multi-person tracker. Each detection is greedily matched to the
 * highest-IoU existing track; unmatched detections spawn new tracks; tracks
 * unseen beyond `maxAgeSec` are dropped. Each track stores a short position
 * history used to estimate motion-based "activity".
 */
export class MultiTracker {
  private readonly K: CameraIntrinsics;
  private readonly minIoU: number;
  private readonly maxAgeSec: number;
  private readonly maxRangeM: number;
  private readonly historyFrames: number;
  private readonly bboxAlpha: number;
  private tracks: InternalTrack[] = [];
  private nextId = 1;

  constructor(opts: MultiTrackerOpts) {
    this.K = opts.K;
    this.minIoU = opts.minIoU ?? 0.2;
    this.maxAgeSec = opts.maxAgeSec ?? 1.5;
    this.maxRangeM = opts.maxRangeM ?? 12;
    this.historyFrames = opts.historyFrames ?? 24;
    // Light EWMA on the bbox: rejects per-frame jitter without lagging real motion.
    this.bboxAlpha = clamp01(opts.bboxAlpha ?? 0.65);
  }

  update(detections: Detection[], tSec: number): TrackedPerson[] {
    // Predict each track's current bbox using its smoothed velocity. Matching
    // against the predicted bbox handles brief detection gaps and crossing
    // trajectories far better than matching against a stale stored bbox.
    const predicted: Bbox[] = this.tracks.map((t) => this.predictBbox(t, tSec));

    const pairs: { di: number; ti: number; v: number }[] = [];
    for (let di = 0; di < detections.length; di++) {
      for (let ti = 0; ti < this.tracks.length; ti++) {
        const v = iou(detections[di].bbox, predicted[ti]);
        if (v >= this.minIoU) pairs.push({ di, ti, v });
      }
    }
    pairs.sort((a, b) => b.v - a.v);
    const usedDet = new Set<number>();
    const usedTrk = new Set<number>();
    for (const p of pairs) {
      if (usedDet.has(p.di) || usedTrk.has(p.ti)) continue;
      usedDet.add(p.di);
      usedTrk.add(p.ti);
      this.updateTrack(this.tracks[p.ti], detections[p.di], tSec);
    }
    // Unmatched tracks "coast" briefly by their velocity so the overlay doesn't
    // freeze on a one-frame detection miss.
    for (let ti = 0; ti < this.tracks.length; ti++) {
      if (!usedTrk.has(ti)) this.coastTrack(this.tracks[ti], tSec);
    }
    for (let di = 0; di < detections.length; di++) {
      if (!usedDet.has(di)) this.tracks.push(this.createTrack(detections[di], tSec));
    }
    this.tracks = this.tracks.filter((t) => tSec - t.pub.lastSeenSec <= this.maxAgeSec);
    return this.tracks.map((t) => t.pub);
  }

  private predictBbox(trk: InternalTrack, tSec: number): Bbox {
    const dt = tSec - trk.lastUpdateSec;
    if (dt <= 0) return trk.pub.bbox;
    const v = trk.vBbox;
    return [
      trk.pub.bbox[0] + v[0] * dt,
      trk.pub.bbox[1] + v[1] * dt,
      trk.pub.bbox[2] + v[2] * dt,
      trk.pub.bbox[3] + v[3] * dt,
    ];
  }

  private coastTrack(trk: InternalTrack, tSec: number): void {
    const sinceSeen = tSec - trk.pub.lastSeenSec;
    if (sinceSeen > COAST_LIMIT_SEC) {
      trk.lastUpdateSec = tSec;
      return; // freeze — velocity extrapolation no longer trustworthy
    }
    const dt = tSec - trk.lastUpdateSec;
    if (dt > 0) {
      const v = trk.vBbox;
      const b = trk.pub.bbox;
      b[0] += v[0] * dt;
      b[1] += v[1] * dt;
      b[2] += v[2] * dt;
      b[3] += v[3] * dt;
      // Refresh the derived projection so the UI keeps the values consistent.
      const proj = this.project(b, trk.pub.classLabel, trk.pub.heightOverrideM);
      trk.pub.centerPx = { u: proj.u, v: proj.v };
      trk.pub.position = proj.pos;
      trk.pub.distanceM = proj.distance;
      trk.pub.azimuthDeg = proj.azimuthDeg;
    }
    trk.lastUpdateSec = tSec;
  }

  setName(id: string, name: string | null, heightM?: number): void {
    const t = this.tracks.find((t) => t.pub.id === id);
    if (!t) return;
    t.pub.name = name;
    if (heightM !== undefined) t.pub.heightOverrideM = heightM > 0 ? heightM : undefined;
  }

  /** The "primary" target: highest-confidence (named tracks slightly preferred). */
  primary(): TrackedPerson | null {
    let best: TrackedPerson | null = null;
    let bestScore = -1;
    for (const t of this.tracks) {
      const s = t.pub.confidence + (t.pub.name ? 0.05 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = t.pub;
      }
    }
    return best;
  }

  findAtPixel(u: number, v: number): TrackedPerson | null {
    for (const t of this.tracks) {
      const [x0, y0, x1, y1] = t.pub.bbox;
      if (u >= x0 && u <= x1 && v >= y0 && v <= y1) return t.pub;
    }
    return null;
  }

  private knownHeight(label: string): number {
    return KNOWN_OBJECT_HEIGHTS_M[label] ?? KNOWN_OBJECT_HEIGHTS_M.default;
  }

  private project(
    bbox: [number, number, number, number],
    label: string,
    heightOverrideM?: number,
  ) {
    const [x0, y0, x1, y1] = bbox;
    const u = (x0 + x1) / 2;
    const v = (y0 + y1) / 2;
    const h = Math.max(1, y1 - y0);
    const knownH = heightOverrideM && heightOverrideM > 0 ? heightOverrideM : this.knownHeight(label);
    const rawDepth = (knownH * this.K.fy) / h;
    const z = Math.min(Math.max(rawDepth, 0.3), this.maxRangeM);
    const x = ((u - this.K.cx) * z) / this.K.fx;
    const y = ((v - this.K.cy) * z) / this.K.fy;
    return { pos: { x, y, z } as Vec3, u, v, distance: Math.hypot(x, y, z), azimuthDeg: (Math.atan2(x, z) * 180) / Math.PI };
  }

  private createTrack(det: Detection, tSec: number): InternalTrack {
    // First detection — no prior smoothed state, so the smoothed bbox equals
    // the raw bbox (no lag on track birth).
    const bbox = [...det.bbox] as Bbox;
    const { pos, u, v, distance, azimuthDeg } = this.project(bbox, det.classLabel);
    const pub: TrackedPerson = {
      id: `p${this.nextId++}`,
      name: null,
      bbox,
      centerPx: { u, v },
      position: pos,
      distanceM: distance,
      azimuthDeg,
      posture: postureFromBbox(bbox),
      activity: 0,
      activityLabel: "unknown",
      classLabel: det.classLabel,
      confidence: det.score,
      firstSeenSec: tSec,
      lastSeenSec: tSec,
    };
    return {
      pub,
      history: [{ tSec, cx: pos.x, cz: pos.z }],
      rawBbox: [...bbox] as Bbox,
      vBbox: [0, 0, 0, 0],
      lastUpdateSec: tSec,
    };
  }

  private updateTrack(trk: InternalTrack, det: Detection, tSec: number): void {
    const p = trk.pub;
    // Learn the bbox velocity from the raw delta over the elapsed wall time.
    const dtSeen = tSec - p.lastSeenSec;
    if (dtSeen > 1e-3) {
      const v = trk.vBbox;
      const r = trk.rawBbox;
      const av = VELOCITY_ALPHA;
      v[0] = av * (det.bbox[0] - r[0]) / dtSeen + (1 - av) * v[0];
      v[1] = av * (det.bbox[1] - r[1]) / dtSeen + (1 - av) * v[1];
      v[2] = av * (det.bbox[2] - r[2]) / dtSeen + (1 - av) * v[2];
      v[3] = av * (det.bbox[3] - r[3]) / dtSeen + (1 - av) * v[3];
    }
    trk.rawBbox[0] = det.bbox[0];
    trk.rawBbox[1] = det.bbox[1];
    trk.rawBbox[2] = det.bbox[2];
    trk.rawBbox[3] = det.bbox[3];

    // EWMA-smooth the bbox toward the new detection. Reduces per-frame jitter
    // so the displayed distance / direction / overlay are visibly steadier.
    const a = this.bboxAlpha;
    const sb: Bbox = [
      a * det.bbox[0] + (1 - a) * p.bbox[0],
      a * det.bbox[1] + (1 - a) * p.bbox[1],
      a * det.bbox[2] + (1 - a) * p.bbox[2],
      a * det.bbox[3] + (1 - a) * p.bbox[3],
    ];
    const { pos, u, v, distance, azimuthDeg } = this.project(sb, det.classLabel, p.heightOverrideM);
    p.bbox = sb;
    p.centerPx = { u, v };
    p.position = pos;
    p.distanceM = distance;
    p.azimuthDeg = azimuthDeg;
    p.posture = postureFromBbox(sb);
    p.confidence = det.score;
    p.classLabel = det.classLabel;
    p.lastSeenSec = tSec;
    trk.lastUpdateSec = tSec;
    trk.history.push({ tSec, cx: pos.x, cz: pos.z });
    if (trk.history.length > this.historyFrames) trk.history.shift();
    if (trk.history.length >= 2) {
      let sumSpeed = 0;
      let count = 0;
      for (let i = 1; i < trk.history.length; i++) {
        const dt = Math.max(trk.history[i].tSec - trk.history[i - 1].tSec, 1e-3);
        const ds = Math.hypot(
          trk.history[i].cx - trk.history[i - 1].cx,
          trk.history[i].cz - trk.history[i - 1].cz,
        );
        sumSpeed += ds / dt;
        count++;
      }
      const meanSpeed = count > 0 ? sumSpeed / count : 0;
      p.activity = Math.min(1, meanSpeed);
      p.activityLabel = activityLabel(p.activity);
    }
  }
}
