// Tests for js/stats/variance.js against reference/variance.R: insight's
// get_variance and performance's r2_nakagawa and icc on the mixed models of
// mixed.R, and the same decomposition by hand on models with no random part.
// The fits land where each optimizer stops, and so the tolerances are those
// of the mixed tests: 1e-3 on a variance, 2e-3 on a ratio of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';
import { varianceParts, varianceSupported } from '../js/stats/variance.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(fs.readFileSync(path.join(HERE, 'reference', 'variance.json'), 'utf8'));
const D = JSON.parse(fs.readFileSync(path.join(HERE, 'reference', 'mixed.json'), 'utf8')).data;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const ds = makeDataset({
  columns: [
    { name: 'g', role: 'group', type: 'categorical' }, { name: 'h', role: 'group', type: 'categorical' },
    { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' },
    { name: 'ycount', role: 'response', type: 'continuous' }, { name: 'ybin', role: 'ignored', type: 'continuous' }, { name: 'ynorm', role: 'ignored', type: 'continuous' },
    { name: 'yover', role: 'ignored', type: 'continuous' }, { name: 'ynb', role: 'ignored', type: 'continuous' }, { name: 'ybeta', role: 'ignored', type: 'continuous' },
    { name: 'ygam', role: 'ignored', type: 'continuous' }
  ],
  rows: D.x.map((_, i) => [D.g[i], D.h[i], D.x[i], D.f[i], D.ycount[i], D.ybin[i], D.ynorm[i], D.yover[i], D.ynb[i], D.ybeta[i], D.ygam[i]])
});
const spec = (response, family, terms, extra) => Object.assign({ dataset: ds.id, response, family, link: null, terms, group: 'g', nested: null, slope: null, olre: false, reml: false }, extra);
const parts = s => varianceParts(ds, s, fitModel(ds, s));

const MIXED = {
  pois: spec('ycount', 'poisson', ['x', 'f']),
  bin: spec('ybin', 'binomial', ['x'], { slope: 'x' }),
  lmm_ml: spec('ynorm', 'normal', ['x', 'f']),
  lmm_reml: spec('ynorm', 'normal', ['x', 'f'], { reml: true }),
  nested: spec('ynorm', 'normal', ['x'], { nested: 'h' }),
  olre_g: spec('yover', 'poisson', ['x'], { olre: true }),
  nb: spec('ynb', 'negbin', ['x']),
  gam: spec('ygam', 'gamma', ['x']),
  tmb: spec('ybeta', 'beta', ['x'])
};
for (const [name, s] of Object.entries(MIXED)) {
  test('variance decomposition of the mixed ' + name + ' fit matches insight and performance', () => {
    const r = ref[name];
    const v = parts(s);
    assert.ok(v.ok, v.why);
    // A piece R declined (NA in the reference: a singular fit, or no random
    // term apart from the observation level) is not compared.
    const has = k => typeof r[k] === 'number';
    // The random-slope binomial fit is near-singular (its slope-intercept
    // correlation is 0.99999), and the two optimizers land 0.3% apart on it.
    const tol = name === 'bin' ? 1e-2 : 2e-3;
    const pairs = [['fixed', 'fixed'], ['randomTotal', 'random'], ['distribution', 'distribution'], ['dispersion', 'dispersion'],
      ['residual', 'residual'], ['r2m', 'r2m'], ['r2c', 'r2c'], ['icc', 'icc'], ['iccUnadjusted', 'icc_unadj']];
    let compared = 0;
    for (const [ours, theirs] of pairs) if (has(theirs)) { close(v[ours], r[theirs], tol, theirs); compared++; }
    // On the observation-level case R gives the fixed and dispersion pieces only.
    assert.ok(compared >= (name === 'olre_g' ? 2 : 7), 'reference holds ' + compared + ' pieces');
  });
}

const GLM = {
  g_pois: spec('ycount', 'poisson', ['x', 'f'], { group: null }),
  g_norm: spec('ynorm', 'normal', ['x', 'f'], { group: null }),
  g_bin: spec('ybin', 'binomial', ['x'], { group: null }),
  g_nb: spec('ynb', 'negbin', ['x'], { group: null }),
  g_gam: spec('ygam', 'gamma', ['x'], { group: null }),
  g_beta: spec('ybeta', 'beta', ['x'], { group: null })
};
for (const [name, s] of Object.entries(GLM)) {
  test('variance decomposition of the ' + name + ' fit matches the by-hand R values', () => {
    const r = ref[name];
    const v = parts(s);
    assert.ok(v.ok, v.why);
    close(v.fixed, r.fixed, 1e-5, 'fixed');
    close(v.distribution, r.distribution, 1e-5, 'distribution');
    close(v.r2m, r.r2, 1e-5, 'R2');
    assert.equal(v.random.length, 0);
    assert.equal(v.icc, null);
    assert.equal(v.r2c, v.r2m);
  });
}

test('the per-term pieces are the fixed-effect variance lost when a term is dropped', () => {
  const v = parts(GLM.g_norm);
  assert.deepEqual(v.terms.map(t => t.term), ['x', 'f']);
  for (const t of v.terms) { assert.ok(Number.isFinite(t.delta)); close(t.delta, (v.fixed - t.fixed) / v.total, 1e-12, t.term); }
  // Dropping the only predictor leaves no fixed-effect variance.
  const one = parts(GLM.g_bin);
  close(one.terms[0].fixed, 0, 1e-12, 'intercept only');
  close(one.terms[0].delta, one.r2m, 1e-12, 'the whole marginal R2');
});

test('the decomposition is refused where it has no form', () => {
  assert.equal(varianceSupported('ordinal', 'logit'), false);
  assert.equal(varianceSupported('poisson', 'sqrt'), false);
  assert.equal(varianceSupported('binomial', 'probit'), true);
  const v = parts(spec('ycount', 'poisson', ['x'], { group: null, link: 'sqrt' }));
  assert.equal(v.ok, false);
  assert.match(v.why, /log link only/);
});
