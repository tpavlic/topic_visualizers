// The negative binomial regression with θ estimated, as MASS::glm.nb fits
// it: alternate an IRLS fit at the current θ with a maximum-likelihood
// update of θ at the current means, until the deviance and θ settle. θ is
// found by Newton's method on the profile score with digamma and trigamma,
// from the moment estimate, as theta.ml does. Pure functions, no DOM.

import { fitGlm } from './glm.js';
import { FAMILIES } from './families.js';

/** The digamma function ψ(x) by recurrence and the asymptotic series. */
export function digamma(x) {
  let r = 0;
  while (x < 10) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f / 132))));
}

/** The trigamma function ψ'(x). */
export function trigamma(x) {
  let r = 0;
  while (x < 10) { r += 1 / (x * x); x += 1; }
  const f = 1 / (x * x);
  return r + 1 / x + f / 2 + (f / x) * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f / 30)));
}

// The profile score and observed information for θ at fixed means, summed
// over the observations as MASS::theta.ml forms them.
function thetaScore(y, mu, th) {
  const n = y.length;
  let score = 0, info = 0;
  const dg = digamma(th), tg = trigamma(th), lt = Math.log(th);
  for (let i = 0; i < n; i++) {
    score += digamma(th + y[i]) - dg + lt + 1 - Math.log(th + mu[i]) - (y[i] + th) / (mu[i] + th);
    info += -trigamma(th + y[i]) + tg - 1 / th + 2 / (mu[i] + th) - (y[i] + th) / ((mu[i] + th) ** 2);
  }
  return { score, info };
}

/**
 * The maximum-likelihood θ at fixed means, as MASS::theta.ml: Newton steps
 * from the moment estimate n / Σ((y/μ − 1)²), to a relative change under
 * `eps`.
 * @param {Float64Array} y
 * @param {Float64Array} mu
 * @param {number} [eps]
 * @param {number} [limit]
 * @returns {{ theta: number, iterations: number, converged: boolean }}
 */
export function thetaMl(y, mu, eps = 1e-8, limit = 25) {
  const n = y.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += (y[i] / mu[i] - 1) ** 2;
  let t0 = n / s;
  let it = 0, del = 1;
  while (it < limit && Math.abs(del) > eps) {
    it++;
    t0 = Math.abs(t0);
    const { score, info } = thetaScore(y, mu, t0);
    del = score / info;
    t0 += del;
  }
  return { theta: t0 < 0 ? 0 : t0, iterations: it, converged: it < limit };
}

/**
 * Fits the negative binomial regression.
 * @param {Float64Array} y
 * @param {Float64Array[]} X
 * @param {{ link?: string|null }} o
 * @returns {import('./glm.js').GlmFit & { theta: number, thetaSe: number }}
 */
export function fitNegbin(y, X, o = {}) {
  const n = y.length;
  // As glm.nb: a Poisson fit first, θ from its means, then the alternation.
  let fit = fitGlm(y, X, { family: 'poisson', link: o.link || 'log', eps: 1e-8 });
  let th = thetaMl(y, fit.fitted);
  let theta = th.theta;
  let iter = 0, d1 = Infinity, d2 = Infinity;
  const Lm = (f, t) => FAMILIES.negbin.logLik(y, f.fitted, t, n);
  let Lm0 = Lm(fit, theta);
  let converged = false;
  const eps = 1e-8;
  // glm.nb: iterate while the deviance changes by more than eps relative, or the log-likelihood does.
  let devPrev = fit.deviance;
  while (iter < 25) {
    iter++;
    fit = fitGlm(y, X, { family: 'negbin', link: o.link || 'log', aux: theta, start: fit.beta, eps: 1e-8 });
    th = thetaMl(y, fit.fitted);
    const thetaNew = th.theta;
    const Lm1 = Lm(fit, thetaNew);
    // glm.nb's criterion: the change in the log-likelihood over sqrt(2 df)
    // plus the change in θ, under epsilon.
    d1 = Math.abs(Lm1 - Lm0) / Math.sqrt(2 * Math.max(1, fit.dfResidual));
    d2 = Math.abs(thetaNew - theta);
    devPrev = fit.deviance;
    Lm0 = Lm1;
    theta = thetaNew;
    if (d1 + d2 <= eps) { converged = true; break; }
  }
  // The final fit at the settled θ, so that every quantity is at one θ.
  fit = fitGlm(y, X, { family: 'negbin', link: o.link || 'log', aux: theta, start: fit.beta, eps: 1e-8 });
  const flags = fit.flags.filter(f => f !== 'notConverged');
  if (!converged || !fit.converged) flags.push('notConverged');
  // The standard error of θ from the observed information, as glm.nb's SE.theta.
  const thetaSe = Math.sqrt(1 / thetaScore(y, fit.fitted, theta).info);
  const logLik = FAMILIES.negbin.logLik(y, fit.fitted, theta, n);
  const k = fit.rank + 1;
  return Object.assign({}, fit, { theta, thetaSe, aux: theta, logLik, df: k, aic: -2 * logLik + 2 * k, bic: -2 * logLik + k * Math.log(n), flags, converged: converged && fit.converged, iterations: iter });
}
