import type { Detection, TrackState } from "@avt/contracts";
import type { SearchEllipse } from "@avt/fusion";
import type { ArScene } from "./ArScene.js";
import type { Overlay } from "./Overlay.js";
import type { Waterfall } from "./Waterfall.js";
import { tweenPosition } from "./gsapTween.js";
import { cameraFrameToView } from "./coords.js";

/**
 * Facade between the fusion outputs and the visual layers. Tweens the 3D target
 * (GSAP, via mutable refs — never React state), frustum-culls it, and redraws
 * the 2D monitoring overlay + spectrogram each frame.
 */
export class RenderAdapter {
  private boxes: Detection[] = [];
  private ellipse: SearchEllipse | null = null;
  private camW = 1280;
  private camH = 720;

  constructor(
    private readonly scene: ArScene,
    private readonly overlay: Overlay,
    private readonly waterfall: Waterfall,
  ) {}

  setCameraSize(w: number, h: number): void {
    this.camW = w || this.camW;
    this.camH = h || this.camH;
  }

  onTrack(ts: TrackState): void {
    tweenPosition(this.scene.target, cameraFrameToView(ts.position));
    const inView = this.scene.isTargetInFrustum();
    this.scene.setTargetVisible(ts.tracked && inView);
  }

  onDetections(boxes: Detection[]): void {
    this.boxes = boxes;
  }

  onSearchEllipse(e: SearchEllipse | null): void {
    this.ellipse = e;
  }

  onProfile(mags: Float32Array): void {
    this.waterfall.push(mags);
  }

  /** Redraw the 2D detection/ellipse overlay; call once per render frame. */
  tick(): void {
    this.overlay.clear();
    this.overlay.drawDetections(this.boxes, this.camW, this.camH);
    if (this.ellipse) this.overlay.drawSearchEllipse(this.ellipse, this.camW, this.camH);
  }
}
