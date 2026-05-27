/**
 * Minimal dense linear algebra on row-major Float64Array. Dimensions are passed
 * explicitly. Sizes here are tiny (≤6×6) so clarity is favoured; callers supply
 * output buffers to avoid per-update allocation.
 */
export type Mat = Float64Array;
export type Vec = Float64Array;

export function identity(out: Mat, n: number): Mat {
  out.fill(0);
  for (let i = 0; i < n; i++) out[i * n + i] = 1;
  return out;
}

/** out(ar×bc) = a(ar×ac) · b(br=ac × bc). */
export function mul(
  a: Mat,
  ar: number,
  ac: number,
  b: Mat,
  bc: number,
  out: Mat,
): Mat {
  for (let i = 0; i < ar; i++) {
    for (let j = 0; j < bc; j++) {
      let s = 0;
      for (let k = 0; k < ac; k++) s += a[i * ac + k] * b[k * bc + j];
      out[i * bc + j] = s;
    }
  }
  return out;
}

/** out(ac×ar) = a(ar×ac)ᵀ. */
export function transpose(a: Mat, ar: number, ac: number, out: Mat): Mat {
  for (let i = 0; i < ar; i++) {
    for (let j = 0; j < ac; j++) out[j * ar + i] = a[i * ac + j];
  }
  return out;
}

/** out = a + b (elementwise, length n). */
export function add(a: Mat, b: Mat, n: number, out: Mat): Mat {
  for (let i = 0; i < n; i++) out[i] = a[i] + b[i];
  return out;
}

/** out = a - b (elementwise, length n). */
export function sub(a: Mat, b: Mat, n: number, out: Mat): Mat {
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
  return out;
}

/** out(ar×bc) = a · bᵀ, where b is bc×ac (so bᵀ is ac×bc). */
export function mulABt(
  a: Mat,
  ar: number,
  ac: number,
  b: Mat,
  br: number,
  out: Mat,
): Mat {
  for (let i = 0; i < ar; i++) {
    for (let j = 0; j < br; j++) {
      let s = 0;
      for (let k = 0; k < ac; k++) s += a[i * ac + k] * b[j * ac + k];
      out[i * br + j] = s;
    }
  }
  return out;
}

/**
 * In-place matrix inverse via Gauss-Jordan with partial pivoting. `a` (n×n) is
 * copied into a working buffer; `out` receives the inverse. Returns false if
 * singular. `work` must be length 2·n·n.
 */
export function invert(a: Mat, n: number, out: Mat, work: Float64Array): boolean {
  const m = 2 * n;
  // Augmented [a | I].
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) work[i * m + j] = a[i * n + j];
    for (let j = 0; j < n; j++) work[i * m + n + j] = i === j ? 1 : 0;
  }
  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let piv = col;
    let best = Math.abs(work[col * m + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(work[r * m + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-15) return false;
    if (piv !== col) {
      for (let j = 0; j < m; j++) {
        const t = work[col * m + j];
        work[col * m + j] = work[piv * m + j];
        work[piv * m + j] = t;
      }
    }
    const d = work[col * m + col];
    const invD = 1 / d;
    for (let j = 0; j < m; j++) work[col * m + j] *= invD;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = work[r * m + col];
      if (f === 0) continue;
      for (let j = 0; j < m; j++) work[r * m + j] -= f * work[col * m + j];
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) out[i * n + j] = work[i * m + n + j];
  }
  return true;
}

/** Quadratic form yᵀ M⁻¹ y for an n-vector y and n×n M (uses provided scratch). */
export function quadFormInv(
  y: Vec,
  Minv: Mat,
  n: number,
): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    let row = 0;
    for (let j = 0; j < n; j++) row += Minv[i * n + j] * y[j];
    s += y[i] * row;
  }
  return s;
}
