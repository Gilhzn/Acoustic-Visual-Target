import type { TrackState } from "@avt/contracts";
import type { SearchEllipse } from "@avt/fusion";
import type { ArScene } from "./ArScene.js";
import type { Overlay } from "./Overlay.js";
import type { Waterfall } from "./Waterfall.js";
import type { TrackedPerson } from "../tracking/MultiTracker.js";
import type { Minimap } from "./Minimap.js";
import { tweenPosition } from "./gsapTween.js";
import { cameraFrameToView } from "./coords.js";

/**
 * Facade between the fusion + multi-tracker outputs and the visual layers.
 * Tweens the 3D AR marker via mutable refs (no React state), redraws the
 * thermal/box overlay, the top-down minimap, and the spectrogram each frame.
 */
export class RenderAdapter {
  private persons: TrackedPerson[] = [];
  private primaryId: string | null = null;
  private ellipse: SearchEllipse | null = null;
  private camW = 1280;
  private camH = 720;

  constructor(
    private readonly scene: ArScene,
    private readonly overlay: Overlay,
    private readonly waterfall: Waterfall,
    private readonly minimap: Minimap | null = null,
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

  onPersons(persons: TrackedPerson[], primaryId: string | null): void {
    this.persons = persons;
    this.primaryId = primaryId;
  }

  onSearchEllipse(e: SearchEllipse | null): void {
    this.ellipse = e;
  }

  onProfile(mags: Float32Array): void {
    this.waterfall.push(mags);
  }

  /** Redraw the 2D overlay + minimap; call once per render frame. */
  tick(): void {
    this.overlay.clear();
    this.overlay.drawPersons(this.persons, this.camW, this.camH, performance.now() / 1000, this.primaryId);
    if (this.ellipse) this.overlay.drawSearchEllipse(this.ellipse, this.camW, this.camH);
    this.minimap?.draw(
      this.persons.map((p) => ({
        id: p.id,
        name: p.name,
        x: p.position.x,
        z: p.position.z,
        primary: p.id === this.primaryId,
        label: p.name ?? p.id,
      })),
    );
  }
}
