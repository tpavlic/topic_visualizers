// Tests for js/stats/families.js against the family pieces in
// reference/glm.R: deviance residuals, log-likelihoods, distribution
// functions, and the links' inverses and derivatives.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FAMILIES, LINKS, familiesFor, linkOf, invalidRows, quantileResiduals } from '../js/stats/families.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'glm.json'), 'utf8')).pieces;
const close = (a, b, tol = 1e-10, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ' ' + a + ' vs ' + b);
const y = Float64Array.from(ref.y), mu = Float64Array.from(ref.mu);

test('Poisson deviance residuals, log-likelihood, and cdf', () => {
  y.forEach((v, i) => close(FAMILIES.poisson.devResid(v, mu[i]), ref.poisson_dev[i], 1e-12, 'dev ' + i));
  close(FAMILIES.poisson.logLik(y, mu, 1, 5), ref.poisson_ll, 1e-12);
  y.forEach((v, i) => close(FAMILIES.poisson.cdf(v, mu[i]), ref.poisson_cdf[i], 1e-10, 'cdf ' + i));
});

test('binomial pieces', () => {
  const yb = [0, 1, 1, 0, 1], mb = [0.2, 0.7, 0.9, 0.4, 0.5];
  yb.forEach((v, i) => close(FAMILIES.binomial.devResid(v, mb[i]), ref.binom_dev[i], 1e-12, 'dev ' + i));
  close(FAMILIES.binomial.logLik(Float64Array.from(yb), Float64Array.from(mb), 1, 5), ref.binom_ll, 1e-12);
});

test('negative binomial pieces at theta = 1.7', () => {
  close(FAMILIES.negbin.logLik(y, mu, 1.7, 5), ref.negbin_ll, 1e-12);
  y.forEach((v, i) => close(FAMILIES.negbin.devResid(v, mu[i], 1.7), ref.negbin_dev[i], 1e-12, 'dev ' + i));
  y.forEach((v, i) => close(FAMILIES.negbin.cdf(v, mu[i], 1.7), ref.negbin_cdf[i], 1e-10, 'cdf ' + i));
});

test('gamma deviance and cdf, and beta log-likelihood and cdf', () => {
  const yg = Float64Array.from(y, v => v + 0.5);
  yg.forEach((v, i) => close(FAMILIES.gamma.devResid(v, mu[i]), ref.gamma_dev[i], 1e-12, 'dev ' + i));
  yg.forEach((v, i) => close(FAMILIES.gamma.cdf(v, mu[i], 0.4), ref.gamma_cdf[i], 1e-10, 'cdf ' + i));
  const yu = Float64Array.from([0.2, 0.5, 0.7, 0.9, 0.3]), mb = Float64Array.from([0.3, 0.5, 0.6, 0.8, 0.4]);
  close(FAMILIES.beta.logLik(yu, mb, 5, 5), ref.beta_ll, 1e-12);
  yu.forEach((v, i) => close(FAMILIES.beta.cdf(v, mb[i], 5), ref.beta_cdf[i], 1e-10, 'cdf ' + i));
});

test('links match R', () => {
  [-2, 0, 1.5].forEach((e, i) => {
    close(LINKS.cloglog.linkinv(e), ref.cloglog_inv[i], 1e-12, 'cloglog inv');
    close(LINKS.cloglog.mu_eta(e), ref.cloglog_mu_eta[i], 1e-12, 'cloglog mu.eta');
    close(LINKS.probit.mu_eta(e), ref.probit_mu_eta[i], 1e-10, 'probit mu.eta');
  });
  for (const id of Object.keys(LINKS)) {
    const L = LINKS[id];
    const mus = id === 'logit' || id === 'probit' || id === 'cloglog' ? [0.1, 0.5, 0.9] : [0.5, 2, 7];
    for (const m of mus) close(L.linkinv(L.linkfun(m)), m, 1e-9, id + ' round trip');
  }
  assert.equal(linkOf('binomial', null).id, 'logit');
  assert.equal(linkOf('binomial', 'log').id, 'logit', 'a link the family lacks falls back to its default');
  assert.equal(linkOf('gamma', 'inverse').id, 'inverse');
});

test('familiesFor and invalidRows', () => {
  assert.deepEqual(familiesFor('binary'), ['normal', 'binomial', 'poisson', 'negbin']);
  assert.deepEqual(familiesFor('count'), ['normal', 'poisson', 'negbin']);
  assert.deepEqual(familiesFor('unit'), ['normal', 'beta']);
  assert.deepEqual(familiesFor('positive'), ['normal', 'gamma']);
  assert.deepEqual(familiesFor('ordinal'), ['ordinal']);
  assert.deepEqual(invalidRows('binomial', [0, 1, 2, 0.5]), [2, 3]);
  assert.deepEqual(invalidRows('poisson', [0, 1.5, -1, 3]), [1, 2]);
  assert.deepEqual(invalidRows('gamma', [0, 1, 2]), [0]);
  assert.deepEqual(invalidRows('beta', [0, 0.5, 1]), [0, 2]);
});

test('quantile residuals are continuous for a continuous family and randomized for a discrete one', () => {
  const r = quantileResiduals('normal', Float64Array.from([1, 2]), Float64Array.from([1, 1]), 1, [0.5, 0.5]);
  close(r[0], 0, 1e-9);
  close(r[1], 1, 1e-9);
  const a = quantileResiduals('poisson', Float64Array.from([2]), Float64Array.from([2]), 1, [0]);
  const b = quantileResiduals('poisson', Float64Array.from([2]), Float64Array.from([2]), 1, [1]);
  assert.ok(a[0] < b[0]);
});
