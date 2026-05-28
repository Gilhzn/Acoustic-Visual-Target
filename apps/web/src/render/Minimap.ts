/**
 * Top-down minimap showing where each tracked person sits relative to the phone.
 * Phone is at the bottom of the panel; +Z is forward (up the panel), +X right.
 * A fan illustrates the camera FOV with range arcs at 2 m increments. Device-only.
 */
export interface MinimapTrack {
  id: string;
  name: string | null;
  /** Camera-frame X in metres (right positive). */
  x: number;
  /** Camera-frame Z in metres (forward positive). */
  z: number;
  primary?: boolean;
  label?: string;
}

/** Pure helper: project a (x, z) point to panel pixels. Exposed for testing. */
export function panelProject(
  x: number,
  z: number,
  panelW: number,
  panelH: number,
  maxRangeM: number,
): { px: number; py: number } {
  const cx = panelW / 2;
  const cy = panelH - 16;
  const scale = (panelH - 24) / maxRangeM;
  return { px: cx + x * scale, py: cy - z * scale };
}

export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly maxRangeM = 12) {
    const c = canvas.getContext("2d");
    if (!c) throw new Error("2D context unavailable for minimap");
    this.ctx = c;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.floor(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.floor(this.canvas.clientHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(tracks: MinimapTrack[]): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const cx = w / 2;
    const cy = h - 16;
    const scale = (h - 24) / this.maxRangeM;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    // FOV fan (±30°).
    const fov = (30 * Math.PI) / 180;
    ctx.fillStyle = "rgba(37,232,192,0.04)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(fov) * this.maxRangeM * scale, cy - Math.cos(fov) * this.maxRangeM * scale);
    ctx.arc(cx, cy, this.maxRangeM * scale, -Math.PI / 2 - fov, -Math.PI / 2 + fov);
    ctx.closePath();
    ctx.fill();

    // Range arcs.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let r = 2; r <= this.maxRangeM; r += 2) {
      const pr = r * scale;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, -Math.PI / 2 - fov, -Math.PI / 2 + fov);
      ctx.stroke();
    }
    // FOV edges.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - Math.sin(fov) * this.maxRangeM * scale, cy - Math.cos(fov) * this.maxRangeM * scale);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(fov) * this.maxRangeM * scale, cy - Math.cos(fov) * this.maxRangeM * scale);
    ctx.stroke();

    // Range labels.
    ctx.fillStyle = "rgba(180,200,210,0.7)";
    ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
    for (let r = 2; r <= this.maxRangeM; r += 2) {
      ctx.fillText(`${r}m`, cx + 3, cy - r * scale + 9);
    }

    // Phone marker.
    ctx.fillStyle = "#25e8c0";
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // Tracks.
    for (const t of tracks) {
      const { px, py } = panelProject(t.x, t.z, w, h, this.maxRangeM);
      ctx.fillStyle = t.primary ? "#ff7a9c" : "#1de9b6";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(px, py, t.primary ? 6 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#eaf2f0";
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      const label = t.label ?? t.name ?? t.id;
      ctx.fillText(label, px + 8, py + 3);
    }
  }
}
