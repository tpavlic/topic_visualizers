// Tests for js/stats/glm.js against reference/glm.R: glm on every family
// and link fitted by IRLS, with the coefficients, standard errors, deviance,
// log-likelihood, AIC, BIC, dispersion, hat values, Cook's distances, and
// residuals, plus the design built from the same data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { modelMatrix } from '../js/stats/design.js';
import { fitGlm } from '../js/stats/glm.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'glm.json'), 'utf8'));
const arr = v => (Array.isArray(v) ? v : [v]);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const vec = (a, b0, tol, msg) => { const b = arr(b0); assert.equal(a.length, b.length, msg + ' length'); for (let i = 0; i < b.length; i++) close(a[i], b[i], tol, msg + '[' + i + ']'); };

const D = ref.data;
const ds = makeDataset({
  columns: [
    { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' },
    { name: 'ynorm', role: 'response', type: 'continuous' }, { name: 'ybin', role: 'ignored', type: 'continuous' },
    { name: 'ycount', role: 'ignored', type: 'continuous' }, { name: 'ypos', role: 'ignored', type: 'continuous' }, { name: 'ylog', role: 'ignored', type: 'continuous' }
  ],
  rows: D.x.map((_, i) => [D.x[i], D.f[i], D.ynorm[i], D.ybin[i], D.ycount[i], D.ypos[i], D.ylog[i]])
});

const CASES = [
  ['normal_identity', 'ynorm', 'normal', 'identity', ['x', 'f']],
  ['normal_log', 'ylog', 'normal', 'log', ['x', 'f']],
  ['binomial_logit', 'ybin', 'binomial', 'logit', ['x', 'f']],
  ['binomial_probit', 'ybin', 'binomial', 'probit', ['x', 'f']],
  ['binomial_cloglog', 'ybin', 'binomial', 'cloglog', ['x', 'f']],
  ['poisson_log', 'ycount', 'poisson', 'log', ['x', 'f']],
  ['poisson_sqrt', 'ycount', 'poisson', 'sqrt', ['x', 'f']],
  ['gamma_log', 'ypos', 'gamma', 'log', ['x', 'f']],
  ['gamma_inverse', 'ypos', 'gamma', 'inverse', ['x', 'f']],
  ['interaction', 'ycount', 'poisson', 'log', ['x', 'f', { of: ['x', 'f'] }]],
  ['poly', 'ynorm', 'normal', 'identity', ['x', { name: 'x', degree: 2 }]],
  ['intercept_only', 'ybin', 'binomial', 'logit', []]
];

for (const [key, response, family, link, terms] of CASES) {
  test(key + ' matches glm', () => {
    const r = ref[key];
    const m = modelMatrix(ds, { response, terms });
    assert.deepEqual(m.names, arr(r.names));
    const fit = fitGlm(m.y, m.X, { family, link });
    assert.ok(fit.converged, 'converged');
    vec(fit.beta, r.coef, 1e-7, 'coef');
    const se = fit.vcov.map((row, i) => Math.sqrt(row[i]));
    vec(se, r.se, 1e-6, 'se');
    close(fit.deviance, r.deviance, 1e-8, 'deviance');
    close(fit.nullDeviance, r.null_deviance, 1e-8, 'null deviance');
    close(fit.logLik, r.loglik, 1e-8, 'logLik');
    assert.equal(fit.df, r.df, 'df');
    close(fit.aic, r.aic, 1e-8, 'aic');
    close(fit.bic, r.bic, 1e-8, 'bic');
    close(fit.dispersion, r.dispersion, 1e-7, 'dispersion');
    vec(fit.fitted, r.fitted, 1e-7, 'fitted');
    vec(fit.hat, r.hat, 1e-6, 'hat');
    vec(fit.cooks, r.cooks, 1e-5, 'cooks');
    vec(fit.pearson, r.pearson, 1e-6, 'pearson');
    vec(fit.devianceResiduals, r.devres, 1e-6, 'deviance residuals');
    for (let i = 0; i < r.vcov.length; i++) vec(fit.vcov[i], arr(r.vcov[i]), 1e-6, 'vcov row ' + i);
  });
}

test('the iteration count matches R on the Poisson fit', () => {
  const m = modelMatrix(ds, { response: 'ycount', terms: ['x', 'f'] });
  assert.equal(fitGlm(m.y, m.X, { family: 'poisson', link: 'log' }).iterations, ref.poisson_log.iter);
});

test('complete separation is flagged', () => {
  const d = makeDataset({ columns: [{ name: 'y', role: 'response', type: 'continuous' }, { name: 'x', role: 'predictor', type: 'continuous' }],
    rows: [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [1, 6]] });
  const m = modelMatrix(d, { response: 'y', terms: ['x'] });
  const fit = fitGlm(m.y, m.X, { family: 'binomial', link: 'logit' });
  assert.ok(fit.flags.includes('separation'), fit.flags.join());
});
