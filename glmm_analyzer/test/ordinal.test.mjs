// Tests for js/stats/ordinal.js against reference/ordinal.R: MASS::polr's
// coefficients, thresholds, standard errors, log-likelihood, information
// criteria, fitted probabilities, predictions, and drop1's tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';
import { ordinalProbs } from '../js/stats/ordinal.js';
import { newDataMatrix } from '../js/stats/design.js';
import { termTests } from '../js/stats/inference.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'ordinal.json'), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const D = ref.data;
const ds = makeDataset({
  columns: [{ name: 'y', role: 'response', type: 'ordinal', levels: ref.levels }, { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' }],
  rows: D.y.map((_, i) => [D.y[i], D.x[i], D.f[i]])
});
const spec = { dataset: ds.id, response: 'y', family: 'ordinal', link: 'logit', terms: ['x', 'f'], group: null, nested: null, slope: null, olre: false, reml: false };

test('polr', () => {
  const r = fitModel(ds, spec);
  const fit = r.fit;
  assert.ok(fit.converged);
  assert.deepEqual(r.names, ref.names);
  assert.deepEqual(fit.zetaNames, ref.zeta_names);
  ref.coef.forEach((c, i) => close(fit.beta[i], c, 1e-6, 'coef ' + i));
  ref.zeta.forEach((c, i) => close(fit.zeta[i], c, 1e-6, 'zeta ' + i));
  ref.se.forEach((c, i) => close(Math.sqrt(fit.vcov[i][i]), c, 1e-5, 'se ' + i));
  close(fit.logLik, ref.loglik, 1e-8, 'logLik');
  close(fit.deviance, ref.deviance, 1e-8, 'deviance');
  assert.equal(fit.df, ref.df);
  close(fit.aic, ref.aic, 1e-8, 'aic');
  close(fit.bic, ref.bic, 1e-8, 'bic');
  for (let i = 0; i < 5; i++) for (let k = 0; k < 4; k++) close(fit.probs[i][k], ref.fitted[i][k], 1e-6, 'probs ' + i + ',' + k);
  const X = newDataMatrix(ds, r.design, [{ x: 0.5, f: 'a' }, { x: 2.5, f: 'b' }]).map(row => row.slice(1));
  const eta = X.map(x => x.reduce((s, v, j) => s + v * fit.beta[j], 0));
  const pr = ordinalProbs(fit, eta);
  for (let i = 0; i < 2; i++) for (let k = 0; k < 4; k++) close(pr[i][k], ref.pred[i][k], 1e-6, 'pred ' + i + ',' + k);
});

test('drop1 on polr', () => {
  const r = fitModel(ds, spec);
  const t = termTests(ds, spec, r);
  assert.deepEqual(t.rows.map(x => x.term), ref.drop.terms);
  ref.drop.lrt.forEach((c, i) => close(t.rows[i].stat, c, 1e-6, 'lrt ' + i));
  ref.drop.p.forEach((c, i) => close(t.rows[i].p, c, 1e-6, 'p ' + i));
});
