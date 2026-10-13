// Tests for js/stats/inference.js against reference/inference.R: drop1's
// tests, predict.glm, and emmeans with Tukey pairs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';
import { termTests, predictRows, marginalMeans, referenceGrid, effectGrid, binnedMeans } from '../js/stats/inference.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ref = JSON.parse(fs.readFileSync(path.join(HERE, 'reference', 'inference.json'), 'utf8'));
const G = JSON.parse(fs.readFileSync(path.join(HERE, 'reference', 'glm.json'), 'utf8')).data;
const arr = v => (Array.isArray(v) ? v : [v]);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const vec = (a, b0, tol, msg) => { const b = arr(b0); assert.equal(a.length, b.length, msg + ' length'); for (let i = 0; i < b.length; i++) close(a[i], b[i], tol, msg + '[' + i + ']'); };

const ds = makeDataset({
  columns: [
    { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' }, { name: 'g', role: 'predictor', type: 'categorical' },
    { name: 'ynorm', role: 'response', type: 'continuous' }, { name: 'ybin', role: 'ignored', type: 'continuous' },
    { name: 'ycount', role: 'ignored', type: 'continuous' }, { name: 'ypos', role: 'ignored', type: 'continuous' }
  ],
  rows: G.x.map((_, i) => [G.x[i], G.f[i], ref.g[i], G.ynorm[i], G.ybin[i], G.ycount[i], G.ypos[i]])
});
const spec = (response, family, link, terms) => ({ dataset: ds.id, response, family, link, terms, group: null, nested: null, slope: null, olre: false, reml: false });
const fit = s => { const r = fitModel(ds, s); r.codedY = r.design.y; return r; };

const DROPS = [
  ['drop_norm', spec('ynorm', 'normal', 'identity', ['x', 'f', 'g']), true],
  ['drop_bin', spec('ybin', 'binomial', 'logit', ['x', 'f', 'g']), false],
  ['drop_pois', spec('ycount', 'poisson', 'log', ['x', 'f', { of: ['x', 'f'] }]), false],
  ['drop_gam', spec('ypos', 'gamma', 'log', ['x', 'f']), true],
];
const NB = JSON.parse(fs.readFileSync(path.join(HERE, 'reference', 'negbin.json'), 'utf8')).data;
const dsNb = makeDataset({
  columns: [{ name: 'y', role: 'response', type: 'continuous' }, { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'f', role: 'predictor', type: 'categorical' }],
  rows: NB.y.map((_, i) => [NB.y[i], NB.x[i], NB.f[i]])
});
test('drop_nb matches drop1 on a negative binomial fit', () => {
  const s = Object.assign(spec('y', 'negbin', 'log', ['x', 'f']), { dataset: dsNb.id });
  const r = fitModel(dsNb, s); r.codedY = r.design.y;
  const t = termTests(dsNb, s, r);
  const ref_ = ref.drop_nb;
  assert.deepEqual(t.rows.map(x => x.term), arr(ref_.terms));
  vec(t.rows.map(x => x.stat), ref_.stat, 1e-6, 'stat');
  vec(t.rows.map(x => x.p), ref_.p, 1e-6, 'p');
});
for (const [key, s, scaled] of DROPS) {
  test(key + ' matches drop1', () => {
    const r = ref[key];
    const t = termTests(ds, s, fit(s));
    assert.equal(t.scaled, scaled);
    assert.deepEqual(t.rows.map(x => x.term), arr(r.terms));
    vec(t.rows.map(x => x.df), r.df, 0, 'df');
    vec(t.rows.map(x => x.stat), r.stat, 1e-6, 'stat');
    vec(t.rows.map(x => x.p), r.p, 1e-6, 'p');
  });
}

const ND = [{ x: 0.5, f: 'a', g: 'u' }, { x: 1.5, f: 'b', g: 'u' }, { x: 2.5, f: 'c', g: 'v' }, { x: 1.0, f: 'a', g: 'v' }];
const PREDS = [
  ['pred_norm', spec('ynorm', 'normal', 'identity', ['x', 'f', 'g'])],
  ['pred_bin', spec('ybin', 'binomial', 'logit', ['x', 'f', 'g'])],
  ['pred_pois', spec('ycount', 'poisson', 'log', ['x', 'f', { of: ['x', 'f'] }])],
  ['pred_gam', spec('ypos', 'gamma', 'log', ['x', 'f'])]
];
for (const [key, s] of PREDS) {
  test(key + ' matches predict.glm', () => {
    const r = ref[key];
    const p = predictRows(ds, fit(s), ND, 0.95);
    vec(p.eta, r.eta, 1e-7, 'eta');
    vec(p.se, r.se, 1e-6, 'se');
    vec(p.fit, r.fit, 1e-7, 'fit');
  });
}

const EMMS = [
  ['emm_norm_f', spec('ynorm', 'normal', 'identity', ['x', 'f', 'g']), 'f', 0.95],
  ['emm_bin_f', spec('ybin', 'binomial', 'logit', ['x', 'f', 'g']), 'f', 0.90],
  ['emm_pois_f', spec('ycount', 'poisson', 'log', ['x', 'f', { of: ['x', 'f'] }]), 'f', 0.95],
  ['emm_gam_f', spec('ypos', 'gamma', 'log', ['x', 'f']), 'f', 0.95],
  ['emm_norm_g', spec('ynorm', 'normal', 'identity', ['x', 'f', 'g']), 'g', 0.95],
  ['emm_poly_f', spec('ynorm', 'normal', 'identity', ['x', { name: 'x', degree: 2 }, 'f']), 'f', 0.95]
];
for (const [key, s, factor, level] of EMMS) {
  test(key + ' matches emmeans and pairs', () => {
    const r = ref[key];
    const m = marginalMeans(ds, fit(s), factor, level);
    assert.deepEqual(m.levels, arr(r.levels));
    assert.equal(Number.isFinite(m.df) ? m.df : 'Inf', Number.isFinite(r.df) ? r.df : 'Inf');
    vec(m.means.map(x => x.eta), r.eta, 1e-7, 'eta');
    vec(m.means.map(x => x.se), r.se, 1e-6, 'se');
    vec(m.means.map(x => x.lo), r.lo, 1e-6, 'lo');
    vec(m.means.map(x => x.hi), r.hi, 1e-6, 'hi');
    vec(m.means.map(x => x.fit), r.fit, 1e-7, 'fit');
    vec(m.means.map(x => x.fitLo), r.fit_lo, 1e-6, 'fit lo');
    vec(m.means.map(x => x.fitHi), r.fit_hi, 1e-6, 'fit hi');
    assert.deepEqual(m.pairs.map(p => p.a + ' - ' + p.b), arr(r.pairs));
    vec(m.pairs.map(p => p.diff), r.diff, 1e-7, 'diff');
    vec(m.pairs.map(p => p.se), r.pair_se, 1e-6, 'pair se');
    vec(m.pairs.map(p => p.t), r.t, 1e-6, 't');
    vec(m.pairs.map(p => p.p), r.p, 2e-5, 'p');
    vec(m.pairs.map(p => p.lo), r.lo_p, 2e-5, 'pair lo');
    vec(m.pairs.map(p => p.hi), r.hi_p, 2e-5, 'pair hi');
  });
}

test('the reference grid holds the continuous predictors at their means', () => {
  const g = referenceGrid(ds, fit(spec('ynorm', 'normal', 'identity', ['x', 'f'])));
  close(g.continuous.x, ref.grid_mean_x, 1e-12, 'mean x');
  assert.deepEqual(g.factors.f, ['a', 'b', 'c']);
});

test('effectGrid and binnedMeans', () => {
  const r = fit(spec('ycount', 'poisson', 'log', ['x', 'f', 'g']));
  const e = effectGrid(ds, r, 'x', 'f', 5);
  assert.equal(e.series.length, 3);
  assert.deepEqual(e.series.map(s => s.label), ['a', 'b', 'c']);
  assert.equal(e.series[0].rows.length, 5);
  assert.equal(e.series[0].rows[0].g, 'u', 'the other factor is held at its first level');
  close(e.series[0].rows[0].x, Math.min(...G.x), 1e-12, 'x from its least value');
  const e2 = effectGrid(ds, r, 'f', 'x');
  assert.deepEqual(e2.xLevels, ['a', 'b', 'c']);
  assert.equal(e2.series.length, 3, 'three quantiles of a continuous by');
  const b = binnedMeans([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [0, 0, 1, 0, 1, 1, 1, 0, 1, 1], 2);
  assert.deepEqual(b, [{ x: 3, y: 0.4, n: 5 }, { x: 8, y: 0.8, n: 5 }]);
});

// A fit with no usable standard errors: a normal model with as many
// coefficients as distinct rows (dispersion 0/0), and a singular design.
test('degenerateFit names a saturated normal fit and a singular design', async () => {
  const { EXAMPLES } = await import('../js/data/examples.js');
  const { sniff, buildTable } = await import('../js/io/parse.js');
  const { fitModel } = await import('../js/stats/fit.js');
  const { degenerateFit } = await import('../js/stats/inference.js');
  const ex = EXAMPLES.find(e => e.tour === 'chisq');
  const ds = buildTable(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).dataset;
  const terms = ['outcome', 'channel', { of: ['outcome', 'channel'] }];
  const base = { response: 'count', group: null, nested: null, slope: null, olre: false, reml: false, terms };
  const sat = fitModel(ds, Object.assign({}, base, { family: 'normal', link: 'identity' }));
  assert.match(degenerateFit(sat), /no residual degrees of freedom/);
  const pois = fitModel(ds, Object.assign({}, base, { family: 'poisson', link: 'log' }));
  assert.equal(degenerateFit(pois), null);
  const nb = fitModel(ds, Object.assign({}, base, { family: 'negbin', link: 'log' }));
  assert.ok(nb.flags.includes('singular'));
  assert.match(degenerateFit(nb), /singular/);
});

test('a prediction from an intercept-only model is the mean with its t interval', async () => {
  const { oneSampleT } = await import('../js/stats/classical.js');
  const y = [5.1, 4.8, 6.2, 5.5, 4.9, 5.8, 6.1, 5.0, 5.4, 4.7];
  const ds = makeDataset({ name: 'd', columns: [{ name: 'y', role: 'response', type: 'continuous' }], rows: y.map(v => [v]) });
  const r = fitModel(ds, { response: 'y', family: 'normal', link: 'identity', terms: [], group: null, nested: null, slope: null, olre: false, reml: false });
  const p = predictRows(ds, r, [{}], 0.95);
  const t = oneSampleT(y);
  const { tQuantile } = await import('../js/stats/special.js');
  const h = tQuantile(0.975, t.df) * t.se;
  assert.ok(Math.abs(p.fit[0] - t.mean) < 1e-12);
  assert.ok(Math.abs(p.se[0] - t.se) < 1e-10);
  assert.equal(p.df, t.df);
  assert.ok(Math.abs(p.fitLo[0] - (t.mean - h)) < 1e-8 && Math.abs(p.fitHi[0] - (t.mean + h)) < 1e-8);
  assert.deepEqual(referenceGrid(ds, r).names, []);
});
