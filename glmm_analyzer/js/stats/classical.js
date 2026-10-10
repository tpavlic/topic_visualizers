// The classical tests the Tests as models page sets beside their models:
// the pooled and Welch two-sample t tests, one-way ANOVA's F, the paired t
// test, the chi-square test of independence with Pearson's and the
// likelihood-ratio statistics, and the two-proportion test as a score test.
// Conventions are R's (t.test, aov, chisq.test with no continuity
// correction, prop.test with no correction). Pure functions, no DOM.

import { tCdf, fCdf, chi2Cdf, normCdf } from './special.js';

function meanVar(a) {
  const n = a.length;
  let m = 0;
  for (const v of a) m += v;
  m /= n;
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return { n, mean: m, variance: n > 1 ? s / (n - 1) : NaN };
}

/**
 * The two-sample t tests: pooled (equal variances) and Welch.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @returns {{ diff: number, pooled: { t: number, df: number, p: number, se: number }, welch: { t: number, df: number, p: number, se: number } }}
 */
export function twoSampleT(x, y) {
  const a = meanVar(Array.from(x)), b = meanVar(Array.from(y));
  const diff = a.mean - b.mean;
  const sp2 = ((a.n - 1) * a.variance + (b.n - 1) * b.variance) / (a.n + b.n - 2);
  const seP = Math.sqrt(sp2 * (1 / a.n + 1 / b.n));
  const tP = diff / seP, dfP = a.n + b.n - 2;
  const va = a.variance / a.n, vb = b.variance / b.n;
  const seW = Math.sqrt(va + vb);
  const tW = diff / seW, dfW = (va + vb) ** 2 / (va * va / (a.n - 1) + vb * vb / (b.n - 1));
  return { diff, pooled: { t: tP, df: dfP, p: 2 * (1 - tCdf(Math.abs(tP), dfP)), se: seP }, welch: { t: tW, df: dfW, p: 2 * (1 - tCdf(Math.abs(tW), dfW)), se: seW } };
}

/**
 * One-way analysis of variance.
 * @param {ArrayLike<number>[]} groups
 * @returns {{ F: number, df1: number, df2: number, p: number, ssBetween: number, ssWithin: number }}
 */
export function onewayAnova(groups) {
  const all = [];
  for (const g of groups) for (const v of g) all.push(v);
  const grand = meanVar(all).mean;
  let ssB = 0, ssW = 0;
  for (const g of groups) {
    const m = meanVar(Array.from(g));
    ssB += m.n * (m.mean - grand) ** 2;
    for (const v of g) ssW += (v - m.mean) ** 2;
  }
  const df1 = groups.length - 1, df2 = all.length - groups.length;
  const F = (ssB / df1) / (ssW / df2);
  return { F, df1, df2, p: 1 - fCdf(F, df1, df2), ssBetween: ssB, ssWithin: ssW };
}

/**
 * The paired t test on x − y.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @returns {{ meanDiff: number, t: number, df: number, p: number, se: number }}
 */
export function pairedT(x, y) {
  const d = Array.from(x, (v, i) => v - y[i]);
  const m = meanVar(d);
  const se = Math.sqrt(m.variance / m.n);
  const t = m.mean / se;
  return { meanDiff: m.mean, t, df: m.n - 1, p: 2 * (1 - tCdf(Math.abs(t), m.n - 1)), se };
}

/**
 * The chi-square test of independence on a table of counts: Pearson's X²
 * and the likelihood-ratio G², both on (r − 1)(c − 1) degrees of freedom.
 * @param {number[][]} table rows by columns
 * @returns {{ X2: number, G2: number, df: number, pX: number, pG: number, expected: number[][] }}
 */
export function chiSquareIndependence(table) {
  const r = table.length, c = table[0].length;
  const rowSum = table.map(row => row.reduce((a, b) => a + b, 0));
  const colSum = Array.from({ length: c }, (_, j) => table.reduce((a, row) => a + row[j], 0));
  const total = rowSum.reduce((a, b) => a + b, 0);
  let X2 = 0, G2 = 0;
  const expected = table.map((row, i) => row.map((o, j) => {
    const e = rowSum[i] * colSum[j] / total;
    X2 += (o - e) * (o - e) / e;
    if (o > 0) G2 += 2 * o * Math.log(o / e);
    return e;
  }));
  const df = (r - 1) * (c - 1);
  return { X2, G2, df, pX: 1 - chi2Cdf(X2, df), pG: 1 - chi2Cdf(G2, df), expected };
}

/**
 * The two-proportion test as a score test with the pooled proportion and no
 * continuity correction, as prop.test(correct = FALSE) computes it (its
 * chi-square is this z squared).
 * @param {number} x1 successes in group 1
 * @param {number} n1
 * @param {number} x2
 * @param {number} n2
 * @returns {{ p1: number, p2: number, diff: number, z: number, p: number, chisq: number }}
 */
export function twoProportions(x1, n1, x2, n2) {
  const p1 = x1 / n1, p2 = x2 / n2, pp = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2));
  const z = (p1 - p2) / se;
  return { p1, p2, diff: p1 - p2, z, p: 2 * (1 - normCdf(Math.abs(z))), chisq: z * z };
}
