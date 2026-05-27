/** Pure visual helpers (no DOM) so they can be unit-tested headlessly. */

export interface CoverFit {
  /** Scale from source pixels to screen pixels. */
  s: number;
  /** Screen-space offset of the source origin. */
  ox: number;
  oy: number;
}

/** object-fit: cover mapping from a source (camera) rect onto the screen. */
export function coverFit(srcW: number, srcH: number, dstW: number, dstH: number): CoverFit {
  const s = Math.max(dstW / srcW, dstH / srcH);
  return { s, ox: (dstW - srcW * s) / 2, oy: (dstH - srcH * s) / 2 };
}

const RAMP: ReadonlyArray<[number, number, number]> = [
  [255, 255, 245], // hottest — white
  [255, 214, 92], // yellow
  [255, 122, 40], // orange
  [214, 48, 80], // red
  [120, 36, 140], // magenta
  [40, 70, 170], // blue
  [16, 22, 60], // coldest — deep blue
];

/**
 * Thermal-camera color ramp. `t` in [0,1]: 0 = hottest (white/yellow),
 * 1 = coldest (deep blue). Returns an [r,g,b] triple in 0..255.
 */
export function thermalColor(t: number): [number, number, number] {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  const seg = x * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export const rgba = (c: [number, number, number], alpha: number): string =>
  `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
