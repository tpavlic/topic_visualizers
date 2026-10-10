// The cumulative logit (proportional odds) model, as MASS::polr fits it:
// P(Y ≤ k) = F(ζ_k − x'β) with increasing thresholds ζ and no intercept in
// x, maximized by Newton's method on the analytic gradient and Hessian,
// whose inverse at the solution is the covariance. Pure functions, no DOM.

import { zeros, cholesky, cholSolve, cholInverse } from './linalg.js';

const F = t => (t >= 0 ? 1 / (1 + Math.exp(-t)) : Math.exp(t) / (1 + Math.exp(t)));
const f = t => { const p = F(t); return p * (1 - p); };
const fp = t => { const p = F(t); return p * (1 - p) * (1 - 2 * p); };

/**
 * Fits the proportional-odds model.
 * @param {Float64Array} y category indices 0..K−1
 * @param {Float64Array[]} X n rows by p columns, without an intercept
 * @param {number} K the number of categories
 * @returns {{ beta: Float64Array, zeta: Float64Array, vcov: Float64Array[], logLik: number, deviance: number, aic: number, bic: number,
 *   df: number, dfResidual: number, rank: number, n: number, iterations: number, converged: boolean, probs: Float64Array[],
 *   cumulative: (eta: number) => Float64Array, eta: Float64Array, fitted: Float64Array, flags: string[], family: string, link: string,
 *   dispersion: number, aux: number, hat: null, pearson: null, cooks: null, devianceResiduals: null, nullDeviance: number }}
 */
export function fitOrdinal(y, X, K) {
  const n = y.length, p = X.length ? X[0].length : 0, q = K - 1;
  // Starting values: β = 0 and ζ from the cumulative proportions, as polr.
  const counts = new Float64Array(K);
  for (let i = 0; i < n; i++) counts[y[i]]++;
  let theta = new Float64Array(p + q);
  let cum = 0;
  for (let k = 0; k < q; k++) { cum += counts[k]; const pr = Math.min(1 - 1e-6, Math.max(1e-6, cum / n)); theta[p + k] = Math.log(pr / (1 - pr)); }
  const dotB = (x, th) => { let s = 0; for (let j = 0; j < p; j++) s += x[j] * th[j]; return s; };
  const ll = th => {
    for (let k = 1; k < q; k++) if (!(th[p + k] > th[p + k - 1])) return -Infinity;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const e = dotB(X[i], th), k = y[i];
      const A = k < q ? F(th[p + k] - e) : 1, B = k > 0 ? F(th[p + k - 1] - e) : 0;
      const P = A - B;
      if (!(P > 0)) return -Infinity;
      s += Math.log(P);
    }
    return s;
  };
  // The gradient and Hessian of the log-likelihood in (β, ζ).
  const derivs = th => {
    const g = new Float64Array(p + q), H = zeros(p + q, p + q);
    for (let i = 0; i < n; i++) {
      const x = X[i], e = dotB(x, th), k = y[i];
      const hasA = k < q, hasB = k > 0;
      const A = hasA ? th[p + k] - e : Infinity, B = hasB ? th[p + k - 1] - e : -Infinity;
      const FA = hasA ? F(A) : 1, FB = hasB ? F(B) : 0, P = FA - FB;
      const fA = hasA ? f(A) : 0, fB = hasB ? f(B) : 0, fpA = hasA ? fp(A) : 0, fpB = hasB ? fp(B) : 0;
      // First derivatives of P with respect to η, ζ_k, ζ_{k−1}.
      const dPe = fB - fA, dPa = fA, dPb = -fB;
      // Second derivatives.
      const dPee = fpA - fpB, dPaa = fpA, dPbb = -fpB, dPea = -fpA, dPeb = fpB;
      // log P: gradient = dP/P, Hessian = d2P/P − (dP)(dP)'/P².
      const idx = [], dP = [], d2 = {};
      // Parameter slots: β through η (chain rule with x), ζ_k, ζ_{k−1}.
      for (let j = 0; j < p; j++) { idx.push(j); dP.push(dPe * x[j]); }
      if (hasA) { idx.push(p + k); dP.push(dPa); }
      if (hasB) { idx.push(p + k - 1); dP.push(dPb); }
      const m = idx.length;
      const second = (r, c) => {
        const ir = idx[r], ic = idx[c];
        const rb = ir < p, cb = ic < p;
        if (rb && cb) return dPee * x[ir] * x[ic];
        if (rb && !cb) return (ic === p + k && hasA ? dPea : dPeb) * x[ir];
        if (!rb && cb) return (ir === p + k && hasA ? dPea : dPeb) * x[ic];
        if (ir === ic) return ir === p + k && hasA ? dPaa : dPbb;
        return 0;
      };
      for (let r = 0; r < m; r++) {
        g[idx[r]] += dP[r] / P;
        for (let c = 0; c < m; c++) H[idx[r]][idx[c]] += second(r, c) / P - dP[r] * dP[c] / (P * P);
      }
    }
    return { g, H };
  };
  let cur = ll(theta);
  let converged = false, iter = 0;
  for (iter = 1; iter <= 100; iter++) {
    const { g, H } = derivs(theta);
    // Newton on the negative Hessian, which is positive definite near the solution.
    const negH = H.map(r => Float64Array.from(r, v => -v));
    let L = cholesky(negH);
    if (!L) {
      // Away from the solution, add a ridge until the matrix factors.
      let ridge = 1e-6;
      while (!L && ridge < 1e6) { const R = negH.map((r, a) => Float64Array.from(r, (v, b) => (a === b ? v + ridge : v))); L = cholesky(R); ridge *= 10; }
      if (!L) break;
    }
    const step = cholSolve(L, g);
    let t = 1, next = -Infinity, nt = null;
    for (let h = 0; h < 40; h++) {
      nt = Float64Array.from(theta, (v, j) => v + t * step[j]);
      next = ll(nt);
      if (Number.isFinite(next) && next >= cur - 1e-12) break;
      t /= 2;
    }
    if (!Number.isFinite(next)) break;
    const change = Math.abs(next - cur);
    let maxStep = 0;
    for (let j = 0; j < p + q; j++) maxStep = Math.max(maxStep, Math.abs(t * step[j]));
    theta = nt; cur = next;
    if (change < 1e-10 && maxStep < 1e-7) { converged = true; break; }
  }
  const { H } = derivs(theta);
  const L = cholesky(H.map(r => Float64Array.from(r, v => -v)));
  const vcov = L ? cholInverse(L) : null;
  const beta = Float64Array.from(theta.slice(0, p)), zeta = Float64Array.from(theta.slice(p));
  const cumulative = e => Float64Array.from(zeta, z => F(z - e));
  const eta = Float64Array.from(X, x => dotB(x, beta));
  const probs = Array.from(eta, e => { const c = cumulative(e); const out = new Float64Array(K); let prev = 0; for (let k = 0; k < q; k++) { out[k] = c[k] - prev; prev = c[k]; } out[q] = 1 - prev; return out; });
  const fitted = Float64Array.from(probs, pr => { let s = 0; for (let k = 0; k < K; k++) s += k * pr[k]; return s; });
  const k = p + q;
  const logLik = cur;
  const deviance = -2 * logLik;
  // The null deviance: the thresholds alone.
  let nullLL = 0;
  for (let c = 0; c < K; c++) if (counts[c] > 0) nullLL += counts[c] * Math.log(counts[c] / n);
  return { beta, zeta, vcov, logLik, deviance, nullDeviance: -2 * nullLL, aic: -2 * logLik + 2 * k, bic: -2 * logLik + k * Math.log(n), df: k, dfResidual: n - k, rank: p, n,
    iterations: iter, converged, probs, cumulative, eta, fitted, flags: converged ? [] : ['notConverged'], family: 'ordinal', link: 'logit', dispersion: 1, aux: 1,
    hat: null, pearson: null, cooks: null, devianceResiduals: null, weights: null };
}

/**
 * The category probabilities at new linear predictors.
 * @param {ReturnType<typeof fitOrdinal>} fit
 * @param {ArrayLike<number>} eta
 * @returns {Float64Array[]} one row per eta, one column per category
 */
export function ordinalProbs(fit, eta) {
  const K = fit.zeta.length + 1;
  return Array.from(eta, e => { const c = fit.cumulative(e); const out = new Float64Array(K); let prev = 0; for (let k = 0; k < K - 1; k++) { out[k] = c[k] - prev; prev = c[k]; } out[K - 1] = 1 - prev; return out; });
}
