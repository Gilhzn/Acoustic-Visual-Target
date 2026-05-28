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
}

export interface MultiTrackerOpts {
  K: CameraIntrinsics;
  minIoU?: number;
  maxAgeSec?: number;
  maxRangeM?: number;
  /** Frames of history kept per track for activity estimation. */
  historyFrames?: number;
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

interface InternalTrack {
  pub: TrackedPerson;
  history: { tSec: number; cx: number; cz: number }[];
}

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
  private tracks: InternalTrack[] = [];
  private nextId = 1;

  constructor(opts: MultiTrackerOpts) {
    this.K = opts.K;
    this.minIoU = opts.minIoU ?? 0.2;
    this.maxAgeSec = opts.maxAgeSec ?? 1.5;
    this.maxRangeM = opts.maxRangeM ?? 12;
    this.historyFrames = opts.historyFrames ?? 24;
  }

  update(detections: Detection[], tSec: number): TrackedPerson[] {
    const pairs: { di: number; ti: number; v: number }[] = [];
    for (let di = 0; di < detections.length; di++) {
      for (let ti = 0; ti < this.tracks.length; ti++) {
        const v = iou(detections[di].bbox, this.tracks[ti].pub.bbox);
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
    for (let di = 0; di < detections.length; di++) {
      if (!usedDet.has(di)) this.tracks.push(this.createTrack(detections[di], tSec));
    }
    this.tracks = this.tracks.filter((t) => tSec - t.pub.lastSeenSec <= this.maxAgeSec);
    return this.tracks.map((t) => t.pub);
  }

  setName(id: string, name: string | null): void {
    const t = this.tracks.find((t) => t.pub.id === id);
    if (t) t.pub.name = name;
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

  private project(bbox: [number, number, number, number], label: string) {
    const [x0, y0, x1, y1] = bbox;
    const u = (x0 + x1) / 2;
    const v = (y0 + y1) / 2;
    const h = Math.max(1, y1 - y0);
    const rawDepth = (this.knownHeight(label) * this.K.fy) / h;
    const z = Math.min(Math.max(rawDepth, 0.3), this.maxRangeM);
    const x = ((u - this.K.cx) * z) / this.K.fx;
    const y = ((v - this.K.cy) * z) / this.K.fy;
    return { pos: { x, y, z } as Vec3, u, v, distance: Math.hypot(x, y, z), azimuthDeg: (Math.atan2(x, z) * 180) / Math.PI };
  }

  private createTrack(det: Detection, tSec: number): InternalTrack {
    const { pos, u, v, distance, azimuthDeg } = this.project(det.bbox, det.classLabel);
    const pub: TrackedPerson = {
      id: `p${this.nextId++}`,
      name: null,
      bbox: [...det.bbox] as [number, number, number, number],
      centerPx: { u, v },
      position: pos,
      distanceM: distance,
      azimuthDeg,
      posture: postureFromBbox(det.bbox),
      activity: 0,
      activityLabel: "unknown",
      classLabel: det.classLabel,
      confidence: det.score,
      firstSeenSec: tSec,
      lastSeenSec: tSec,
    };
    return { pub, history: [{ tSec, cx: pos.x, cz: pos.z }] };
  }

  private updateTrack(trk: InternalTrack, det: Detection, tSec: number): void {
    const { pos, u, v, distance, azimuthDeg } = this.project(det.bbox, det.classLabel);
    const p = trk.pub;
    p.bbox = [...det.bbox] as [number, number, number, number];
    p.centerPx = { u, v };
    p.position = pos;
    p.distanceM = distance;
    p.azimuthDeg = azimuthDeg;
    p.posture = postureFromBbox(det.bbox);
    p.confidence = det.score;
    p.classLabel = det.classLabel;
    p.lastSeenSec = tSec;
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
