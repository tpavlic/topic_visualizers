// Tests for js/stats/beta.js against reference/beta.R: betareg's
// coefficients, standard errors, φ and its standard error, log-likelihood,
// information criteria, fitted values, predictions, and quantile residuals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';
import { predictRows } from '../js/stats/inference.js';
import { residualSet } from '../js/stats/residuals.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'beta.json'), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const D = ref.data;
const ds = makeDataset({
  columns: [{ name: 'y', role: 'response', type: 'continuous' }, { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' }],
  rows: D.y.map((_, i) => [D.y[i], D.x[i], D.f[i]])
});
const spec = link => ({ dataset: ds.id, response: 'y', family: 'beta', link, terms: ['x', 'f'], group: null, nested: null, slope: null, olre: false, reml: false });

test('betareg with the logit link', () => {
  const r = fitModel(ds, spec('logit'));
  const fit = r.fit;
  assert.ok(fit.converged);
  assert.deepEqual(r.names, ref.names);
  ref.coef.forEach((c, i) => close(fit.beta[i], c, 1e-6, 'coef ' + i));
  ref.se.forEach((c, i) => close(Math.sqrt(fit.vcov[i][i]), c, 1e-5, 'se ' + i));
  close(fit.phi, ref.phi, 1e-6, 'phi');
  close(fit.phiSe, ref.se_logphi, 1e-5, 'se phi');
  close(fit.logLik, ref.loglik, 1e-8, 'logLik');
  assert.equal(fit.df, ref.df);
  close(fit.aic, ref.aic, 1e-8, 'aic');
  close(fit.bic, ref.bic, 1e-8, 'bic');
  ref.fitted.forEach((c, i) => close(fit.fitted[i], c, 1e-6, 'fitted ' + i));
  const p = predictRows(ds, r, [{ x: 0.3, f: 'hi' }, { x: 1.2, f: 'lo' }], 0.95);
  ref.pred.forEach((c, i) => close(p.fit[i], c, 1e-6, 'pred ' + i));
  const res = residualSet(r);
  ref.qres.forEach((c, i) => close(res.quantile[i], c, 1e-5, 'quantile residual ' + i));
});

test('betareg with the probit link', () => {
  const fit = fitModel(ds, spec('probit')).fit;
  ref.probit_coef.forEach((c, i) => close(fit.beta[i], c, 1e-6, 'coef ' + i));
  ref.probit_se.forEach((c, i) => close(Math.sqrt(fit.vcov[i][i]), c, 1e-5, 'se ' + i));
  close(fit.logLik, ref.probit_loglik, 1e-8, 'logLik');
});
