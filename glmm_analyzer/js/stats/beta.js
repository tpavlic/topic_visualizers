// Beta regression, as betareg fits it: the mean through a link, the
// precision φ as one parameter on its own scale, the log-likelihood of
// Ferrari and Cribari-Neto maximized by Fisher scoring on the expected
// information, which also gives the covariance betareg reports. Pure
// functions, no DOM.

import { FAMILIES, linkOf } from './families.js';
import { digamma, trigamma } from './negbin.js';
import { cholesky, cholSolve, cholInverse, zeros } from './linalg.js';

/**
 * Fits the beta regression.
 * @param {Float64Array} y in (0, 1)
 * @param {Float64Array[]} X n rows by p columns
 * @param {{ link?: string|null }} o
 * @returns {import('./glm.js').GlmFit & { phi: number, phiSe: number }}
 */
export function fitBeta(y, X, o = {}) {
  const link = linkOf('beta', o.link);
  const n = y.length, p = X[0].length;
  const fam = FAMILIES.beta;
  // Starting values: least squares on the linked response, and φ from the
  // residual variance, as betareg starts.
  const z = Float64Array.from(y, v => link.linkfun(v));
  let beta = lsq(X, z);
  let mu = Float64Array.from(X, x => link.linkinv(dot(x, beta)));
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (z[i] - dot(X[i], beta)) ** 2;
  const s2 = ss / Math.max(1, n - p);
  let phi = 0;
  for (let i = 0; i < n; i++) { const me = link.mu_eta(link.linkfun(mu[i])); phi += mu[i] * (1 - mu[i]) / (s2 * me * me) - 1; }
  phi = Math.max(phi / n, 0.5);
  const ll = (b, ph) => {
    const m = Float64Array.from(X, x => link.linkinv(dot(x, b)));
    return fam.logLik(y, m, ph, n);
  };
  let cur = ll(beta, phi);
  let converged = false, iter = 0;
  let K = null;
  const ystar = Float64Array.from(y, v => Math.log(v / (1 - v)));
  const ylog1 = Float64Array.from(y, v => Math.log(1 - v));
  for (iter = 1; iter <= 100; iter++) {
    const eta = Float64Array.from(X, x => dot(x, beta));
    mu = Float64Array.from(eta, e => link.linkinv(e));
    // The score and the expected information in (β, φ).
    const sb = new Float64Array(p);
    let sp = 0;
    K = zeros(p + 1, p + 1);
    for (let i = 0; i < n; i++) {
      const a = mu[i] * phi, b = (1 - mu[i]) * phi;
      const mustar = digamma(a) - digamma(b);
      const me = link.mu_eta(eta[i]);
      const ta = trigamma(a), tb = trigamma(b);
      const r = ystar[i] - mustar;
      for (let j = 0; j < p; j++) sb[j] += phi * r * me * X[i][j];
      sp += mu[i] * r + ylog1[i] - digamma(b) + digamma(phi);
      const w = phi * (ta + tb) * me * me;
      const c = phi * (ta * mu[i] - tb * (1 - mu[i]));
      const d = ta * mu[i] * mu[i] + tb * (1 - mu[i]) * (1 - mu[i]) - trigamma(phi);
      for (let j = 0; j < p; j++) {
        for (let k = 0; k < p; k++) K[j][k] += phi * w * X[i][j] * X[i][k];
        K[j][p] += me * c * X[i][j];
      }
      K[p][p] += d;
    }
    for (let j = 0; j < p; j++) K[p][j] = K[j][p];
    const L = cholesky(K);
    if (!L) break;
    const score = new Float64Array(p + 1);
    for (let j = 0; j < p; j++) score[j] = sb[j];
    score[p] = sp;
    const step = cholSolve(L, score);
    // Step halving on the log-likelihood, keeping φ positive.
    let t = 1, next = null, nb = null, np = NaN;
    for (let h = 0; h < 30; h++) {
      nb = Float64Array.from(beta, (v, j) => v + t * step[j]);
      np = phi + t * step[p];
      if (np > 0) { next = ll(nb, np); if (Number.isFinite(next) && next >= cur - 1e-12) break; }
      next = null;
      t /= 2;
    }
    if (next === null) break;
    const change = Math.abs(next - cur);
    beta = nb; phi = np; cur = next;
    let maxStep = Math.abs(t * step[p]);
    for (let j = 0; j < p; j++) maxStep = Math.max(maxStep, Math.abs(t * step[j]));
    if (change < 1e-10 && maxStep < 1e-7) { converged = true; break; }
  }
  // The covariance from the expected information at the solution.
  const eta = Float64Array.from(X, x => dot(x, beta));
  mu = Float64Array.from(eta, e => link.linkinv(e));
  K = zeros(p + 1, p + 1);
  for (let i = 0; i < n; i++) {
    const a = mu[i] * phi, b = (1 - mu[i]) * phi, me = link.mu_eta(eta[i]);
    const ta = trigamma(a), tb = trigamma(b);
    const w = phi * (ta + tb) * me * me, c = phi * (ta * mu[i] - tb * (1 - mu[i]));
    const d = ta * mu[i] * mu[i] + tb * (1 - mu[i]) * (1 - mu[i]) - trigamma(phi);
    for (let j = 0; j < p; j++) { for (let k = 0; k < p; k++) K[j][k] += phi * w * X[i][j] * X[i][k]; K[j][p] += me * c * X[i][j]; }
    K[p][p] += d;
  }
  for (let j = 0; j < p; j++) K[p][j] = K[j][p];
  const L = cholesky(K);
  const V = L ? cholInverse(L) : null;
  const vcov = V ? V.slice(0, p).map(r => Float64Array.from(r.slice(0, p))) : null;
  const phiSe = V ? Math.sqrt(V[p][p]) : NaN;
  const logLik = cur;
  const k = p + 1;
  const pearson = Float64Array.from(y, (v, i) => (v - mu[i]) / Math.sqrt(mu[i] * (1 - mu[i]) / (1 + phi)));
  const flags = converged ? [] : ['notConverged'];
  return { beta, vcov, eta, fitted: mu, weights: null, deviance: NaN, nullDeviance: NaN, logLik, aic: -2 * logLik + 2 * k, bic: -2 * logLik + k * Math.log(n),
    dispersion: 1, aux: phi, phi, phiSe, df: k, dfResidual: n - k, rank: p, n, iterations: iter, converged, hat: null, pearson, devianceResiduals: null, cooks: null,
    family: 'beta', link: link.id, flags };
}

function dot(x, b) { let s = 0; for (let j = 0; j < b.length; j++) s += x[j] * b[j]; return s; }

// Ordinary least squares, for starting values.
function lsq(X, z) {
  const p = X[0].length;
  const A = zeros(p, p), v = new Float64Array(p);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < p; a++) { v[a] += X[i][a] * z[i]; for (let b = 0; b < p; b++) A[a][b] += X[i][a] * X[i][b]; }
  }
  const L = cholesky(A);
  return L ? cholSolve(L, v) : new Float64Array(p);
}
