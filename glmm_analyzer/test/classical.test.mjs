// Tests for js/stats/classical.js against reference/classical.R.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { twoSampleT, onewayAnova, pairedT, chiSquareIndependence, twoProportions } from '../js/stats/classical.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'classical.json'), 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ': ' + a + ' vs ' + b);
const x = [5.1, 4.8, 6.2, 5.5, 4.9, 5.8, 6.1, 5.0, 5.4, 4.7], y = [6.0, 6.4, 5.9, 7.1, 6.6, 6.2, 5.8, 6.9];

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
