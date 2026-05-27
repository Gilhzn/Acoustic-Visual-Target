import { TWO_PI, clamp, type Meters, type Radians } from "@avt/core-units";

/** Phase of mic1 relative to mic0: arg(z1 · conj(z0)), wrapped to (-π, π]. */
export function phaseDiff(
  re0: number,
  im0: number,
  re1: number,
  im1: number,
): Radians {
  const cr = re1 * re0 + im1 * im0;
  const ci = im1 * re0 - re1 * im0;
  return Math.atan2(ci, cr) as Radians;
}

export interface AzimuthSolution {
  /** Principal solution (k=0). */
  theta: Radians;
  /** All physically valid aliases, sorted by |k| (theta first). */
  aliases: Radians[];
  ambiguous: boolean;
}

/**
 * Map a measured phase difference to azimuth via the plane-wave model
 *   Δφ = (2π/λ)·d·sin(θ).
 *
 * At near-ultrasonic wavelengths (λ≈1.7cm) a ~10cm baseline spans many half-
 * wavelengths, so the wrapped Δφ has multiple unwrapping aliases
 * Δφ → Δφ + 2πk. We enumerate every k that yields |sin(θ)| ≤ 1 and return them
 * all; fusion disambiguates using the camera bearing.
 */
export function pdoaToAzimuth(
  dPhi: Radians,
  baselineM: Meters,
  lambdaM: Meters,
): AzimuthSolution {
  const d = baselineM as number;
  const lambda = lambdaM as number;
  const phi = dPhi as number;
  // |Δφ + 2πk| ≤ B,  B = 2πd/λ  ⇔  |sin θ| ≤ 1
  const B = (TWO_PI * d) / lambda;

  const principal = Math.asin(clamp(phi / B, -1, 1)) as Radians;
  if (B <= Math.PI + 1e-9) {
    // Baseline ≤ λ/2: unambiguous.
    return { theta: principal, aliases: [principal], ambiguous: false };
  }

  const kMin = Math.ceil((-B - phi) / TWO_PI);
  const kMax = Math.floor((B - phi) / TWO_PI);
  const ks: number[] = [];
  for (let k = kMin; k <= kMax; k++) ks.push(k);
  ks.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);

  const aliases: Radians[] = [];
  for (const k of ks) {
    const s = (phi + TWO_PI * k) / B;
    aliases.push(Math.asin(clamp(s, -1, 1)) as Radians);
  }
  const theta = aliases.length > 0 ? aliases[0] : principal;
  return { theta, aliases, ambiguous: aliases.length > 1 };
}

/** Pick the alias closest to a reference bearing (e.g. the camera azimuth). */
export function disambiguate(aliases: Radians[], referenceRad: number): Radians {
  let best = aliases.length > 0 ? aliases[0] : (0 as Radians);
  let bestErr = Infinity;
  for (const a of aliases) {
    const e = Math.abs((a as number) - referenceRad);
    if (e < bestErr) {
      bestErr = e;
      best = a;
    }
  }
  return best;
}
