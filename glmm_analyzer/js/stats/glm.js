// Generalized linear models by iteratively reweighted least squares, as R's
// glm.fit does it: the family's starting values, the working response and
// weights at each step, convergence on the relative change in the deviance,
// step halving only where a step leaves the valid range, and the summary
// quantities (dispersion, covariance, hat values, Cook's distances, the
// log-likelihood, AIC, and BIC) with R's conventions. Pure functions, no
// DOM.

import { FAMILIES, linkOf } from './families.js';
import { crossprod, crossprodVec, cholesky, cholSolve, cholInverse, matvec } from './linalg.js';

/**
 * Iteration cap and convergence tolerance. R's glm.control stops at a
 * relative change in the deviance of 1e-8, which can leave a coefficient a
 * few parts in 1e-5 short of the maximum on a non-canonical link; the page
 * runs to 1e-12, and its R scripts set the same tolerance.
 */
export const GLM_MAXIT = 100;
export const GLM_EPS = 1e-12;

/**
 * @typedef {{ beta: Float64Array, vcov: Float64Array[], eta: Float64Array, fitted: Float64Array, weights: Float64Array,
 *   deviance: number, nullDeviance: number, logLik: number, aic: number, bic: number, dispersion: number, aux: number,
 *   df: number, dfResidual: number, rank: number, n: number, iterations: number, converged: boolean,
 *   hat: Float64Array, pearson: Float64Array, devianceResiduals: Float64Array, cooks: Float64Array,
 *   family: string, link: string, flags: string[] }} GlmFit
 */

/**
 * Fits a GLM.
 * @param {Float64Array} y
 * @param {Float64Array[]} X n rows by p columns, full rank
 * @param {{ family: string, link?: string|null, aux?: number, start?: Float64Array|null, maxit?: number, eps?: number }} o
 *   `aux` is the negative binomial's θ (fixed for this fit); `eps` the
 *   convergence tolerance (GLM_EPS by default).
 * @returns {GlmFit}
 */
export function fitGlm(y, X, o) {
  const fam = FAMILIES[o.family];
  const link = linkOf(o.family, o.link);
  const n = y.length, p = n ? X[0].length : 0;
  const aux = o.aux == null ? 1 : o.aux;
  const maxit = o.maxit || GLM_MAXIT;
  const flags = [];
  // Starting values: R's mustart from the family, then eta from it.
  let mu = Float64Array.from(y, v => fam.initialize(v));
  let eta = Float64Array.from(mu, m => link.linkfun(m));
  let beta = o.start ? Float64Array.from(o.start) : null;
  if (beta) { eta = matvec(X, beta); mu = Float64Array.from(eta, e => link.linkinv(e)); }
  const devOf = (mu_) => { let d = 0; for (let i = 0; i < n; i++) d += fam.devResid(y[i], mu_[i], aux); return d; };
  let dev = devOf(mu);
  let devold = dev;
  let converged = false, iter = 0;
  let w = new Float64Array(n);
  let L = null;
  for (iter = 1; iter <= maxit; iter++) {
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const me = link.mu_eta(eta[i]);
      z[i] = eta[i] + (y[i] - mu[i]) / me;
      w[i] = me * me / fam.variance(mu[i], aux);
    }
    const A = crossprod(X, w);
    L = cholesky(A);
    if (!L) { flags.push('singular'); break; }
    const b = crossprodVec(X, w, z);
    const betaNew = cholSolve(L, b);
    let etaNew = matvec(X, betaNew);
    let muNew = Float64Array.from(etaNew, e => link.linkinv(e));
    let devNew = devOf(muNew);
    // Step halving where the step leaves the valid range (R halves on a
    // non-finite deviance or an invalid eta or mu, not on an increase).
    let halvings = 0;
    while ((!Number.isFinite(devNew) || muNew.some(m => !Number.isFinite(m) || !validMu(fam.id, m))) && beta && halvings < 20) {
      halvings++;
      for (let j = 0; j < p; j++) betaNew[j] = (betaNew[j] + beta[j]) / 2;
      etaNew = matvec(X, betaNew);
      muNew = Float64Array.from(etaNew, e => link.linkinv(e));
      devNew = devOf(muNew);
    }
    beta = betaNew; eta = etaNew; mu = muNew; dev = devNew;
    if (Math.abs(dev - devold) / (Math.abs(dev) + 0.1) < (o.eps || GLM_EPS)) { converged = true; break; }
    devold = dev;
  }
  if (!converged) flags.push('notConverged');
  // The weights, the covariance, and the hat values come from the last
  // step's working weights, as R's summary.glm takes them from the last
  // QR decomposition rather than recomputing them at the converged mu.
  const XtWXinv = L ? cholInverse(L) : null;
  const dfResidual = n - p;
  // Dispersion: the Pearson estimate for a family with a free scale, from
  // the working residuals and the last weights as summary.glm forms it, and
  // 1 otherwise.
  let dispersion = 1;
  const pearson = new Float64Array(n);
  for (let i = 0; i < n; i++) pearson[i] = (y[i] - mu[i]) / Math.sqrt(fam.variance(mu[i], aux));
  if (fam.dispersion === 'estimated') {
    let s = 0;
    for (let i = 0; i < n; i++) { const r = (y[i] - mu[i]) / link.mu_eta(eta[i]); s += w[i] * r * r; }
    dispersion = dfResidual > 0 ? s / dfResidual : NaN;
  }
  const vcov = XtWXinv ? XtWXinv.map(r => Float64Array.from(r, v => v * dispersion)) : null;
  // Hat values: diag(sqrt(W) X (X'WX)^-1 X' sqrt(W)).
  const hat = new Float64Array(n);
  if (XtWXinv) {
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let s = 0;
      for (let a = 0; a < p; a++) { let t = 0; for (let b = 0; b < p; b++) t += XtWXinv[a][b] * xi[b]; s += xi[a] * t; }
      hat[i] = s * w[i];
    }
  }
  const devianceResiduals = Float64Array.from(y, (v, i) => Math.sign(v - mu[i]) * Math.sqrt(Math.max(0, fam.devResid(v, mu[i], aux))));
  const cooks = Float64Array.from(hat, (h, i) => { const r = pearson[i] / (1 - h); return r * r * h / (dispersion * p); });
  // The null deviance: the intercept-only model's mean is the mean of y.
  let ybar = 0;
  for (let i = 0; i < n; i++) ybar += y[i];
  ybar /= n;
  let nullDeviance = 0;
  for (let i = 0; i < n; i++) nullDeviance += fam.devResid(y[i], ybar, aux);
  const logLik = fam.logLik(y, mu, fam.id === 'normal' ? dev / n : fam.id === 'gamma' ? dev / n : aux, n);
  const k = p + fam.aic_extra;
  const aic = -2 * logLik + 2 * k;
  const bic = -2 * logLik + k * Math.log(n);
  if (fam.id === 'binomial' && mu.some(m => m < 1e-8 || m > 1 - 1e-8)) flags.push('separation');
  return { beta, vcov, eta, fitted: mu, weights: w, deviance: dev, nullDeviance, logLik, aic, bic, dispersion, aux, df: k, dfResidual, rank: p, n,
    iterations: iter, converged, hat, pearson, devianceResiduals, cooks, family: fam.id, link: link.id, flags };
}

function validMu(familyId, m) {
  if (familyId === 'binomial' || familyId === 'beta') return m > 0 && m < 1;
  if (familyId === 'poisson' || familyId === 'negbin' || familyId === 'gamma') return m > 0;
  return true;
}
