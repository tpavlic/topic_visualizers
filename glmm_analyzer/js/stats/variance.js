// The variance decomposition of a fit, as insight::get_variance and
// performance::r2_nakagawa form it (Nakagawa and Schielzeth 2013; Johnson
// 2014 for a random slope; Nakagawa, Johnson, and Schielzeth 2017 for the
// distribution-specific variance of a non-normal family): the variance of
// the fixed-effect linear predictor, each random term's variance averaged
// over the rows, an observation-level effect's variance as dispersion, and
// the distribution-specific residual variance on the link scale, with the
// marginal and conditional R² and the adjusted ICC that follow. A model
// with no random part gets the same decomposition with no random term.
// Pure functions, no DOM.

import { FAMILIES } from './families.js';
import { orderedTerms, termLabel, termVars, modelMatrix } from './design.js';
import { refitTerms } from './inference.js';

// The sample variance (n − 1) of the fixed-effect linear predictor Xβ.
function fixedVariance(X, beta) {
  const n = X.length;
  const eta = new Float64Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) { let e = 0; for (let j = 0; j < beta.length; j++) e += X[i][j] * beta[j]; eta[i] = e; m += e; }
  m /= n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (eta[i] - m) * (eta[i] - m);
  return n > 1 ? s / (n - 1) : 0;
}

// A random term's variance averaged over the rows: σ² for an intercept, and
// for an intercept and slope the mean of z_i' Σ z_i with z_i = (1, x_i).
function termVariance(term, vc) {
  const v0 = vc.variances[0];
  if (vc.names.length < 2 || !term.slope) return v0;
  const v1 = vc.variances[1];
  const cov = (vc.correlation || 0) * Math.sqrt(v0 * v1);
  const x = term.slope;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += v0 + 2 * x[i] * cov + x[i] * x[i] * v1;
  return s / x.length;
}

// The random part of a mixed fit: each term's averaged variance, the
// observation-level effect's apart, as insight separates them.
function randomParts(fit) {
  const out = { terms: [], dispersion: 0 };
  if (!fit.mixed) return out;
  fit.random.terms.forEach((t, k) => {
    const vc = fit.varcomp[k];
    const v = termVariance(t, vc);
    if (t.kind === 'olre') out.dispersion += v;
    else out.terms.push({ term: t.name, kind: t.kind, slope: vc.names.length > 1, variance: v, intercept: vc.variances[0] });
  });
  return out;
}

/** The families and links the decomposition is defined for. */
export function varianceSupported(family, link) {
  if (family === 'normal') return link === 'identity';
  if (family === 'binomial') return link === 'logit' || link === 'probit' || link === 'cloglog';
  if (family === 'poisson' || family === 'negbin' || family === 'gamma') return link === 'log';
  if (family === 'beta') return link === 'logit';
  return false;
}

/**
 * The distribution-specific variance of a fit, on the link scale, under
 * the lognormal approximation: σ² for the normal; π²/3, 1, or π²/6 for a
 * binomial logit, probit, or cloglog; log(1 + 1/λ) for a Poisson and
 * log(1 + 1/λ + 1/θ) for a negative binomial, where λ is the mean the
 * intercept-only model implies, exp(β₀ + ½ its random variance); log(1 + φ)
 * for a gamma; and log(1 + (1 − μ)/(μ(1 + φ))) for a beta at the
 * intercept-only model's μ.
 * @param {object} fit the full fit
 * @param {object|null} nullFit the intercept-only fit with the same random part, or null for the normal and binomial families
 * @param {number} nullRandom the null fit's random variance apart from any observation-level effect
 * @returns {number}
 */
export function distributionVariance(fit, nullFit, nullRandom) {
  const fam = fit.family, link = fit.link;
  if (fam === 'normal') return fit.mixed ? fit.sigma2 : fit.dispersion;
  if (fam === 'binomial') return link === 'logit' ? Math.PI * Math.PI / 3 : link === 'probit' ? 1 : Math.PI * Math.PI / 6;
  if (fam === 'gamma') return Math.log1p(fit.dispersion);
  const b0 = nullFit.beta[0];
  if (fam === 'poisson') return Math.log1p(1 / Math.exp(b0 + 0.5 * nullRandom));
  if (fam === 'negbin') return Math.log1p(1 / Math.exp(b0 + 0.5 * nullRandom) + 1 / fit.theta);
  if (fam === 'beta') { const mu = 1 / (1 + Math.exp(-b0)); const v = mu * (1 - mu) / (1 + fit.phi); return Math.log1p(v / (mu * mu)); }
  return NaN;
}

/**
 * The decomposition of a fit's variance.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} spec
 * @param {object} result fitModel's output
 * @returns {{ ok: boolean, why: string|null, fixed: number, random: {term: string, kind: string, slope: boolean, variance: number, intercept: number}[],
 *   randomTotal: number, dispersion: number, distribution: number, residual: number, total: number,
 *   r2m: number, r2c: number, icc: number|null, iccUnadjusted: number|null,
 *   terms: {term: string, fixed: number, delta: number}[] }}
 */
export function varianceParts(ds, spec, result) {
  const fit = result.fit;
  const fam = FAMILIES[fit.family];
  if (!varianceSupported(fit.family, fit.link)) {
    const why = fit.family === 'ordinal'
      ? 'The decomposition is not defined for the ordinal model, whose response has no variance on one scale.'
      : 'The decomposition is defined for the ' + fam.label + ' family with its ' + (fit.family === 'normal' ? 'identity' : fit.family === 'binomial' ? 'logit, probit, or complementary log-log' : fit.family === 'beta' ? 'logit' : 'log') + ' link only, where the distribution-specific variance has a form.';
    return { ok: false, why };
  }
  const fixed = fixedVariance(result.design.X, fit.beta);
  const rnd = randomParts(fit);
  const randomTotal = rnd.terms.reduce((a, t) => a + t.variance, 0);
  let nullFit = null, nullRandom = 0;
  if (fit.family === 'poisson' || fit.family === 'negbin' || fit.family === 'beta') {
    nullFit = refitTerms(ds, spec, result, []);
    nullRandom = randomParts(nullFit).terms.reduce((a, t) => a + t.variance, 0);
  }
  const distribution = distributionVariance(fit, nullFit, nullRandom);
  const residual = distribution + rnd.dispersion;
  const total = fixed + randomTotal + residual;
  const terms = [];
  const all = orderedTerms(spec);
  all.forEach((t, i) => {
    const vars = termVars(t);
    const needed = all.some((u, j) => j !== i && typeof u === 'object' && u.of && vars.every(v => u.of.includes(v)) && u.of.length > vars.length);
    if (needed) return;
    const kept = all.filter((_, j) => j !== i);
    const red = refitTerms(ds, spec, result, kept);
    const X = modelMatrix(ds, Object.assign({}, spec, { terms: kept })).X;
    const f = X.length && X[0].length === red.beta.length ? fixedVariance(X, red.beta) : NaN;
    terms.push({ term: termLabel(t), fixed: f, delta: (fixed - f) / total });
  });
  return {
    ok: true, why: null, fixed, random: rnd.terms, randomTotal, dispersion: rnd.dispersion, distribution, residual, total,
    r2m: fixed / total, r2c: (fixed + randomTotal) / total,
    icc: rnd.terms.length ? randomTotal / (randomTotal + residual) : null,
    iccUnadjusted: rnd.terms.length ? randomTotal / total : null,
    terms
  };
}
