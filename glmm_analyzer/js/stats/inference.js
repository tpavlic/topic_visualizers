// Inference from a fitted model beyond its coefficient table: the term
// tests (each term dropped and the model refitted), predictions at new
// predictor values with their intervals on both scales, the reference grid
// and the marginal means of a categorical predictor with their pairwise
// comparisons under Tukey's correction. Conventions follow R's drop1,
// predict.glm, and emmeans. Pure functions, no DOM.

import { column } from '../data/model.js';
import { FAMILIES, LINKS } from './families.js';
import { modelMatrix, newDataMatrix, orderedTerms, termLabel, termVars } from './design.js';
import { fitGlm } from './glm.js';
import { fitNegbin } from './negbin.js';
import { chi2Cdf, normCdf, normInv, tCdf, tQuantile, ptukey, qtukey } from './special.js';

/**
 * The degrees of freedom the Wald and Tukey procedures use: the residual
 * degrees of freedom where the dispersion is estimated, infinite otherwise.
 * @param {object} fit
 */
export function waldDf(fit) {
  if (fit.mixed) return Infinity;
  return FAMILIES[fit.family].dispersion === 'estimated' ? fit.dfResidual : Infinity;
}

/** The two-sided quantile at `level` on `df` degrees of freedom (normal when infinite). */
export function waldQuantile(level, df) {
  return Number.isFinite(df) ? tQuantile(1 - (1 - level) / 2, df) : normInv(1 - (1 - level) / 2);
}

/** The two-sided p-value of a Wald statistic on `df` degrees of freedom. */
export function waldP(z, df) {
  const a = Math.abs(z);
  return Number.isFinite(df) ? 2 * (1 - tCdf(a, df)) : 2 * (1 - normCdf(a));
}

// Refits the fixed part with the given terms, holding the negative
// binomial's θ at the full fit's value, as drop1 holds the family fixed.
function refitTerms(ds, spec, full, terms) {
  // A mixed model is refitted whole, by maximum likelihood, keeping its random part.
  if (spec.group || spec.olre) return full.refit(ds, Object.assign({}, spec, { terms, reml: false })).fit;
  const s = Object.assign({}, spec, { terms, group: null, nested: null, slope: null, olre: false });
  const y = full.codedY;
  if (spec.family === 'negbin') return fitGlm(y, modelMatrix(ds, s).X, { family: 'negbin', link: spec.link, aux: full.fit.theta });
  // The beta and ordinal fitters re-estimate every parameter in the reduced model.
  if (spec.family === 'beta' || spec.family === 'ordinal') return full.refit(ds, s).fit;
  return fitGlm(y, modelMatrix(ds, s).X, { family: spec.family, link: spec.link });
}

/**
 * The term tests, as drop1(test = "Chisq"): each term whose main effects
 * no interaction still needs is dropped and the model refitted. The
 * statistic is the likelihood-ratio statistic: the change in deviance where
 * the dispersion is fixed, the change in deviance over the full model's
 * dispersion (the scaled deviance) for the gamma family, and n times the
 * log of the deviance ratio for the normal family, with σ² profiled out;
 * each on the change in parameter count.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} spec
 * @param {object} result fitModel's output, with `codedY`
 * @returns {{ rows: { term: string, df: number, stat: number, p: number, deviance: number }[], scaled: boolean }}
 */
export function termTests(ds, spec, result) {
  const terms = orderedTerms(spec);
  // A REML fit is compared by maximum likelihood, as a likelihood-ratio test needs.
  const full = result.fit.reml ? result.refit(ds, Object.assign({}, spec, { reml: false })).fit : result.fit;
  const scaled = !full.mixed && FAMILIES[full.family].dispersion === 'estimated';
  const rows = [];
  terms.forEach((t, i) => {
    const vars = termVars(t);
    // Marginality: a term is kept when a higher-order term holds all its variables.
    const needed = terms.some((u, j) => j !== i && typeof u === 'object' && u.of && vars.every(v => u.of.includes(v)) && u.of.length > vars.length);
    if (needed) return;
    const reduced = refitTerms(ds, spec, result, terms.filter((_, j) => j !== i));
    const df = full.df - reduced.df;
    // drop1's statistic: for the normal family the likelihood ratio with σ²
    // profiled out, n log(deviance ratio); for the gamma the deviance change
    // over the dispersion; and for a fixed dispersion the deviance change.
    const stat = full.mixed || !Number.isFinite(full.deviance) ? 2 * (full.logLik - reduced.logLik)
      : full.family === 'normal' ? full.n * Math.log(reduced.deviance / full.deviance)
        : (reduced.deviance - full.deviance) / (scaled ? full.dispersion : 1);
    rows.push({ term: termLabel(t), df, stat: Math.max(0, stat), p: df > 0 ? 1 - chi2Cdf(Math.max(0, stat), df) : NaN, deviance: Number.isFinite(reduced.deviance) ? reduced.deviance : -2 * reduced.logLik });
  });
  return { rows, scaled };
}

/**
 * Predictions at new predictor values: the linear predictor with its
 * standard error and Wald interval, and the mean on the response scale with
 * the interval carried through the inverse link.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} result fitModel's output
 * @param {Object<string, number|string>[]} newRows
 * @param {number} level
 * @returns {{ eta: Float64Array, se: Float64Array, lo: Float64Array, hi: Float64Array, fit: Float64Array, fitLo: Float64Array, fitHi: Float64Array, df: number, q: number }}
 */
export function predictRows(ds, result, newRows, level) {
  const X = newDataMatrix(ds, result.design, newRows);
  const b = result.fit.beta, V = result.fit.vcov;
  const link = LINKS[result.link];
  const df = waldDf(result.fit), q = waldQuantile(level, df);
  const n = X.length, p = b.length;
  const eta = new Float64Array(n), se = new Float64Array(n), lo = new Float64Array(n), hi = new Float64Array(n);
  const fit = new Float64Array(n), fitLo = new Float64Array(n), fitHi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = X[i];
    let e = 0, v = 0;
    for (let a = 0; a < p; a++) { e += x[a] * b[a]; let t = 0; for (let c = 0; c < p; c++) t += V[a][c] * x[c]; v += x[a] * t; }
    eta[i] = e; se[i] = Math.sqrt(Math.max(0, v)); lo[i] = e - q * se[i]; hi[i] = e + q * se[i];
    fit[i] = link.linkinv(e);
    const a1 = link.linkinv(lo[i]), a2 = link.linkinv(hi[i]);
    fitLo[i] = Math.min(a1, a2); fitHi[i] = Math.max(a1, a2);
  }
  return { eta, se, lo, hi, fit, fitLo, fitHi, df, q };
}

/**
 * The reference grid's settings, as emmeans forms them: each continuous
 * predictor at its mean over the rows the model used, and each categorical
 * or ordinal predictor's levels.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} result
 * @returns {{ continuous: Object<string, number>, factors: Object<string, string[]>, names: string[] }}
 */
export function referenceGrid(ds, result) {
  const names = [];
  for (const t of result.design.terms) for (const v of termVars(t)) if (!names.includes(v)) names.push(v);
  const continuous = {}, factors = {};
  for (const name of names) {
    const c = column(ds, name);
    if (c.col.type === 'continuous') {
      let s = 0;
      for (const i of result.design.keep) s += ds.rows[i][c.index];
      continuous[name] = s / result.design.keep.length;
    } else factors[name] = c.col.levels.slice();
  }
  return { continuous, factors, names };
}

// Every combination of the given factors' levels, as objects.
function combos(factors, names) {
  let out = [{}];
  for (const f of names) {
    const next = [];
    for (const o of out) for (const l of factors[f]) next.push(Object.assign({}, o, { [f]: l }));
    out = next;
  }
  return out;
}

/**
 * The marginal means of a categorical predictor and their pairwise
 * comparisons, as emmeans and pairs() with Tukey's correction form them:
 * each level's mean of the linear predictor over the other factors' levels
 * with equal weights and the continuous predictors at their means, carried
 * to the response scale; the differences on the link scale, with their Tukey
 * intervals and p-values, and as ratios where the link gives one.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} result
 * @param {string} factor
 * @param {number} level
 */
export function marginalMeans(ds, result, factor, level) {
  const grid = referenceGrid(ds, result);
  const others = Object.keys(grid.factors).filter(f => f !== factor);
  const levels = grid.factors[factor];
  if (!levels) throw new Error(factor + ' is not a categorical predictor of the model.');
  const b = result.fit.beta, V = result.fit.vcov, p = b.length;
  const link = LINKS[result.link];
  const df = waldDf(result.fit), k = levels.length;
  const q = waldQuantile(level, df);
  const xbars = levels.map(l => {
    const rows = combos(grid.factors, others).map(o => Object.assign({}, grid.continuous, o, { [factor]: l }));
    const X = newDataMatrix(ds, result.design, rows);
    const xb = new Float64Array(p);
    for (const x of X) for (let a = 0; a < p; a++) xb[a] += x[a] / X.length;
    return xb;
  });
  const quad = (x, z) => { let v = 0; for (let a = 0; a < p; a++) { let t = 0; for (let c = 0; c < p; c++) t += V[a][c] * z[c]; v += x[a] * t; } return v; };
  const dot = x => { let e = 0; for (let a = 0; a < p; a++) e += x[a] * b[a]; return e; };
  const means = levels.map((l, i) => {
    const eta = dot(xbars[i]), se = Math.sqrt(Math.max(0, quad(xbars[i], xbars[i])));
    const lo = eta - q * se, hi = eta + q * se;
    const a1 = link.linkinv(lo), a2 = link.linkinv(hi);
    return { level: l, eta, se, lo, hi, fit: link.linkinv(eta), fitLo: Math.min(a1, a2), fitHi: Math.max(a1, a2) };
  });
  const qt = k > 1 ? qtukey(level, k, df) / Math.SQRT2 : q;
  const pairs = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const c = Float64Array.from(xbars[i], (v, a) => v - xbars[j][a]);
      const diff = dot(c), se = Math.sqrt(Math.max(0, quad(c, c)));
      const t = diff / se;
      const pv = k > 1 ? 1 - ptukey(Math.abs(t) * Math.SQRT2, k, df) : waldP(t, df);
      const lo = diff - qt * se, hi = diff + qt * se;
      const pr = { a: levels[i], b: levels[j], diff, se, t, p: pv, lo, hi };
      if (link.backName) { pr.ratio = Math.exp(diff); pr.ratioLo = Math.exp(lo); pr.ratioHi = Math.exp(hi); }
      pairs.push(pr);
    }
  }
  return { factor, levels, means, pairs, df, k, grid };
}

/**
 * The rows of an effect plot: `x` over `n` points from its least to its
 * greatest used value (or over its levels), the `by` predictor at each of
 * its levels or at three quantiles, and every other predictor at its mean
 * or its first level.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} result
 * @param {string} x
 * @param {string|null} by
 * @param {number} [n]
 * @returns {{ series: { label: string|null, by: number|string|null, rows: object[], xs: (number|string)[] }[], xLevels: string[]|null, held: Object<string, number|string> }}
 */
export function effectGrid(ds, result, x, by, n = 60) {
  const grid = referenceGrid(ds, result);
  const held = {};
  for (const name of grid.names) if (name !== x && name !== by) held[name] = name in grid.continuous ? grid.continuous[name] : grid.factors[name][0];
  const cx = column(ds, x);
  let xs;
  if (cx.col.type === 'continuous') {
    let lo = Infinity, hi = -Infinity;
    for (const i of result.design.keep) { const v = ds.rows[i][cx.index]; if (v < lo) lo = v; if (v > hi) hi = v; }
    xs = Array.from({ length: n }, (_, i) => lo + (hi - lo) * i / (n - 1));
  } else xs = cx.col.levels.slice();
  let byValues = [null];
  if (by) {
    const cb = column(ds, by);
    if (cb.col.type === 'continuous') {
      const v = result.design.keep.map(i => ds.rows[i][cb.index]).sort((a, c) => a - c);
      const at = pq => v[Math.min(v.length - 1, Math.max(0, Math.round(pq * (v.length - 1))))];
      byValues = [at(0.25), at(0.5), at(0.75)];
    } else byValues = cb.col.levels.slice();
  }
  const series = byValues.map(bv => ({
    label: by ? (typeof bv === 'number' ? by + ' = ' + Number(bv.toPrecision(4)) : String(bv)) : null,
    by: bv,
    rows: xs.map(xv => Object.assign({}, held, { [x]: xv }, by ? { [by]: bv } : {})),
    xs
  }));
  return { series, xLevels: cx.col.type === 'continuous' ? null : xs, held };
}

/**
 * The observed response binned along a continuous predictor, for the data
 * overlay of an effect plot: up to `bins` bins of about equal count, each
 * giving the mean of x and the mean of y.
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @param {number} [bins]
 */
export function binnedMeans(x, y, bins = 10) {
  const idx = Array.from(x, (_, i) => i).filter(i => Number.isFinite(x[i]) && Number.isFinite(y[i])).sort((a, b) => x[a] - x[b]);
  const n = idx.length;
  const k = Math.max(1, Math.min(bins, Math.floor(n / 5)));
  const out = [];
  for (let b = 0; b < k; b++) {
    const from = Math.floor(b * n / k), to = Math.floor((b + 1) * n / k);
    if (to <= from) continue;
    let sx = 0, sy = 0;
    for (let i = from; i < to; i++) { sx += x[idx[i]]; sy += y[idx[i]]; }
    out.push({ x: sx / (to - from), y: sy / (to - from), n: to - from });
  }
  return out;
}

/**
 * The p-value of a likelihood-ratio statistic for k variance parameters
 * tested at the edge of their range (Self and Liang; Stram and Lee): half
 * the chi-square tail on one degree of freedom for a single variance; the
 * 1/4 : 1/2 : 1/4 mixture of the tails on 0, 1, and 2 for two independent
 * variances (a nested factor or an observation-level effect beside the
 * group); and, where a random slope brings its covariance in, the plain
 * chi-square tail on k, which is conservative, as that case has no simple
 * mixture.
 * @param {number} stat
 * @param {number} k
 * @param {boolean} withSlope
 * @returns {{ p: number, null: 'half'|'quarter'|'chisq' }}
 */
export function boundaryP(stat, k, withSlope) {
  const upper = (x, d) => (d <= 0 ? (x > 0 ? 0 : 1) : 1 - chi2Cdf(x, d));
  if (k === 1) return { p: 0.5 * upper(stat, 0) + 0.5 * upper(stat, 1), null: 'half' };
  if (k === 2 && !withSlope) return { p: 0.25 * upper(stat, 0) + 0.5 * upper(stat, 1) + 0.25 * upper(stat, 2), null: 'quarter' };
  return { p: upper(stat, k), null: 'chisq' };
}

/**
 * The likelihood-ratio test of the random part: the mixed model (refitted
 * by maximum likelihood when it was fitted by REML) against the same fixed
 * part without random effects, with the p-value from `boundaryP`.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} spec
 * @param {object} result
 * @returns {{ stat: number, k: number, p: number, null: string, llMixed: number, llFixed: number }}
 */
export function randomEffectTest(ds, spec, result) {
  const mixed = result.fit.reml ? result.refit(ds, Object.assign({}, spec, { reml: false })).fit : result.fit;
  const fixed = result.refit(ds, Object.assign({}, spec, { group: null, nested: null, slope: null, olre: false, reml: false })).fit;
  const stat = Math.max(0, 2 * (mixed.logLik - fixed.logLik));
  const k = mixed.df - fixed.df;
  const b = boundaryP(stat, k, !!spec.slope);
  return { stat, k, p: b.p, null: b.null, llMixed: mixed.logLik, llFixed: fixed.logLik };
}

/**
 * The coefficient table: estimate, standard error, the Wald statistic and
 * its p-value, and the interval at `level`, with the back-transformed ratio
 * where the link gives one (never for the intercept).
 * @param {object} result fitModel's output
 * @param {number} level
 */
export function waldTable(result, level) {
  const fit = result.fit;
  const df = waldDf(fit);
  const q = waldQuantile(level, df);
  const link = LINKS[result.link];
  return result.names.map((name, j) => {
    const b = fit.beta[j], se = fit.vcov ? Math.sqrt(fit.vcov[j][j]) : NaN;
    const z = b / se;
    const lo = b - q * se, hi = b + q * se;
    const back = link.backName && name !== '(Intercept)' ? { est: Math.exp(b), lo: Math.exp(lo), hi: Math.exp(hi) } : null;
    return { name, b, se, z, p: waldP(z, df), lo, hi, back, useT: Number.isFinite(df), df };
  });
}
