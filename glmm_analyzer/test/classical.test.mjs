// Tests for js/stats/classical.js against reference/classical.R.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { oneSampleT, twoSampleT, onewayAnova, twowayAnova, correlation, ancova, pairedT, chiSquareIndependence, chiSquareGoodnessOfFit, twoProportions } from '../js/stats/classical.js';
import { refitTerms } from '../js/stats/inference.js';
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

test('Pearson’s correlation and the least-squares line', () => {
  const r = correlation([1.2, 2.5, 3.1, 4.8, 5.0, 6.3, 7.7, 8.1, 9.4, 10.6], [3.0, 2.8, 4.9, 5.2, 7.1, 6.0, 8.8, 9.9, 9.1, 12.4]);
  close(r.r, ref.cor.r, 1e-12, 'r'); close(r.t, ref.cor.t, 1e-10, 't'); assert.equal(r.df, ref.cor.df); close(r.p, ref.cor.p, 1e-9, 'p');
  close(r.slope, ref.cor.slope, 1e-12, 'slope'); close(r.seSlope, ref.cor.seSlope, 1e-10, 'se'); close(r.intercept, ref.cor.intercept, 1e-12, 'intercept');
});

test('analysis of covariance', () => {
  const g = ['old', 'old', 'old', 'old', 'old', 'old', 'new', 'new', 'new', 'new', 'new', 'new'];
  const r = ancova([10.1, 12.3, 13.9, 16.2, 11.0, 14.8, 9.5, 11.7, 13.2, 10.4, 8.9, 12.0], g, [5.0, 8.1, 10.2, 13.5, 6.4, 11.0, 4.1, 7.9, 9.8, 6.0, 3.2, 8.4]);
  close(r.F, ref.ancova.F, 1e-10, 'F'); assert.equal(r.df, ref.ancova.df); assert.equal(r.dfResidual, ref.ancova.dfResidual); close(r.p, ref.ancova.p, 1e-9, 'p');
  close(r.ss, ref.ancova.ss, 1e-10, 'ss'); close(r.ssResidual, ref.ancova.ssResidual, 1e-10, 'residual ss');
  close(r.slope, ref.ancova.slope, 1e-12, 'slope');
  assert.deepEqual(r.levels, ['old', 'new']);
  close(r.adjustedMeans[1] - r.adjustedMeans[0], ref.ancova.adjustedDiff, 1e-12, 'adjusted difference');
});

test('two-way ANOVA on a balanced layout', () => {
  const y = [70.1, 72.4, 68.9, 71.5, 75.2, 77.8, 74.0, 76.9, 73.3, 71.0, 72.6, 74.9, 80.2, 83.5, 81.9, 84.1];
  const a = Array.from({ length: 16 }, (_, i) => i < 8 ? 'low' : 'high'), b = Array.from({ length: 16 }, (_, i) => (i % 8) < 4 ? 'A' : 'B');
  const r = twowayAnova(y, a, b);
  r.rows.forEach((row, i) => { close(row.ss, ref.twoway.ss[i], 1e-10, 'ss ' + row.term); assert.equal(row.df, ref.twoway.df[i]); close(row.F, ref.twoway.F[i], 1e-10, 'F ' + row.term); close(row.p, ref.twoway.p[i], 1e-9, 'p ' + row.term); });
  close(r.ssResidual, ref.twoway.ss[3], 1e-10, 'residual ss'); assert.equal(r.dfResidual, ref.twoway.df[3]);
});

test('the chi-square goodness-of-fit test', () => {
  const r = chiSquareGoodnessOfFit([16, 9, 12, 10, 26, 8]);
  close(r.X2, ref.gof.X2, 1e-10, 'X2'); assert.equal(r.df, ref.gof.df); close(r.pX, ref.gof.p, 1e-9, 'p');
  close(r.G2, ref.gof.G2, 1e-10, 'G2'); close(r.pG, ref.gof.pG, 1e-9, 'pG'); close(r.expected, ref.gof.expected, 1e-12, 'expected');
});

// The four fixed-effect identities the page draws on its own tour datasets.
test('a normal model with one continuous predictor is the correlation test', () => {
  const ds = tour('regression');
  const r = fitModel(ds, { response: 'delivery_time', family: 'normal', link: 'identity', terms: ['distance'], group: null, nested: null, slope: null, olre: false, reml: false });
  const xi = column(ds, 'distance');
  const c = correlation(ds.rows.map(x => x[xi.index]), ds.rows.map(x => x[0]));
  close(r.fit.beta[1], c.slope, 1e-10, 'slope'); close(r.fit.beta[0], c.intercept, 1e-10, 'intercept');
  close(Math.sqrt(r.fit.vcov[1][1]), c.seSlope, 1e-10, 'se'); assert.equal(r.fit.dfResidual, c.df);
  close(1 - r.fit.deviance / r.fit.nullDeviance, c.r * c.r, 1e-10, 'r squared');
});

test('a normal model with a factor and a covariate is the analysis of covariance', () => {
  const ds = tour('ancova');
  const spec = { response: 'time', family: 'normal', link: 'identity', terms: ['size', 'machine'], group: null, nested: null, slope: null, olre: false, reml: false };
  const r = fitModel(ds, spec);
  const mi = column(ds, 'machine'), si = column(ds, 'size');
  const a = ancova(ds.rows.map(x => x[0]), ds.rows.map(x => x[mi.index]), ds.rows.map(x => x[si.index]));
  const reduced = refitTerms(ds, spec, r, ['size']);
  const F = (reduced.deviance - r.fit.deviance) / (r.fit.deviance / r.fit.dfResidual);
  close(F, a.F, 1e-9, 'F'); assert.equal(r.fit.dfResidual, a.dfResidual);
  close(r.fit.beta[r.names.indexOf('size')], a.slope, 1e-10, 'slope');
  const km = r.names.findIndex(nm => nm.startsWith('machine'));
  const diff = (r.names[km] === 'machinenew' ? 1 : -1) * r.fit.beta[km];
  close(diff, a.adjustedMeans[a.levels.indexOf('new')] - a.adjustedMeans[a.levels.indexOf('old')], 1e-10, 'adjusted difference');
});

test('a normal model with two factors and their interaction is two-way ANOVA', () => {
  const ds = tour('twoway');
  const spec = { response: 'yield', family: 'normal', link: 'identity', terms: ['temperature', 'catalyst', { of: ['temperature', 'catalyst'] }], group: null, nested: null, slope: null, olre: false, reml: false };
  const r = fitModel(ds, spec);
  const ti = column(ds, 'temperature'), ci = column(ds, 'catalyst');
  const tw = twowayAnova(ds.rows.map(x => x[0]), ds.rows.map(x => x[ti.index]), ds.rows.map(x => x[ci.index]));
  const dA = refitTerms(ds, spec, r, ['temperature']).deviance, dAB = refitTerms(ds, spec, r, ['temperature', 'catalyst']).deviance;
  const ss = [r.fit.nullDeviance - dA, dA - dAB, dAB - r.fit.deviance];
  ss.forEach((v, i) => close(v, tw.rows[i].ss, 1e-9, 'ss ' + tw.rows[i].term));
  close(r.fit.deviance, tw.ssResidual, 1e-9, 'residual'); assert.equal(r.fit.dfResidual, tw.dfResidual);
  assert.equal(tw.dfResidual, 30);
});

test('an intercept-only Poisson model of counts is the goodness-of-fit test', () => {
  const ds = tour('gof');
  const r0 = fitModel(ds, { response: 'count', family: 'poisson', link: 'log', terms: [], group: null, nested: null, slope: null, olre: false, reml: false });
  const g = chiSquareGoodnessOfFit(ds.rows.map(x => x[0]));
  close(r0.fit.deviance, g.G2, 1e-8, 'G2 is the deviance');
  let X2 = 0; for (const v of r0.fit.pearson) X2 += v * v;
  close(X2, g.X2, 1e-8, 'X2 is the Pearson sum'); close(r0.fit.fitted[0], g.expected, 1e-8, 'expected'); assert.equal(r0.fit.dfResidual, g.df);
});
