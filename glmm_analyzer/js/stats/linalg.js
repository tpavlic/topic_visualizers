// Dense linear algebra for the fitters: matrices as arrays of Float64Array
// rows, the Cholesky factorization and its solves, the inverse from the
// factor, weighted cross products, and the rank check that finds a design
// matrix's aliased columns. Everything here is small (a design of a few
// dozen columns) and so clarity beats speed. Pure functions, no DOM.

/**
 * A zero matrix of `r` rows and `c` columns.
 * @param {number} r
 * @param {number} c
 * @returns {Float64Array[]}
 */
export function zeros(r, c) {
  const out = new Array(r);
  for (let i = 0; i < r; i++) out[i] = new Float64Array(c);
  return out;
}

/** The identity of order n. */
export function identity(n) {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

/** A copy of a matrix. */
export function copy(A) {
  return A.map(r => Float64Array.from(r));
}

/** The transpose of a matrix. */
export function transpose(A) {
  const r = A.length, c = r ? A[0].length : 0;
  const T = zeros(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = A[i][j];
  return T;
}

/**
 * X'WX for a design X (n rows) and weights w (n), or X'X when w is null.
 * @param {Float64Array[]} X
 * @param {ArrayLike<number>|null} w
 * @returns {Float64Array[]} p by p, symmetric
 */
export function crossprod(X, w = null) {
  const n = X.length, p = n ? X[0].length : 0;
  const A = zeros(p, p);
  for (let i = 0; i < n; i++) {
    const xi = X[i], wi = w ? w[i] : 1;
    if (wi === 0) continue;
    for (let a = 0; a < p; a++) {
      const xa = xi[a] * wi;
      if (xa === 0) continue;
      const row = A[a];
      for (let b = a; b < p; b++) row[b] += xa * xi[b];
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) A[a][b] = A[b][a];
  return A;
}

/**
 * X'Wz for a design X, weights w (or null), and a vector z.
 * @param {Float64Array[]} X
 * @param {ArrayLike<number>|null} w
 * @param {ArrayLike<number>} z
 * @returns {Float64Array} length p
 */
export function crossprodVec(X, w, z) {
  const n = X.length, p = n ? X[0].length : 0;
  const v = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    const s = (w ? w[i] : 1) * z[i];
    if (s === 0) continue;
    const xi = X[i];
    for (let a = 0; a < p; a++) v[a] += xi[a] * s;
  }
  return v;
}

/**
 * X times a vector b.
 * @param {Float64Array[]} X
 * @param {ArrayLike<number>} b
 * @returns {Float64Array}
 */
export function matvec(X, b) {
  const n = X.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const xi = X[i];
    let s = 0;
    for (let a = 0; a < xi.length; a++) s += xi[a] * b[a];
    out[i] = s;
  }
  return out;
}

/** A times B for matrices. */
export function matmul(A, B) {
  const r = A.length, k = B.length, c = k ? B[0].length : 0;
  const C = zeros(r, c);
  for (let i = 0; i < r; i++) {
    const ai = A[i], ci = C[i];
    for (let t = 0; t < k; t++) {
      const a = ai[t];
      if (a === 0) continue;
      const bt = B[t];
      for (let j = 0; j < c; j++) ci[j] += a * bt[j];
    }
  }
  return C;
}

/**
 * The lower Cholesky factor L of a symmetric positive-definite matrix,
 * A = L L'. Returns null when A is not positive definite (a pivot at or
 * below `tol` times the largest diagonal entry).
 * @param {Float64Array[]} A
 * @param {number} [tol]
 * @returns {Float64Array[]|null}
 */
export function cholesky(A, tol = 1e-13) {
  const n = A.length;
  const L = zeros(n, n);
  let maxDiag = 0;
  for (let i = 0; i < n; i++) if (A[i][i] > maxDiag) maxDiag = A[i][i];
  for (let j = 0; j < n; j++) {
    let s = A[j][j];
    for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k];
    if (!(s > tol * maxDiag)) return null;
    const d = Math.sqrt(s);
    L[j][j] = d;
    for (let i = j + 1; i < n; i++) {
      let t = A[i][j];
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
      L[i][j] = t / d;
    }
  }
  return L;
}

/**
 * Solves A x = b from the Cholesky factor L of A.
 * @param {Float64Array[]} L
 * @param {ArrayLike<number>} b
 * @returns {Float64Array}
 */
export function cholSolve(L, b) {
  const n = L.length;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/**
 * The inverse of A from its Cholesky factor.
 * @param {Float64Array[]} L
 * @returns {Float64Array[]}
 */
export function cholInverse(L) {
  const n = L.length;
  const inv = zeros(n, n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    e.fill(0); e[j] = 1;
    const col = cholSolve(L, e);
    for (let i = 0; i < n; i++) inv[i][j] = col[i];
  }
  // Symmetrize against rounding.
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) { const m = 0.5 * (inv[i][j] + inv[j][i]); inv[i][j] = m; inv[j][i] = m; }
  return inv;
}

/**
 * The log of the determinant of A from its Cholesky factor.
 * @param {Float64Array[]} L
 */
export function cholLogDet(L) {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += Math.log(L[i][i]);
  return 2 * s;
}

/**
 * Solves A x = b for a symmetric positive-definite A; throws when A is not.
 * @param {Float64Array[]} A
 * @param {ArrayLike<number>} b
 */
export function solveSpd(A, b) {
  const L = cholesky(A);
  if (!L) throw new Error('The matrix is not positive definite.');
  return cholSolve(L, b);
}

/**
 * The columns of X that are linearly independent of the columns before
 * them, found by Gram–Schmidt in column order, as R's pivoted QR keeps the
 * earlier of two aliased columns. A column whose residual norm is at most
 * `tol` times its own norm (or that is all zero) is aliased.
 * @param {Float64Array[]} X n by p
 * @param {number} [tol]
 * @returns {{ keep: number[], drop: number[] }}
 */
export function independentColumns(X, tol = 1e-7) {
  const n = X.length, p = n ? X[0].length : 0;
  const basis = [];
  const keep = [], drop = [];
  for (let j = 0; j < p; j++) {
    const v = new Float64Array(n);
    let norm0 = 0;
    for (let i = 0; i < n; i++) { v[i] = X[i][j]; norm0 += v[i] * v[i]; }
    norm0 = Math.sqrt(norm0);
    if (norm0 === 0) { drop.push(j); continue; }
    // Two passes of orthogonalization for stability.
    for (let pass = 0; pass < 2; pass++) {
      for (const q of basis) {
        let d = 0;
        for (let i = 0; i < n; i++) d += q[i] * v[i];
        for (let i = 0; i < n; i++) v[i] -= d * q[i];
      }
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm <= tol * norm0) { drop.push(j); continue; }
    for (let i = 0; i < n; i++) v[i] /= norm;
    basis.push(v);
    keep.push(j);
  }
  return { keep, drop };
}

/**
 * The matrix with only the given columns of X, in that order.
 * @param {Float64Array[]} X
 * @param {number[]} cols
 */
export function selectColumns(X, cols) {
  return X.map(r => Float64Array.from(cols, j => r[j]));
}
