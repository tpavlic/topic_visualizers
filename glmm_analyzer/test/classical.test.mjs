// Tests for js/stats/classical.js against reference/classical.R.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { oneSampleT, twoSampleT, onewayAnova, pairedT, chiSquareIndependence, twoProportions } from '../js/stats/classical.js';
import { EXAMPLES } from '../js/data/examples.js';
import { sniff, buildTable } from '../js/io/parse.js';
import { column } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'classical.json'), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const x = [5.1, 4.8, 6.2, 5.5, 4.9, 5.8, 6.1, 5.0, 5.4, 4.7], y = [6.0, 6.4, 5.9, 7.1, 6.6, 6.2, 5.8, 6.9];

test('the one-sample t test', () => {
  const r = oneSampleT(x, 5);
  close(r.t, ref.one.t, 1e-10, 't'); assert.equal(r.df, ref.one.df); close(r.p, ref.one.p, 1e-9, 'p');
  close(r.mean, ref.one.est, 1e-12, 'mean'); close(r.se, ref.one.se, 1e-10, 'se');
  assert.equal(oneSampleT(x).mean, r.mean);
});

// The two intercept-only fits of the Classic tests as GLMM page: a normal
// model with no predictor is the one-sample t test, and with a random
// intercept per day by REML it is the t test on the daily means.
function tour(which) {
  const ex = EXAMPLES.find(e => e.tour === which);
  return buildTable(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).dataset;
}

test('an intercept-only normal model is the one-sample t test', () => {
  const ds = tour('one');
  const r = fitModel(ds, { response: 'deviation', family: 'normal', link: 'identity', terms: [], group: null, nested: null, slope: null, olre: false, reml: false });
  const t = oneSampleT(ds.rows.map(v => v[0]));
  assert.deepEqual(r.names, ['(Intercept)']);
  close(r.fit.beta[0], t.mean, 1e-12, 'mean');
  close(Math.sqrt(r.fit.vcov[0][0]), t.se, 1e-10, 'se');
  assert.equal(r.fit.dfResidual, t.df);
});

test('an intercept-only mixed model by REML is the t test on the group means', () => {
  const ds = tour('repeated');
  const r = fitModel(ds, { response: 'deviation', family: 'normal', link: 'identity', terms: [], group: 'day', nested: null, slope: null, olre: false, reml: true });
  const di = column(ds, 'day');
  const means = di.col.levels.map(d => { const v = ds.rows.filter(x => x[di.index] === d).map(x => x[0]); return v.reduce((a, b) => a + b, 0) / v.length; });
  const t = oneSampleT(means);
  assert.equal(means.length, 10);
  assert.ok(r.fit.varcomp[0].variances[0] > 0, 'the between-day variance is above 0');
  close(r.fit.beta[0], t.mean, 1e-8, 'mean');
  close(Math.sqrt(r.fit.vcov[0][0]), t.se, 1e-6, 'se');
  // The t test on every order as if independent has a smaller standard error.
  assert.ok(oneSampleT(ds.rows.map(v => v[0])).se < 0.6 * t.se);
});

test('the two-sample t tests', () => {
  const r = twoSampleT(x, y);
  close(r.pooled.t, ref.pooled.t, 1e-10, 'pooled t'); assert.equal(r.pooled.df, ref.pooled.df); close(r.pooled.p, ref.pooled.p, 1e-9, 'pooled p');
  close(r.welch.t, ref.welch.t, 1e-10, 'welch t'); close(r.welch.df, ref.welch.df, 1e-10, 'welch df'); close(r.welch.p, ref.welch.p, 1e-9, 'welch p');
});

test('one-way ANOVA', () => {
  const r = onewayAnova([[2.1, 2.5, 1.9, 2.8, 2.2], [3.0, 2.7, 3.4, 3.1, 2.9], [2.4, 2.0, 2.6, 2.3, 2.7]]);
  close(r.F, ref.anova.F, 1e-10, 'F'); assert.equal(r.df1, ref.anova.df1); assert.equal(r.df2, ref.anova.df2); close(r.p, ref.anova.p, 1e-9, 'p');
});

test('the paired t test', () => {
  const r = pairedT([10.2, 9.8, 11.1, 10.5, 9.9, 10.8, 10.1, 9.6], [10.9, 10.1, 11.8, 10.9, 10.2, 11.5, 10.0, 10.3]);
  close(r.t, ref.paired.t, 1e-10, 't'); assert.equal(r.df, ref.paired.df); close(r.p, ref.paired.p, 1e-9, 'p'); close(r.meanDiff, ref.paired.est, 1e-12, 'mean difference');
});

test('the chi-square test of independence', () => {
  const r = chiSquareIndependence([[12, 20, 8], [15, 9, 24]]);
  close(r.X2, ref.chisq.X2, 1e-10, 'X2'); assert.equal(r.df, ref.chisq.df); close(r.pX, ref.chisq.p, 1e-9, 'p');
  close(r.G2, ref.chisq.G2, 1e-10, 'G2'); close(r.pG, ref.chisq.pG, 1e-9, 'pG');
});

test('the two-proportion test', () => {
  const r = twoProportions(14, 40, 22, 45);
  close(r.chisq, ref.prop.chisq, 1e-10, 'chisq'); close(r.p, ref.prop.p, 1e-9, 'p');
  close(r.p1, ref.prop.est[0], 1e-12, 'p1'); close(r.p2, ref.prop.est[1], 1e-12, 'p2');
});
