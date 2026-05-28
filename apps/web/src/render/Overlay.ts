import type { Detection } from "@avt/contracts";
import type { SearchEllipse } from "@avt/fusion";
import type { TrackedPerson } from "../tracking/MultiTracker.js";
import { coverFit, thermalColor, rgba } from "./visuals.js";
import { t } from "../i18n/i18n.js";

/**
 * Full-screen 2D monitoring overlay. Paints a thermal-camera-style heat blob on
 * each detected living thing (unmistakable indication), plus a crisp bounding
 * box, class + confidence label, and the EKF search ellipse during
 * re-acquisition. Maps camera-frame pixels to screen with object-fit: cover.
 */
export class Overlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable for overlay");
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  /**
   * Multi-person rendering: thermal blob, targeting box, and a stacked label
   * with the name (or ID), class+confidence, posture and activity. Maps
   * camera-frame pixels to screen with object-fit: cover.
   */
  drawPersons(persons: TrackedPerson[], srcW: number, srcH: number, tSec: number, primaryId?: string | null): void {
    const { s, ox, oy } = coverFit(srcW, srcH, window.innerWidth, window.innerHeight);
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(tSec * 4);

    for (const p of persons) {
      const [x0, y0, x1, y1] = p.bbox;
      const x = ox + x0 * s;
      const y = oy + y0 * s;
      const w = (x1 - x0) * s;
      const h = (y1 - y0) * s;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rad = Math.max(w, h) * 0.62;
      const isPrimary = p.id === primaryId;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.05, cx, cy, rad);
      g.addColorStop(0.0, rgba(thermalColor(0.0), 0.85));
      g.addColorStop(0.25, rgba(thermalColor(0.28), 0.6));
      g.addColorStop(0.55, rgba(thermalColor(0.55), 0.34));
      g.addColorStop(0.8, rgba(thermalColor(0.8), 0.16));
      g.addColorStop(1.0, rgba(thermalColor(1.0), 0.0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad, rad * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = isPrimary ? "#ffffff" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = isPrimary ? 2.5 : 2;
      ctx.strokeRect(x, y, w, h);
      this.corners(x, y, w, h, isPrimary ? 18 + 4 * pulse : 12);

      // Stacked label: name (large) + meta lines.
      const title = p.name ?? p.id;
      const meta1 = `${p.classLabel.toUpperCase()} ${Math.round(p.confidence * 100)}%  ·  ${p.distanceM.toFixed(1)}m`;
      const meta2 = `${t(`posture.${p.posture}`)}  ·  ${t(`activity.${p.activityLabel}`)}`;
      ctx.font = "700 14px ui-sans-serif, system-ui, sans-serif";
      const titleW = ctx.measureText(title).width;
      ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
      const m1W = ctx.measureText(meta1).width;
      const m2W = ctx.measureText(meta2).width;
      const chipW = Math.max(titleW, m1W, m2W) + 14;
      const chipH = 46;
      const cyTop = y - chipH - 4 < 0 ? y + h + 4 : y - chipH - 4;
      ctx.fillStyle = isPrimary ? "rgba(37,232,192,0.95)" : "rgba(255,150,60,0.95)";
      this.roundRect(x, cyTop, chipW, chipH, 7);
      ctx.fill();
      ctx.fillStyle = "#04140f";
      ctx.font = "700 14px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(title, x + 7, cyTop + 16);
      ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(meta1, x + 7, cyTop + 30);
      ctx.fillText(meta2, x + 7, cyTop + 42);
    }
  }

  drawDetections(boxes: Detection[], srcW: number, srcH: number, tSec: number): void {
    const { s, ox, oy } = coverFit(srcW, srcH, window.innerWidth, window.innerHeight);
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(tSec * 4);

    for (const b of boxes) {
      const [x0, y0, x1, y1] = b.bbox;
      const x = ox + x0 * s;
      const y = oy + y0 * s;
      const w = (x1 - x0) * s;
      const h = (y1 - y0) * s;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const rad = Math.max(w, h) * 0.62;

      // Thermal heat blob (additive glow), hottest at the centroid.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.05, cx, cy, rad);
      g.addColorStop(0.0, rgba(thermalColor(0.0), 0.85));
      g.addColorStop(0.25, rgba(thermalColor(0.28), 0.6));
      g.addColorStop(0.55, rgba(thermalColor(0.55), 0.34));
      g.addColorStop(0.8, rgba(thermalColor(0.8), 0.16));
      g.addColorStop(1.0, rgba(thermalColor(1.0), 0.0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rad, rad * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Bright targeting box with animated corner accents.
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(x, y, w, h);
      ctx.globalAlpha = 1;
      this.corners(x, y, w, h, 16 + 4 * pulse);

      // Label chip.
      const tag = `${b.classLabel.toUpperCase()}  ${Math.round(b.score * 100)}%`;
      ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
      const tw = ctx.measureText(tag).width + 16;
      const ty = y - 26 < 0 ? y + 4 : y - 26;
      ctx.fillStyle = "rgba(255,150,60,0.92)";
      this.roundRect(x, ty, tw, 22, 6);
      ctx.fill();
      ctx.fillStyle = "#1a0a00";
      ctx.fillText(tag, x + 8, ty + 15);
    }
  }

  drawSearchEllipse(e: SearchEllipse, srcW: number, srcH: number): void {
    if (!e.valid) return;
    const { s, ox, oy } = coverFit(srcW, srcH, window.innerWidth, window.innerHeight);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ox + e.centerU * s, oy + e.centerV * s);
    ctx.rotate(e.angleRad);
    ctx.strokeStyle = "#ffce5c";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(e.semiMajor * s, 6), Math.max(e.semiMinor * s, 6), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
  }

  private corners(x: number, y: number, w: number, h: number, len: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = "#25e8c0";
    ctx.lineWidth = 3;
    const c: Array<[number, number, number, number]> = [
      [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
    ];
    for (const [px, py, sx, sy] of c) {
      ctx.beginPath();
      ctx.moveTo(px, py + sy * len);
      ctx.lineTo(px, py);
      ctx.lineTo(px + sx * len, py);
      ctx.stroke();
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
