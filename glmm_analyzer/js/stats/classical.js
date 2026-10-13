// The classical tests the Classic tests as GLMM page sets beside their
// models: the one-sample t test, the pooled and Welch two-sample t tests,
// one-way and balanced two-way ANOVA, Pearson's correlation with its t test
// and Spearman's on the ranks,
// analysis of covariance, the paired t test, the chi-square tests of
// independence and of goodness of fit with Pearson's and the likelihood-ratio
// statistics, and the two-proportion test as a score test.
// Conventions are R's (t.test, aov, cor.test, anova on lm, chisq.test with no
// continuity correction, prop.test with no correction). Pure functions, no DOM.

import { tCdf, fCdf, chi2Cdf, normCdf } from './special.js';
import { ranks } from './descriptive.js';

export { ranks };

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
 * The one-sample t test of a mean against mu0.
 * @param {ArrayLike<number>} x
 * @param {number} [mu0]
 * @returns {{ mean: number, se: number, t: number, df: number, p: number }}
 */
export function oneSampleT(x, mu0 = 0) {
  const m = meanVar(Array.from(x));
  const se = Math.sqrt(m.variance / m.n);
  const t = (m.mean - mu0) / se;
  return { mean: m.mean, se, t, df: m.n - 1, p: 2 * (1 - tCdf(Math.abs(t), m.n - 1)) };
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
 * Two-way analysis of variance on a balanced layout: the sums of squares of
 * the two factors, their interaction, and the residual, with F tests. On a
 * balanced layout, the sequential and the partial sums of squares coincide,
 * and so this is also what aov(y ~ a * b) reports.
 * @param {ArrayLike<number>} y
 * @param {ArrayLike<string>} a the first factor's level per observation
 * @param {ArrayLike<string>} b the second factor's level per observation
 * @returns {{ rows: { term: string, ss: number, df: number, F: number, p: number }[], ssResidual: number, dfResidual: number }}
 */
export function twowayAnova(y, a, b) {
  const n = y.length;
  const grand = meanVar(Array.from(y)).mean;
  const levelsA = [...new Set(Array.from(a))], levelsB = [...new Set(Array.from(b))];
  const means = (key) => {
    const sums = new Map();
    for (let i = 0; i < n; i++) {
      const k = key(i);
      const s = sums.get(k) || { n: 0, sum: 0 };
      s.n++; s.sum += y[i]; sums.set(k, s);
    }
    return sums;
  };
  const between = sums => { let ss = 0; for (const s of sums.values()) ss += s.n * (s.sum / s.n - grand) ** 2; return ss; };
  const mA = means(i => a[i]), mB = means(i => b[i]), mAB = means(i => a[i] + '\u0000' + b[i]);
  const ssA = between(mA), ssB = between(mB), ssCells = between(mAB);
  const ssAB = ssCells - ssA - ssB;
  let ssE = 0;
  for (let i = 0; i < n; i++) { const s = mAB.get(a[i] + '\u0000' + b[i]); ssE += (y[i] - s.sum / s.n) ** 2; }
  const dfA = levelsA.length - 1, dfB = levelsB.length - 1, dfAB = dfA * dfB, dfE = n - levelsA.length * levelsB.length;
  const row = (term, ss, df) => { const F = (ss / df) / (ssE / dfE); return { term, ss, df, F, p: 1 - fCdf(F, df, dfE) }; };
  return { rows: [row('a', ssA, dfA), row('b', ssB, dfB), row('a:b', ssAB, dfAB)], ssResidual: ssE, dfResidual: dfE };
}

/**
 * Pearson's correlation with its t test, as cor.test computes it, beside
 * the least-squares line of y on x.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @returns {{ r: number, t: number, df: number, p: number, slope: number, intercept: number, seSlope: number }}
 */
export function correlation(x, y) {
  const a = meanVar(Array.from(x)), b = meanVar(Array.from(y));
  let sxy = 0;
  for (let i = 0; i < a.n; i++) sxy += (x[i] - a.mean) * (y[i] - b.mean);
  const sxx = a.variance * (a.n - 1), syy = b.variance * (b.n - 1);
  const r = sxy / Math.sqrt(sxx * syy);
  const df = a.n - 2;
  const t = r * Math.sqrt(df / (1 - r * r));
  const slope = sxy / sxx, intercept = b.mean - slope * a.mean;
  const rss = syy - sxy * sxy / sxx;
  return { r, t, df, p: 2 * (1 - tCdf(Math.abs(t), df)), slope, intercept, seSlope: Math.sqrt(rss / df / sxx) };
}

/**
 * Spearman's rank correlation: Pearson's correlation of the two columns'
 * ranks, as cor(method = "spearman") computes it, ties averaged.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @returns {{ rho: number }}
 */
export function spearman(x, y) {
  return { rho: correlation(ranks(x), ranks(y)).r };
}

/**
 * Analysis of covariance with one factor and one covariate: the pooled
 * within-group slope, the group means adjusted to the covariate's grand
 * mean, and the F test of the factor adjusted for the covariate, which is
 * the factor's row of anova(lm(y ~ x + g)).
 * @param {ArrayLike<number>} y
 * @param {ArrayLike<string>} g the factor's level per observation
 * @param {ArrayLike<number>} x the covariate
 * @returns {{ slope: number, levels: string[], means: number[], adjustedMeans: number[], xMeans: number[], ss: number, df: number, F: number, p: number, ssResidual: number, dfResidual: number }}
 */
export function ancova(y, g, x) {
  const n = y.length;
  const levels = [...new Set(Array.from(g))];
  const xm = meanVar(Array.from(x)).mean, ym = meanVar(Array.from(y)).mean;
  // Total and pooled within-group corrected sums.
  let txx = 0, txy = 0, tyy = 0, wxx = 0, wxy = 0, wyy = 0;
  const stats = levels.map(l => {
    const idx = []; for (let i = 0; i < n; i++) if (g[i] === l) idx.push(i);
    const mx = meanVar(idx.map(i => x[i])).mean, my = meanVar(idx.map(i => y[i])).mean;
    for (const i of idx) { wxx += (x[i] - mx) ** 2; wxy += (x[i] - mx) * (y[i] - my); wyy += (y[i] - my) ** 2; }
    return { mx, my };
  });
  for (let i = 0; i < n; i++) { txx += (x[i] - xm) ** 2; txy += (x[i] - xm) * (y[i] - ym); tyy += (y[i] - ym) ** 2; }
  const slope = wxy / wxx;
  const ssResidual = wyy - wxy * wxy / wxx;
  const ssAfterX = tyy - txy * txy / txx;
  const ss = ssAfterX - ssResidual;
  const df = levels.length - 1, dfResidual = n - levels.length - 1;
  const F = (ss / df) / (ssResidual / dfResidual);
  return { slope, levels, means: stats.map(s => s.my), adjustedMeans: stats.map(s => s.my - slope * (s.mx - xm)), xMeans: stats.map(s => s.mx), ss, df, F, p: 1 - fCdf(F, df, dfResidual), ssResidual, dfResidual };
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
 * The chi-square goodness-of-fit test of counts against equal expected
 * counts: Pearson's X² and the likelihood-ratio G², both on k − 1 degrees of
 * freedom.
 * @param {ArrayLike<number>} counts
 * @returns {{ X2: number, G2: number, df: number, pX: number, pG: number, expected: number }}
 */
export function chiSquareGoodnessOfFit(counts) {
  const k = counts.length;
  let total = 0;
  for (const c of counts) total += c;
  const expected = total / k;
  let X2 = 0, G2 = 0;
  for (const o of counts) { X2 += (o - expected) ** 2 / expected; if (o > 0) G2 += 2 * o * Math.log(o / expected); }
  const df = k - 1;
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
