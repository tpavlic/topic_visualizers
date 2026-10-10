// Tests for js/stats/negbin.js against reference/negbin.R: MASS::glm.nb's
// coefficients, theta and its standard error, the deviance, the
// log-likelihood, and the information criteria, plus digamma and trigamma.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { modelMatrix } from '../js/stats/design.js';
import { fitNegbin, digamma, trigamma, thetaMl } from '../js/stats/negbin.js';
import { fitGlm } from '../js/stats/glm.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'negbin.json'), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);

test('digamma and trigamma match R', () => {
  [0.3, 1, 2.5, 7, 40].forEach((x, i) => { close(digamma(x), ref.digamma[i], 1e-10, 'digamma ' + x); close(trigamma(x), ref.trigamma[i], 1e-10, 'trigamma ' + x); });
});

const D = ref.data;
const ds = makeDataset({
  columns: [{ name: 'y', role: 'response', type: 'continuous' }, { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' }],
  rows: D.y.map((_, i) => [D.y[i], D.x[i], D.f[i]])
});
const m = modelMatrix(ds, { response: 'y', terms: ['x', 'f'] });

test('theta.ml at the Poisson fit', () => {
  const pm = fitGlm(m.y, m.X, { family: 'poisson', link: 'log' });
  close(thetaMl(m.y, pm.fitted).theta, ref.theta_ml_at_poisson, 1e-7, 'theta');
});

test('glm.nb', () => {
  const fit = fitNegbin(m.y, m.X, { link: 'log' });
  assert.ok(fit.converged);
  ref.coef.forEach((c, i) => close(fit.beta[i], c, 1e-6, 'coef ' + i));
  ref.se.forEach((c, i) => close(Math.sqrt(fit.vcov[i][i]), c, 1e-5, 'se ' + i));
  close(fit.theta, ref.theta, 1e-6, 'theta');
  close(fit.thetaSe, ref.se_theta, 1e-5, 'se theta');
  close(fit.deviance, ref.deviance, 1e-6, 'deviance');
  close(fit.logLik, ref.loglik, 1e-8, 'logLik');
  assert.equal(fit.df, ref.df);
  close(fit.aic, ref.aic, 1e-8, 'aic');
  close(fit.bic, ref.bic, 1e-8, 'bic');
  ref.fitted.forEach((c, i) => close(fit.fitted[i], c, 1e-6, 'fitted ' + i));
});
