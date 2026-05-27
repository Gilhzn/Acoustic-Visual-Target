/**
 * Chi-square gating on the Normalized Innovation Squared (NIS). A consistent
 * EKF has NIS ~ χ²(dof); measurements whose NIS exceeds the confidence
 * threshold are likely outliers (e.g. acoustic multipath ghosts) and rejected.
 */

// χ² critical values (upper-tail) for common dof and confidence levels.
const CHI2: Record<string, number> = {
  "1:0.95": 3.841,
  "2:0.95": 5.991,
  "3:0.95": 7.815,
  "1:0.99": 6.635,
  "2:0.99": 9.21,
  "3:0.99": 11.345,
};

export function chiSquareThreshold(dof: number, confidence: number): number {
  const key = `${dof}:${confidence}`;
  const v = CHI2[key];
  if (v !== undefined) return v;
  // Fallback: Wilson–Hilferty approximation of the χ² quantile.
  const z = confidence >= 0.99 ? 2.326 : confidence >= 0.95 ? 1.645 : 1.282;
  const t = 1 - 2 / (9 * dof) + z * Math.sqrt(2 / (9 * dof));
  return dof * t * t * t;
}

export function chiSquareGate(nis: number, dof: number, confidence: number): boolean {
  return nis <= chiSquareThreshold(dof, confidence);
}
