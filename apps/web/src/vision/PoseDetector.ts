import * as tf from "@tensorflow/tfjs";
import * as poseDetection from "@tensorflow-models/pose-detection";
import type { FrameLike } from "@avt/contracts";
import type { Keypoint } from "../tracking/poseClassifier.js";
import { bboxFromKeypoints } from "../tracking/poseClassifier.js";

export interface Pose {
  keypoints: Keypoint[];
  bbox: [number, number, number, number];
  score: number;
}

/**
 * MoveNet MultiPose Lightning pose detector. Returns up to 6 poses per frame
 * with 17 COCO keypoints each (~30 ms on a modern phone). Device-only — wraps
 * `@tensorflow-models/pose-detection`.
 */
export class PoseDetector {
  readonly name = "movenet-multipose";
  activeBackend = "unknown";
  private detector: poseDetection.PoseDetector | null = null;

  async warmup(): Promise<void> {
    if (tf.getBackend() !== "webgl") {
      try {
        await tf.setBackend("webgl");
        await tf.ready();
      } catch {
        /* tf already initialized by the coco-ssd detector */
      }
    }
    this.activeBackend = tf.getBackend();
    this.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: false,
    });
    // Pre-compile shaders with one blank-canvas pass.
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, 256, 256);
    }
    await this.detector.estimatePoses(c);
  }

  async detect(frame: FrameLike): Promise<Pose[]> {
    if (!this.detector) return [];
    const src = frame.source as poseDetection.PoseDetectorInput;
    const raw = await this.detector.estimatePoses(src, { flipHorizontal: false });
    const out: Pose[] = [];
    for (const p of raw) {
      const kps: Keypoint[] = [];
      for (const k of p.keypoints) {
        kps.push({ name: k.name ?? "", x: k.x, y: k.y, score: k.score ?? 0 });
      }
      const bbox: [number, number, number, number] = p.box
        ? [p.box.xMin, p.box.yMin, p.box.xMax, p.box.yMax]
        : bboxFromKeypoints(kps);
      out.push({ keypoints: kps, bbox, score: p.score ?? 1 });
    }
    return out;
  }

  dispose(): void {
    this.detector?.dispose();
    this.detector = null;
  }
}
