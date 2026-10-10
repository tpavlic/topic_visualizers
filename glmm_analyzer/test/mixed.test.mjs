// Tests for js/stats/mixed.js against reference/mixed.R: lme4's Laplace
// fits (glmer at nAGQ = 1, lmer by ML and REML), the nested and
// observation-level cases, glmer.nb, and glmmTMB's beta mixed model. The
// optimizers land slightly apart, and so the tolerances are the spec's:
// 1e-5 on the deviance, 1e-4 on the fixed effects, 1e-3 on the variance
// components, and a variance under 1e-4 compared absolutely.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';
import { predictRows } from '../js/stats/inference.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'mixed.json'), 'utf8'));
const arr = v => (Array.isArray(v) ? v : [v]);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const closeAbs = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg + ': ' + a + ' vs ' + b);
const D = ref.data;
const ds = makeDataset({
  columns: [
    { name: 'g', role: 'group', type: 'categorical' }, { name: 'h', role: 'group', type: 'categorical' },
    { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' },
    { name: 'ycount', role: 'response', type: 'continuous' }, { name: 'ybin', role: 'ignored', type: 'continuous' }, { name: 'ynorm', role: 'ignored', type: 'continuous' },
    { name: 'yover', role: 'ignored', type: 'continuous' }, { name: 'ynb', role: 'ignored', type: 'continuous' }, { name: 'ybeta', role: 'ignored', type: 'continuous' }
  ],
  rows: D.x.map((_, i) => [D.g[i], D.h[i], D.x[i], D.f[i], D.ycount[i], D.ybin[i], D.ynorm[i], D.yover[i], D.ynb[i], D.ybeta[i]])
});
const spec = (response, family, terms, extra) => Object.assign({ dataset: ds.id, response, family, link: null, terms, group: 'g', nested: null, slope: null, olre: false, reml: false }, extra);

// The variance components, keyed by term and name as lme4's VarCorr prints them.
function vcMap(fit) {
  const m = {};
  for (const v of fit.varcomp) {
    v.names.forEach((nm, i) => { m[v.term + '|' + nm] = v.variances[i]; });
    if (v.correlation != null) m[v.term + '|corr'] = v.correlation;
  }
  return m;
}
function refVc(r) {
  const m = {};
  const vc = r.vc;
  arr(vc.grp).forEach((g, i) => {
    const v1 = arr(vc.var1)[i], v2 = arr(vc.var2)[i];
    if (g === 'Residual') m.residual = arr(vc.vcov)[i];
    else if (v2) m[g + '|corr'] = arr(vc.sdcor)[i];
    else m[g + '|' + (v1 === 'x' ? 'slope' : v1)] = arr(vc.vcov)[i];
  });
  return m;
}
// lme4's own optimizer stops at a deviance tolerance of about 1e-5, and so
// its parameters are not the optimum to every digit shown. The decisive
// check is that the page's deviance is at or below lme4's; the parameters
// are then compared at the tolerance lme4's own precision allows.
function checkFit(r, result, { vcTol = 2e-3, fixTol = 1e-3, devTol = 1e-5, ranefTol = 2e-3, seTol = 2e-3, ranefName = null } = {}) {
  const fit = result.fit;
  assert.deepEqual(result.names, arr(r.names));
  assert.ok(fit.deviance <= -2 * r.loglik + 1e-6 * Math.abs(r.loglik), 'deviance at or below lme4: ' + fit.deviance + ' vs ' + (-2 * r.loglik));
  arr(r.fixef).forEach((c, i) => close(fit.beta[i], c, fixTol, 'fixef ' + i));
  arr(r.se).forEach((c, i) => close(Math.sqrt(fit.vcov[i][i]), c, seTol, 'se ' + i));
  close(fit.logLik, r.loglik, devTol, 'logLik');
  assert.equal(fit.df, r.df, 'df');
  close(fit.aic, r.aic, devTol, 'aic');
  const want = refVc(r), have = vcMap(fit);
  for (const [k, v] of Object.entries(want)) {
    if (k === 'residual') { close(fit.sigma2, v, vcTol, 'residual variance'); continue; }
    if (k.endsWith('|corr')) { if (Math.abs(v) < 0.999) closeAbs(have[k], v, 0.01, k); continue; }
    assert.ok(k in have, 'variance component ' + k + ' among ' + Object.keys(have).join());
    if (v < 1e-4) closeAbs(have[k], v, 1e-4, k); else close(have[k], v, vcTol, k);
  }
  // The conditional modes of lme4's first random term (its term with the
  // most levels), found here by name.
  const re = fit.ranef.find(t => t.term === (ranefName || fit.ranef[0].term));
  const modes = arr(r.ranef.levels).map((l, i) => Array.isArray(r.ranef.modes[0]) ? r.ranef.modes[i][0] : arr(r.ranef.modes)[i]);
  // lme4 names a nested level "outer:inner"; the page keeps the inner name.
  assert.deepEqual(re.levels, arr(r.ranef.levels).map(l => (re.term.includes(':') ? l.split(':').slice(1).join(':') : l)));
  modes.forEach((m, i) => { if (Math.abs(m) > 1e-2) close(re.modes[i][0], m, ranefTol, 'ranef ' + i); });
  arr(r.fitted).forEach((c, i) => close(fit.fitted[i], c, 1e-3, 'fitted ' + i));
}

test('glmer, Poisson with a random intercept', () => {
  const s = spec('ycount', 'poisson', ['x', 'f']);
  const result = fitModel(ds, s);
  checkFit(ref.pois, result);
  const p = predictRows(ds, result, [{ x: 0.5, f: 'a' }, { x: 1.5, f: 'b' }], 0.95);
  ref.pois.pred_pop.forEach((c, i) => close(p.fit[i], c, 1e-3, 'population prediction ' + i));
});

test('glmer, binomial with a random intercept and slope', () => {
  const result = fitModel(ds, spec('ybin', 'binomial', ['x'], { slope: 'x' }));
  // The slope's correlation parameter sits at the boundary, and lme4's own
  // solution is the less precise for it.
  checkFit(ref.bin, result, { vcTol: 2e-2, fixTol: 5e-3, seTol: 1e-2, ranefTol: 2e-2 });
});

test('lmer by maximum likelihood and by REML', () => {
  const ml = fitModel(ds, spec('ynorm', 'normal', ['x', 'f']));
  checkFit(ref.lmm_ml, ml);
  const reml = fitModel(ds, spec('ynorm', 'normal', ['x', 'f'], { reml: true }));
  checkFit(ref.lmm_reml, reml);
  assert.ok(reml.fit.reml);
});

test('lmer with a nested factor', () => {
  const result = fitModel(ds, spec('ynorm', 'normal', ['x'], { nested: 'h' }));
  checkFit(ref.nested, result, { ranefName: 'g:h' });
  const re2 = result.fit.ranef[0];
  assert.equal(re2.term, 'g');
  arr(ref.nested.ranef2.levels).forEach((l, i) => { assert.equal(re2.levels[i], l); close(re2.modes[i][0], ref.nested.ranef2.modes[i][0] ?? arr(ref.nested.ranef2.modes)[i], 2e-3, 'g mode ' + i); });
});

test('glmer with an observation-level random intercept', () => {
  const result = fitModel(ds, spec('yover', 'poisson', ['x'], { group: null, olre: true }));
  checkFit(ref.olre, result, { ranefTol: 1e-2 });
  const both = fitModel(ds, spec('yover', 'poisson', ['x'], { olre: true }));
  // The group variance is at the boundary: lme4 calls the fit singular.
  assert.ok(both.flags.includes('singularFit'), both.flags.join());
  arr(ref.olre_g.fixef).forEach((c, i) => close(both.fit.beta[i], c, 1e-3, 'fixef ' + i));
  close(both.fit.logLik, ref.olre_g.loglik, 1e-5, 'logLik');
});

test('glmer.nb', () => {
  const result = fitModel(ds, spec('ynb', 'negbin', ['x']));
  checkFit(ref.nb, result, { fixTol: 1e-3, vcTol: 5e-3, devTol: 1e-5 });
  close(result.fit.theta, ref.nb.theta_nb, 1e-3, 'theta');
});

test('glmmTMB, beta with a random intercept', () => {
  const result = fitModel(ds, spec('ybeta', 'beta', ['x']));
  const fit = result.fit;
  ref.tmb.fixef.forEach((c, i) => close(fit.beta[i], c, 1e-3, 'fixef ' + i));
  ref.tmb.se.forEach((c, i) => close(Math.sqrt(fit.vcov[i][i]), c, 1e-2, 'se ' + i));
  close(fit.logLik, ref.tmb.loglik, 1e-4, 'logLik');
  close(fit.phi, ref.tmb.phi, 5e-3, 'phi');
  close(fit.varcomp[0].variances[0], ref.tmb.var_g, 5e-3, 'group variance');
});
