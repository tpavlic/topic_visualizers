// The response families and the link functions: for each family its
// variance function, deviance residuals, log-likelihood, distribution
// function (for the quantile residuals), and starting values, and for each
// link the function, its inverse, and its derivative. The conventions are
// R's, so that a fit here matches `glm` and the exported scripts. Pure
// functions, no DOM.

import { logGamma, normCdf, normInv, gammaP, betaInc } from './special.js';

const EPS = 2.220446049250313e-16;
const clampP = p => Math.min(1 - EPS, Math.max(EPS, p));

/**
 * @typedef {{ id: string, label: string, linkfun: (mu: number) => number, linkinv: (eta: number) => number,
 *   mu_eta: (eta: number) => number, backName: string|null, backWord: string|null }} Link
 *   `backName` names the back-transformed coefficient column (an odds ratio,
 *   a rate ratio, a ratio of means) and is null where exp(β) has no name.
 */

/** @type {Object<string, Link>} */
export const LINKS = {
  identity: { id: 'identity', label: 'identity', linkfun: mu => mu, linkinv: eta => eta, mu_eta: () => 1, backName: null, backWord: null },
  log: { id: 'log', label: 'log', linkfun: Math.log, linkinv: eta => Math.max(Math.exp(eta), EPS), mu_eta: eta => Math.max(Math.exp(eta), EPS), backName: 'ratio', backWord: 'rate ratio' },
  logit: { id: 'logit', label: 'logit', linkfun: mu => Math.log(mu / (1 - mu)), linkinv: eta => {
    // As R's logit: capped so that mu stays inside (0, 1) by machine epsilon.
    const t = eta < -30 ? EPS : eta > 30 ? 1 - EPS : 1 / (1 + Math.exp(-eta));
    return Math.min(1 - EPS, Math.max(EPS, t));
  }, mu_eta: eta => { const e = Math.exp(-Math.abs(eta)); const d = e / ((1 + e) * (1 + e)); return Math.max(d, EPS); }, backName: 'odds ratio', backWord: 'odds ratio' },
  probit: { id: 'probit', label: 'probit', linkfun: mu => normInv(mu), linkinv: eta => { const thresh = -normInv(EPS); const e = Math.min(Math.max(eta, -thresh), thresh); return normCdf(e); },
    mu_eta: eta => Math.max(Math.exp(-0.5 * eta * eta) / 2.5066282746310002, EPS), backName: null, backWord: null },
  cloglog: { id: 'cloglog', label: 'complementary log-log', linkfun: mu => Math.log(-Math.log(1 - mu)),
    linkinv: eta => Math.max(Math.min(-Math.expm1(-Math.exp(eta)), 1 - EPS), EPS),
    mu_eta: eta => { const e = Math.min(eta, 700); return Math.max(Math.exp(e) * Math.exp(-Math.exp(e)), EPS); }, backName: null, backWord: null },
  inverse: { id: 'inverse', label: 'inverse', linkfun: mu => 1 / mu, linkinv: eta => 1 / eta, mu_eta: eta => -1 / (eta * eta), backName: null, backWord: null },
  sqrt: { id: 'sqrt', label: 'square root', linkfun: Math.sqrt, linkinv: eta => eta * eta, mu_eta: eta => 2 * eta, backName: null, backWord: null }
};

// Poisson and binomial pieces shared below.
const ylogy = (y, mu) => (y > 0 ? y * Math.log(y / mu) : 0);
const poisCdf = (y, mu) => (y < 0 ? 0 : 1 - gammaP(Math.floor(y) + 1, mu));
const nbCdf = (y, mu, theta) => (y < 0 ? 0 : betaInc(theta, Math.floor(y) + 1, theta / (theta + mu)));

/**
 * @typedef {{ id: string, label: string, links: string[], defaultLink: string, supports: string[],
 *   variance: (mu: number, aux: number) => number, devResid: (y: number, mu: number, aux: number) => number,
 *   logLik: (y: Float64Array, mu: Float64Array, aux: number, n: number) => number,
 *   cdf: (y: number, mu: number, aux: number) => number, discrete: boolean,
 *   initialize: (y: number) => number, aic_extra: number, valid: (y: number) => boolean, domain: string,
 *   dispersion: 'estimated'|'fixed', auxName: string|null }} Family
 *   `aux` is the extra parameter where the family has one (θ for the
 *   negative binomial, φ for the beta, σ² where the normal's log-likelihood
 *   needs it) and is ignored elsewhere. `aic_extra` counts the scale
 *   parameter R adds to the parameter count (1 for the normal and the
 *   gamma). `supports` lists the response supports (js/data/model.js) the
 *   family describes.
 */

/** @type {Object<string, Family>} */
export const FAMILIES = {
  normal: {
    id: 'normal', label: 'normal', links: ['identity', 'log'], defaultLink: 'identity', supports: ['real', 'positive', 'count', 'unit', 'binary'],
    variance: () => 1,
    devResid: (y, mu) => (y - mu) * (y - mu),
    // At the maximum-likelihood σ² = deviance / n, as R's logLik.glm reports it.
    logLik: (y, mu, aux, n) => { let d = 0; for (let i = 0; i < n; i++) d += (y[i] - mu[i]) ** 2; return -0.5 * n * (Math.log(2 * Math.PI * d / n) + 1); },
    cdf: (y, mu, aux) => normCdf((y - mu) / Math.sqrt(aux)),
    discrete: false, initialize: y => y, aic_extra: 1, valid: () => true, domain: 'any value', dispersion: 'estimated', auxName: null
  },
  binomial: {
    id: 'binomial', label: 'binomial', links: ['logit', 'probit', 'cloglog'], defaultLink: 'logit', supports: ['binary'],
    variance: mu => mu * (1 - mu),
    devResid: (y, mu) => 2 * (ylogy(y, mu) + ylogy(1 - y, 1 - mu)),
    logLik: (y, mu, aux, n) => { let s = 0; for (let i = 0; i < n; i++) s += y[i] > 0.5 ? Math.log(mu[i]) : Math.log(1 - mu[i]); return s; },
    cdf: (y, mu) => (y < 0 ? 0 : y < 1 ? 1 - mu : 1),
    discrete: true, initialize: y => (y + 0.5) / 2, aic_extra: 0, valid: y => y === 0 || y === 1, domain: '0 or 1', dispersion: 'fixed', auxName: null
  },
  poisson: {
    id: 'poisson', label: 'Poisson', links: ['log', 'sqrt', 'identity'], defaultLink: 'log', supports: ['count', 'binary'],
    variance: mu => mu,
    devResid: (y, mu) => 2 * (ylogy(y, mu) - (y - mu)),
    logLik: (y, mu, aux, n) => { let s = 0; for (let i = 0; i < n; i++) s += y[i] * Math.log(mu[i]) - mu[i] - logGamma(y[i] + 1); return s; },
    cdf: poisCdf,
    discrete: true, initialize: y => y + 0.1, aic_extra: 0, valid: y => Number.isInteger(y) && y >= 0, domain: 'a non-negative whole number', dispersion: 'fixed', auxName: null
  },
  negbin: {
    id: 'negbin', label: 'negative binomial', links: ['log'], defaultLink: 'log', supports: ['count', 'binary'],
    variance: (mu, theta) => mu + mu * mu / theta,
    devResid: (y, mu, theta) => 2 * (ylogy(y, mu) - (y + theta) * Math.log((y + theta) / (mu + theta))),
    logLik: (y, mu, theta, n) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += logGamma(theta + y[i]) - logGamma(theta) - logGamma(y[i] + 1) + theta * Math.log(theta) + y[i] * Math.log(mu[i]) - (theta + y[i]) * Math.log(theta + mu[i]);
      return s;
    },
    cdf: nbCdf,
    discrete: true, initialize: y => y + (y === 0 ? 1 / 6 : 0), aic_extra: 1, valid: y => Number.isInteger(y) && y >= 0, domain: 'a non-negative whole number', dispersion: 'fixed', auxName: 'theta'
  },
  gamma: {
    id: 'gamma', label: 'gamma', links: ['log', 'inverse', 'identity'], defaultLink: 'log', supports: ['positive'],
    variance: mu => mu * mu,
    devResid: (y, mu) => -2 * (Math.log(y / mu) - (y - mu) / mu),
    // At the maximum-likelihood dispersion = deviance / n, as R's Gamma()$aic does.
    logLik: (y, mu, aux, n) => {
      let d = 0;
      for (let i = 0; i < n; i++) d += -2 * (Math.log(y[i] / mu[i]) - (y[i] - mu[i]) / mu[i]);
      const disp = d / n, shape = 1 / disp;
      let s = 0;
      for (let i = 0; i < n; i++) { const scale = mu[i] * disp; s += (shape - 1) * Math.log(y[i]) - y[i] / scale - shape * Math.log(scale) - logGamma(shape); }
      return s;
    },
    cdf: (y, mu, disp) => gammaP(1 / disp, y / (mu * disp)),
    discrete: false, initialize: y => y, aic_extra: 1, valid: y => y > 0, domain: 'above 0', dispersion: 'estimated', auxName: null
  },
  beta: {
    id: 'beta', label: 'beta', links: ['logit', 'probit', 'cloglog'], defaultLink: 'logit', supports: ['unit'],
    variance: (mu, phi) => mu * (1 - mu) / (1 + phi),
    devResid: () => NaN,
    logLik: (y, mu, phi, n) => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        const a = mu[i] * phi, b = (1 - mu[i]) * phi;
        s += logGamma(phi) - logGamma(a) - logGamma(b) + (a - 1) * Math.log(y[i]) + (b - 1) * Math.log(1 - y[i]);
      }
      return s;
    },
    cdf: (y, mu, phi) => betaInc(mu * phi, (1 - mu) * phi, y),
    discrete: false, initialize: y => y, aic_extra: 1, valid: y => y > 0 && y < 1, domain: 'strictly between 0 and 1', dispersion: 'fixed', auxName: 'phi'
  },
  ordinal: {
    id: 'ordinal', label: 'ordinal (cumulative logit)', links: ['logit'], defaultLink: 'logit', supports: ['ordinal'],
    variance: () => NaN, devResid: () => NaN, logLik: () => NaN, cdf: () => NaN,
    discrete: true, initialize: y => y, aic_extra: 0, valid: () => true, domain: 'an ordered level', dispersion: 'fixed', auxName: null
  }
};

/** The families in menu order. */
export const FAMILY_ORDER = ['normal', 'binomial', 'poisson', 'negbin', 'gamma', 'beta', 'ordinal'];

/**
 * The family with this id, or null.
 * @param {string} id
 * @returns {Family|null}
 */
export function familyOf(id) { return FAMILIES[id] || null; }

/**
 * The link with this id, or the family's default when `id` is null or not
 * among the family's links.
 * @param {string} familyId
 * @param {string|null} id
 * @returns {Link}
 */
export function linkOf(familyId, id) {
  const f = FAMILIES[familyId] || FAMILIES.normal;
  return LINKS[f.links.includes(id) ? id : f.defaultLink];
}

/**
 * The families whose support holds a response of the given support.
 * @param {string} sup a support from js/data/model.js
 * @returns {string[]} family ids in menu order
 */
export function familiesFor(sup) {
  return FAMILY_ORDER.filter(id => FAMILIES[id].supports.includes(sup));
}

/**
 * The response values a family cannot take, as row indices.
 * @param {string} familyId
 * @param {ArrayLike<number>} y
 * @returns {number[]}
 */
export function invalidRows(familyId, y) {
  const f = FAMILIES[familyId];
  const bad = [];
  for (let i = 0; i < y.length; i++) if (!f.valid(y[i])) bad.push(i);
  return bad;
}

/**
 * The quantile residuals of Dunn and Smyth: Φ⁻¹ of the distribution
 * function at y, randomized on (F(y − 1), F(y)) for a discrete family with
 * the given uniforms.
 * @param {string} familyId
 * @param {Float64Array} y
 * @param {Float64Array} mu
 * @param {number} aux the family's extra parameter (σ² for the normal, the dispersion for the gamma, θ, φ)
 * @param {ArrayLike<number>} u uniforms, one per observation, used by a discrete family
 * @returns {Float64Array}
 */
export function quantileResiduals(familyId, y, mu, aux, u) {
  const f = FAMILIES[familyId];
  const n = y.length;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let p;
    if (f.discrete) {
      const hi = f.cdf(y[i], mu[i], aux), lo = f.cdf(y[i] - 1, mu[i], aux);
      p = lo + u[i] * (hi - lo);
    } else p = f.cdf(y[i], mu[i], aux);
    r[i] = normInv(clampP(p));
  }
  return r;
}
