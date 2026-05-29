/**
 * Structurally identical to MultiTracker's Posture — declared here to avoid a
 * circular import from MultiTracker (which consumes us).
 */
type Posture = "standing" | "sitting" | "lying" | "unknown";

/** One keypoint from MoveNet (image coordinates). */
export interface Keypoint {
  name: string;
  x: number;
  y: number;
  score: number;
}

interface XY {
  x: number;
  y: number;
}

const MIN_SCORE = 0.3;

function pick(kps: ReadonlyArray<Keypoint>, name: string): XY | null {
  for (const k of kps) if (k.name === name && k.score >= MIN_SCORE) return { x: k.x, y: k.y };
  return null;
}

function avg(...pts: Array<XY | null>): XY | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of pts) {
    if (!p) continue;
    sx += p.x;
    sy += p.y;
    n++;
  }
  return n > 0 ? { x: sx / n, y: sy / n } : null;
}

/**
 * Posture from MoveNet keypoints — a real, joint-angle-based classifier instead
 * of the bbox-aspect heuristic. Uses shoulder/hip/knee/ankle in image space
 * (y increases downward) to decide standing / sitting / lying.
 */
export function postureFromKeypoints(kps: ReadonlyArray<Keypoint>): Posture {
  const shoulder = avg(pick(kps, "left_shoulder"), pick(kps, "right_shoulder"));
  const hip = avg(pick(kps, "left_hip"), pick(kps, "right_hip"));
  const knee = avg(pick(kps, "left_knee"), pick(kps, "right_knee"));
  const ankle = avg(pick(kps, "left_ankle"), pick(kps, "right_ankle"));

  if (!shoulder || !hip) return "unknown";

  const points: XY[] = [shoulder, hip];
  if (knee) points.push(knee);
  if (ankle) points.push(ankle);

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const verticalSpan = Math.max(...ys) - Math.min(...ys);
  const horizontalSpan = Math.max(...xs) - Math.min(...xs);

  // Body more horizontal than vertical → lying.
  if (verticalSpan < 1 || horizontalSpan > verticalSpan * 1.2) return "lying";

  // We need knee + ankle for the seat/stand distinction.
  if (!knee || !ankle) return "standing";

  // Vertical projection of thigh vs shin.
  const thigh = Math.abs(knee.y - hip.y);
  const shin = Math.abs(ankle.y - knee.y);

  // Sitting: hip and knee at similar y (thigh y-extent collapses).
  if (thigh < shin * 0.4) return "sitting";

  return "standing";
}

/** Tight bounding box around the confident keypoints (used to match poses to tracks). */
export function bboxFromKeypoints(kps: ReadonlyArray<Keypoint>): [number, number, number, number] {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const k of kps) {
    if (k.score < 0.2) continue;
    if (k.x < xMin) xMin = k.x;
    if (k.y < yMin) yMin = k.y;
    if (k.x > xMax) xMax = k.x;
    if (k.y > yMax) yMax = k.y;
  }
  if (xMin === Infinity) return [0, 0, 0, 0];
  return [xMin, yMin, xMax, yMax];
}
