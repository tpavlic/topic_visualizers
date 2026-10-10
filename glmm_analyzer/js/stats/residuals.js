// The residuals of a fit, gathered for the Diagnostics page and the
// scripts: the randomized quantile residuals with their seeded uniforms,
// the Pearson and deviance residuals, the hat values and Cook's distances
// where the fitter gives them, and the Pearson dispersion test for a family
// whose dispersion is fixed. Pure functions, no DOM.

import { FAMILIES, quantileResiduals } from './families.js';
import { normInv, chi2Cdf } from './special.js';

/** The seed the page draws the quantile residuals' uniforms from. */
export const RESIDUAL_SEED = 20261010;

/**
 * mulberry32: `n` uniforms from a 32-bit seed, the same sequence in the
 * page and in the exported scripts, which embed the numbers.
 * @param {number} n
 * @param {number} seed
 * @returns {Float64Array}
 */
export function uniforms(n, seed) {
  let a = seed >>> 0;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return out;
}

const EPS = 2.220446049250313e-16;

/**
 * Every residual a fit offers.
 * @param {object} result fitModel's output
 * @param {number} [seed]
 * @returns {{ quantile: Float64Array, uniforms: Float64Array|null, pearson: Float64Array|null, deviance: Float64Array|null,
 *   fitted: Float64Array, eta: Float64Array, hat: Float64Array|null, cooks: Float64Array|null,
 *   dispersion: { chisq: number, df: number, ratio: number, p: number }|null, aux: number }}
 */
export function residualSet(result, seed = RESIDUAL_SEED) {
  const fit = result.fit;
  const y = result.codedY || result.design.y;
  const n = y.length;
  const fam = FAMILIES[fit.family];
  let quantile, u = null;
  if (fit.family === 'ordinal') {
    // The cumulative probabilities bracket the observed category.
    u = uniforms(n, seed);
    quantile = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = fit.cumulative(fit.eta[i]);
      const k = y[i];
      const hi = k < c.length ? c[k] : 1, lo = k > 0 ? c[k - 1] : 0;
      quantile[i] = normInv(Math.min(1 - EPS, Math.max(EPS, lo + u[i] * (hi - lo))));
    }
  } else {
    if (fam.discrete) u = uniforms(n, seed);
    const aux = fit.family === 'normal' || fit.family === 'gamma' ? fit.dispersion : fit.aux;
    quantile = quantileResiduals(fit.family, y, fit.fitted, aux, u || new Float64Array(n));
  }
  let dispersion = null;
  if (fit.pearson && (fit.family === 'binomial' || fit.family === 'poisson')) {
    let s = 0;
    for (let i = 0; i < n; i++) s += fit.pearson[i] * fit.pearson[i];
    const df = fit.dfResidual;
    dispersion = { chisq: s, df, ratio: s / df, p: 1 - chi2Cdf(s, df) };
  }
  return { quantile, uniforms: u, pearson: fit.pearson || null, deviance: fit.devianceResiduals || null, fitted: fit.fitted, eta: fit.eta,
    hat: fit.hat || null, cooks: fit.cooks || null, dispersion, aux: fit.aux };
}
