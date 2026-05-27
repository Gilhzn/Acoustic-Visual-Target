import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { Detection, Detector, FrameLike } from "@avt/contracts";
import type { InferenceBackend } from "./capability.js";

export interface TfjsDetectorOpts {
  backend?: InferenceBackend;
  /** Restrict to these COCO classes (e.g. person/cat/dog). Empty = all. */
  classes?: string[];
  maxBoxes?: number;
  minScore?: number;
  /** coco-ssd base: mobilenet_v2 is more accurate, lite_mobilenet_v2 fastest. */
  base?: "mobilenet_v1" | "mobilenet_v2" | "lite_mobilenet_v2";
}

type PixelSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageData;

/**
 * TF.js object detector (SSD-MobileNetV2 via coco-ssd) with WebGPU→WebGL→CPU
 * backend fallback, shader warm-up, and optional ROI cropping to the EKF search
 * ellipse for fast re-acquisition. Device-only (needs a GPU/browser).
 */
export class TfjsDetector implements Detector {
  readonly name = "coco-ssd";
  private model: cocoSsd.ObjectDetection | null = null;
  private readonly opts: Required<TfjsDetectorOpts>;
  private roi: [number, number, number, number] | null = null;
  private roiCanvas: HTMLCanvasElement | null = null;
  activeBackend = "unknown";

  constructor(opts: TfjsDetectorOpts = {}) {
    this.opts = {
      backend: opts.backend ?? "webgl",
      classes: opts.classes ?? ["person", "cat", "dog"],
      maxBoxes: opts.maxBoxes ?? 5,
      minScore: opts.minScore ?? 0.5,
      base: opts.base ?? "mobilenet_v2",
    };
  }

  /** Restrict subsequent detection to a rectangle [x,y,w,h] (the search ROI). */
  setRoi(roi: [number, number, number, number] | null): void {
    this.roi = roi;
  }

  async warmup(): Promise<void> {
    await this.selectBackend(this.opts.backend);
    this.model = await cocoSsd.load({ base: this.opts.base });
    // Pre-compile shaders via the real pixel path: a filled canvas is a valid
    // upload source (a context-less or float32 tensor source would be rejected).
    const warm = document.createElement("canvas");
    warm.width = 64;
    warm.height = 64;
    const g = warm.getContext("2d");
    if (g) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, 64, 64);
    }
    await this.model.detect(warm);
  }

  async detect(frame: FrameLike): Promise<Detection[]> {
    if (!this.model) return [];
    let input = frame.source as PixelSource;
    let offX = 0;
    let offY = 0;
    if (this.roi) {
      const [rx, ry, rw, rh] = this.roi;
      const canvas = this.ensureRoiCanvas(Math.ceil(rw), Math.ceil(rh));
      const g = canvas.getContext("2d");
      if (g) {
        g.drawImage(input as CanvasImageSource, rx, ry, rw, rh, 0, 0, rw, rh);
        input = canvas;
        offX = rx;
        offY = ry;
      }
    }
    const preds = await this.model.detect(input, this.opts.maxBoxes, this.opts.minScore);
    const out: Detection[] = [];
    for (const p of preds) {
      if (this.opts.classes.length && !this.opts.classes.includes(p.class)) continue;
      const [x, y, w, h] = p.bbox;
      out.push({ bbox: [x + offX, y + offY, x + offX + w, y + offY + h], score: p.score, classLabel: p.class });
    }
    return out;
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
  }

  private ensureRoiCanvas(w: number, h: number): HTMLCanvasElement {
    if (!this.roiCanvas) this.roiCanvas = document.createElement("canvas");
    if (this.roiCanvas.width !== w) this.roiCanvas.width = w;
    if (this.roiCanvas.height !== h) this.roiCanvas.height = h;
    return this.roiCanvas;
  }

  private async selectBackend(pref: InferenceBackend): Promise<void> {
    const order = pref === "webgpu" ? ["webgpu", "webgl", "cpu"] : pref === "webgl" ? ["webgl", "cpu"] : ["webgl", "cpu"];
    for (const b of order) {
      try {
        if (await tf.setBackend(b)) {
          await tf.ready();
          this.activeBackend = b;
          return;
        }
      } catch {
        // try next backend
      }
    }
    await tf.ready();
    this.activeBackend = tf.getBackend();
  }
}
