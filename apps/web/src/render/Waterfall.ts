/**
 * Neon range-profile waterfall. Each acoustic frame scrolls the canvas down one
 * row and paints the newest range profile across the top with an auto-gained
 * teal→cyan→white colormap. Device-side visualization (builds the user's trust
 * that the sonar is live). Pure 2D-canvas — no external deps.
 */
export class Waterfall {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h: number;
  private peak = 1e-6;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable for waterfall");
    this.ctx = ctx;
    this.w = canvas.width;
    this.h = canvas.height;
    this.ctx.fillStyle = "#02040a";
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  push(mags: Float32Array): void {
    // Scroll existing image down by one row.
    this.ctx.drawImage(this.ctx.canvas, 0, 1);
    // Track a decaying peak for auto-gain.
    let frameMax = 1e-6;
    for (let i = 0; i < mags.length; i++) if (mags[i] > frameMax) frameMax = mags[i];
    this.peak = Math.max(frameMax, this.peak * 0.97);
    const inv = 1 / this.peak;
    for (let x = 0; x < this.w; x++) {
      const bin = Math.floor((x / this.w) * mags.length);
      const v = Math.min(1, mags[bin] * inv);
      this.ctx.fillStyle = colormap(v);
      this.ctx.fillRect(x, 0, 1, 1);
    }
  }
}

function colormap(v: number): string {
  // 0 → dark, mid → teal/cyan, high → near-white cyan.
  const r = Math.round(40 * v + 200 * Math.max(0, v - 0.7) * 3.3);
  const g = Math.round(60 + 195 * v);
  const b = Math.round(70 + 150 * v);
  return `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`;
}

const clamp255 = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : x);
