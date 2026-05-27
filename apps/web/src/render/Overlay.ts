import type { Detection } from "@avt/contracts";
import type { SearchEllipse } from "@avt/fusion";

/**
 * Full-screen 2D monitoring overlay: stylized detection boxes with class +
 * confidence tags, and the EKF search ellipse during re-acquisition. Maps
 * camera-frame pixels to the screen with object-fit: cover. Device-only.
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

  private fit(srcW: number, srcH: number): { s: number; ox: number; oy: number } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const s = Math.max(w / srcW, h / srcH); // cover
    return { s, ox: (w - srcW * s) / 2, oy: (h - srcH * s) / 2 };
  }

  drawDetections(boxes: Detection[], srcW: number, srcH: number): void {
    const { s, ox, oy } = this.fit(srcW, srcH);
    const ctx = this.ctx;
    ctx.lineWidth = 2;
    ctx.font = "13px ui-monospace, monospace";
    for (const b of boxes) {
      const [x0, y0, x1, y1] = b.bbox;
      const x = ox + x0 * s;
      const y = oy + y0 * s;
      const bw = (x1 - x0) * s;
      const bh = (y1 - y0) * s;
      ctx.strokeStyle = "#1de9b6";
      ctx.shadowColor = "#1de9b6";
      ctx.shadowBlur = 12;
      ctx.strokeRect(x, y, bw, bh);
      ctx.shadowBlur = 0;
      const tag = `${b.classLabel} ${(b.score * 100).toFixed(0)}%`;
      const tw = ctx.measureText(tag).width + 10;
      ctx.fillStyle = "#1de9b6";
      ctx.fillRect(x, y - 18, tw, 18);
      ctx.fillStyle = "#04121a";
      ctx.fillText(tag, x + 5, y - 5);
    }
  }

  drawSearchEllipse(e: SearchEllipse, srcW: number, srcH: number): void {
    if (!e.valid) return;
    const { s, ox, oy } = this.fit(srcW, srcH);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ox + e.centerU * s, oy + e.centerV * s);
    ctx.rotate(e.angleRad);
    ctx.strokeStyle = "#ffcf4d";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.max(e.semiMajor * s, 4), Math.max(e.semiMinor * s, 4), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
  }
}
