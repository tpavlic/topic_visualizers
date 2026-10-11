// Recipes for the regenerate scripts: what a page computed, gathered into
// one object that analysis_scripts.js turns into a script in any language.
// A recipe holds the page id and title, the provenance, the data the model
// used (the columns it reads, with each factor's levels), the specification
// with the formula written for each language, the coefficient names as the
// page prints them, the extra columns a language needs (a raw power, an
// ordinal predictor's polynomial contrasts for MATLAB), and `expect`, the
// analyzer's value of every number the script reports, under the names the
// script prints. Pure functions, no DOM.

import { column, usedRows } from '../data/model.js';
import { csvFileName, uniformsFileName, MAX_NUMBERS } from './datafiles.js';
import { FAMILIES, LINKS, linkOf } from '../stats/families.js';
import { orderedTerms, termLabel, termVars, polyNames } from '../stats/design.js';
import { pyName } from './analysis_scripts.js';

export { MAX_NUMBERS } from './datafiles.js';

// The value of a report key, as the scripts print it: a number, or 1/0 for a flag.
export const ex = v => (typeof v === 'number' ? v : (v === true ? 1 : v === false ? 0 : v));

/**
 * The formula's right-hand side in each language. A raw power is `I(x^2)` in
 * R, `I(x ** 2)` in Python, and a computed column `x_pow2` in MATLAB; an
 * ordinal predictor's polynomial contrasts are automatic in R (an ordered
 * factor), `C(o, Poly)` in Python, and computed columns `o_L`, `o_Q`, ... in
 * MATLAB.
 * @param {object} spec
 * @param {import('../data/model.js').Dataset} ds
 * @returns {{ R: string, py: string, m: string, terms: string[], extraCols: {m: object[], py: object[]} }}
 */
export function formulaParts(spec, ds) {
  const terms = orderedTerms(spec);
  const ord = name => { const c = column(ds, name); return c && c.col.type === 'ordinal'; };
  const extraM = [], extraPy = [];
  const piece = (t, lang) => {
    if (typeof t === 'string') {
      if (ord(t)) {
        if (lang === 'py') return 'C(' + pyName(t) + ', Poly)';
        if (lang === 'm') {
          const k = column(ds, t).col.levels.length;
          const names = polyNames(k).map(s => t + s.replace('.', '_').replace('^', '_'));
          if (!extraM.some(e => e.name === t)) extraM.push({ kind: 'poly', name: t, k, cols: names });
          return names.join(' + ');
        }
      }
      return lang === 'py' ? pyName(t) : t;
    }
    if (t.degree) {
      if (lang === 'R') return 'I(' + t.name + '^' + t.degree + ')';
      if (lang === 'py') return 'I(' + pyName(t.name) + ' ** ' + t.degree + ')';
      const nm = t.name + '_pow' + t.degree;
      if (!extraM.some(e => e.name === nm)) extraM.push({ kind: 'power', name: nm, of: t.name, degree: t.degree });
      return nm;
    }
    // An interaction of ordinal predictors in MATLAB would need every product; the
    // page's ordinal predictors enter MATLAB interactions through their first
    // contrast only, and the script says so.
    return t.of.map(v => (lang === 'm' && ord(v) ? piece(v, 'm').split(' + ')[0] : piece(v, lang))).join(':');
  };
  const rhs = lang => (terms.length ? terms.map(t => piece(t, lang)).join(' + ') : '1');
  const random = (lang) => {
    let s = '';
    if (spec.group) {
      const inner = spec.slope ? '1 + ' + spec.slope : '1';
      s += ' + (' + inner + ' | ' + spec.group + ')';
      if (spec.nested) s += ' + (1 | ' + spec.group + ':' + spec.nested + ')';
    }
    if (spec.olre) s += ' + (1 | obs)';
    return s;
  };
  const y = spec.response;
  return {
    R: y + ' ~ ' + rhs('R') + random('R'),
    py: pyName(y) + ' ~ ' + rhs('py'),
    m: y + ' ~ ' + rhs('m') + random('m'),
    terms: terms.map(termLabel),
    extraCols: { m: extraM, py: extraPy }
  };
}

/**
 * The data a model reads: the columns the spec uses (response, predictors,
 * groups), every row with the cells as the dataset holds them (null for a
 * missing value, which each language's fitter drops as the page did), and
 * each factor's levels.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object[]} specs one or more specs whose columns are gathered
 * @returns {{ columns: { name: string, type: string, levels: string[]|null }[], rows: (number|string|null)[][], n: number }}
 */
export function dataFor(ds, specs) {
  const names = [];
  for (const spec of specs) {
    const add = v => { if (v && !names.includes(v)) names.push(v); };
    add(spec.response);
    for (const t of orderedTerms(spec)) for (const v of termVars(t)) add(v);
    add(spec.group); add(spec.nested); add(spec.slope);
  }
  const cols = names.map(n => column(ds, n)).filter(Boolean);
  const columns = cols.map(c => ({ name: c.col.name, type: c.col.type, levels: c.col.levels ? c.col.levels.slice() : null }));
  const rows = ds.rows.map(r => cols.map(c => r[c.index]));
  return { columns, rows, n: rows.length };
}

/**
 * The recipe's common part.
 * @param {{ page: string, title: string, provenance: object, level: number, ds: object, spec: object, result: object }} o
 */
export function baseRecipe({ page, title, provenance, level, ds, spec, result }) {
  const f = formulaParts(spec, ds);
  const fit = result.fit;
  const link = linkOf(spec.family, spec.link);
  const rc = column(ds, spec.response).col;
  const mixed = !!(spec.group || spec.olre);
  return {
    page, title, provenance: Object.assign({}, provenance), level,
    dataset: ds.name,
    data: dataFor(ds, [spec]),
    spec: { response: spec.response, family: spec.family, link: link.id, group: spec.group || null, nested: spec.nested || null, slope: spec.slope || null, olre: !!spec.olre, reml: !!spec.reml, mixed },
    formula: { R: f.R, py: f.py, m: f.m },
    terms: f.terms,
    extraCols: f.extraCols,
    names: result.names.slice(),
    response: { event: result.event || null, levels: rc.type !== 'continuous' ? rc.levels.slice() : null, type: rc.type },
    zetaNames: fit.zetaNames ? fit.zetaNames.slice() : null,
    dfWald: fit.mixed ? Infinity : (FAMILIES[fit.family].dispersion === 'estimated' ? fit.dfResidual : Infinity),
    expect: {}
  };
}

/** Whether the data would run past the cap. */
export function tooBig(ds, specs) {
  const d = dataFor(ds, specs);
  return d.rows.length * d.columns.length > MAX_NUMBERS;
}

/**
 * Puts a recipe in CSV mode, for data past the cap: its scripts embed no
 * data and read the dataset's data file and (on the Diagnostics page, for
 * a discrete family) the file of the residuals' uniforms, from the script's
 * folder. The recipe keeps its `expect` values and, for the harness, its
 * uniforms.
 * @param {object} recipe
 * @param {object} ds
 */
export function csvMode(recipe, ds) {
  recipe.csvOnly = true;
  recipe.data = Object.assign({}, recipe.data, { rows: [] });
  recipe.csvFile = csvFileName(ds);
  if (recipe.uniforms) recipe.uniformsFile = uniformsFileName(ds);
  return recipe;
}

/** The recipe as built, or in CSV mode where the data run past the cap. */
export function capRecipe(recipe, ds, specs) {
  return tooBig(ds, specs) ? csvMode(recipe, ds) : recipe;
}

// The expect entries every fit reports.
function fitExpect(r, result, waldRows, prefix = '') {
  const fit = result.fit;
  const e = r.expect;
  waldRows.forEach(w => {
    e[prefix + 'coef ' + w.name] = w.b;
    e[prefix + 'se ' + w.name] = w.se;
    e[prefix + 'lower ' + w.name] = w.lo;
    e[prefix + 'upper ' + w.name] = w.hi;
  });
  e[prefix + 'log-likelihood'] = fit.logLik;
  e[prefix + 'parameters'] = fit.df;
  e[prefix + 'AIC'] = fit.aic;
  e[prefix + 'BIC'] = fit.bic;
  if (!fit.mixed && (fit.family === 'normal' || fit.family === 'binomial' || fit.family === 'poisson' || fit.family === 'gamma' || fit.family === 'negbin')) {
    e[prefix + 'deviance'] = fit.deviance;
    e[prefix + 'null deviance'] = fit.nullDeviance;
  }
  if (fit.mixed) e[prefix + 'deviance'] = fit.deviance;
  if (fit.family === 'ordinal') e[prefix + 'deviance'] = fit.deviance;
  if (!fit.mixed && FAMILIES[fit.family].dispersion === 'estimated') e[prefix + 'dispersion'] = fit.dispersion;
  if (fit.family === 'negbin') e[prefix + 'theta'] = fit.theta;
  if (fit.family === 'beta') e[prefix + 'phi'] = fit.phi;
  if (fit.family === 'ordinal') fit.zetaNames.forEach((n, k) => { e[prefix + 'threshold ' + n] = fit.zeta[k]; });
  if (fit.mixed) {
    fit.varcomp.forEach(v => {
      v.names.forEach((nm, i) => { e[prefix + 'variance ' + v.term + ' ' + (nm === 'slope' ? 'slope' : '(Intercept)')] = v.variances[i]; });
      if (v.correlation != null) e[prefix + 'correlation ' + v.term] = v.correlation;
    });
    if (fit.family === 'normal') e[prefix + 'residual variance'] = fit.sigma2;
  }
}

/**
 * The Model page's recipe.
 * @param {object} o `{ ds, spec, result, level, title, provenance, waldRows, termTests, randomTest }`
 */
export function modelRecipe(o) {
  const r = baseRecipe(Object.assign({ page: 'model' }, o));
  fitExpect(r, o.result, o.waldRows);
  r.termTests = (o.termTests ? o.termTests.rows : []).map(t => ({ term: t.term, df: t.df, reduced: reducedFormulas(o.spec, o.ds, t.term) }));
  for (const t of (o.termTests ? o.termTests.rows : [])) { r.expect['LRT ' + t.term] = t.stat; r.expect['LRT p ' + t.term] = t.p; }
  if (o.randomTest) {
    r.randomTest = { k: o.randomTest.k, fixed: reducedFormulas(Object.assign({}, o.spec, { group: null, nested: null, slope: null, olre: false }), o.ds, null) };
    r.expect['random LRT'] = o.randomTest.stat;
    r.expect['random p'] = o.randomTest.p;
  }
  return r;
}

// The formulas of the model without one term (or, with no term, as given), in each language.
function reducedFormulas(spec, ds, term) {
  const terms = orderedTerms(spec).filter(t => termLabel(t) !== term);
  const f = formulaParts(Object.assign({}, spec, { terms }), ds);
  return { R: f.R, py: f.py, m: f.m };
}

/**
 * The Diagnostics page's recipe.
 * @param {object} o `{ ds, spec, result, level, title, provenance, residuals, summary }` where
 *   `residuals` is residualSet's output and `summary` holds the page's
 *   Shapiro–Wilk W and p, the residuals' mean and sd, and the largest Cook's distance.
 */
export function diagnosticsRecipe(o) {
  const r = baseRecipe(Object.assign({ page: 'diagnostics' }, o));
  const fit = o.result.fit;
  r.uniforms = o.residuals.uniforms ? Array.from(o.residuals.uniforms) : null;
  r.auxKind = fit.family === 'normal' || fit.family === 'gamma' ? 'dispersion' : fit.family === 'negbin' ? 'theta' : fit.family === 'beta' ? 'phi' : 'one';
  const e = r.expect;
  if (fit.family !== 'ordinal') {
    e['quantile residual mean'] = o.summary.mean;
    e['quantile residual sd'] = o.summary.sd;
    if (o.summary.sw) { e['shapiro W'] = o.summary.sw.W; e['shapiro p'] = o.summary.sw.p; }
  }
  if (o.residuals.dispersion) {
    e['dispersion chi-square'] = o.residuals.dispersion.chisq;
    e['dispersion ratio'] = o.residuals.dispersion.ratio;
    e['dispersion p'] = o.residuals.dispersion.p;
  }
  if (o.residuals.cooks && !fit.mixed) e['cooks max'] = Math.max(...o.residuals.cooks);
  r.hasCooks = !!(o.residuals.cooks && !fit.mixed);
  return r;
}

/**
 * The Predict page's recipe.
 * @param {object} o `{ ds, spec, result, level, title, provenance, effect, means, calc }` where
 *   `effect` is `{ x, by, series: [{ label, rows, pred }] }` (pred from predictRows),
 *   `means` marginalMeans's output or null, and `calc` `{ row, pred }` or null.
 */
export function predictRecipe(o) {
  const r = baseRecipe(Object.assign({ page: 'predict' }, o));
  const e = r.expect;
  if (o.effect) {
    r.effect = { x: o.effect.x, by: o.effect.by, series: o.effect.series.map(s => ({ label: s.label, rows: s.rows })) };
    o.effect.series.forEach((s, k) => {
      const n = s.rows.length;
      const at = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
      r.effect.series[k].report = at;
      for (const i of at) {
        const key = 'effect ' + (s.label || 'curve') + ' point ' + (i + 1);
        e[key + ' eta'] = s.pred.eta[i];
        e[key + ' se'] = s.pred.se[i];
        e[key + ' fit'] = s.pred.fit[i];
      }
    });
  }
  if (o.means) {
    const m = o.means;
    r.means = { factor: m.factor, levels: m.levels.slice(), df: m.df, k: m.k, grid: { continuous: Object.assign({}, m.grid.continuous), factors: Object.assign({}, m.grid.factors) } };
    m.means.forEach(x => { e['emm ' + x.level] = x.eta; e['emm se ' + x.level] = x.se; e['emm lower ' + x.level] = x.lo; e['emm upper ' + x.level] = x.hi; e['emm response ' + x.level] = x.fit; });
    m.pairs.forEach(p => { const k = p.a + ' - ' + p.b; e['pair ' + k] = p.diff; e['pair se ' + k] = p.se; e['pair t ' + k] = p.t; e['pair p ' + k] = p.p; e['pair lower ' + k] = p.lo; e['pair upper ' + k] = p.hi; });
  }
  if (o.calc) {
    r.calc = { row: Object.assign({}, o.calc.row) };
    e['calc eta'] = o.calc.pred.eta[0]; e['calc se'] = o.calc.pred.se[0]; e['calc fit'] = o.calc.pred.fit[0]; e['calc lower'] = o.calc.pred.fitLo[0]; e['calc upper'] = o.calc.pred.fitHi[0];
  }
  return r;
}

/**
 * The Variance explained page's recipe.
 * @param {object} o `{ ds, spec, result, level, title, provenance, parts }` where
 *   `parts` is varianceParts's output.
 */
export function varianceRecipe(o) {
  const r = baseRecipe(Object.assign({ page: 'variance' }, o));
  const v = o.parts;
  r.variance = { hasRandom: v.random.length > 0, terms: v.terms.map(t => ({ term: t.term, reduced: reducedFormulas(o.spec, o.ds, t.term) })) };
  const e = r.expect;
  e['variance fixed'] = v.fixed;
  e['variance random'] = v.randomTotal;
  e['variance dispersion'] = v.dispersion;
  e['variance distribution'] = v.distribution;
  e['variance total'] = v.total;
  e['R2 marginal'] = v.r2m;
  e['R2 conditional'] = v.r2c;
  if (v.random.length) e['ICC'] = v.icc;
  for (const t of v.terms) { e['term ' + t.term + ' fixed variance'] = t.fixed; e['term ' + t.term + ' delta R2'] = t.delta; }
  r.capability = VARIANCE_CAPABILITY;
  return r;
}

// The decomposition is R's: performance and insight carry it, and neither
// Python nor MATLAB has a commonly used routine for it.
const noRoutine = lang => lang + ' has no commonly used routine for the Nakagawa decomposition. R\'s performance package is the conventional tool.';
/** The script languages of the Variance explained page: R and Tidy R only. */
export const VARIANCE_CAPABILITY = { R: { ok: true, why: null }, tidy: { ok: true, why: null }, py: { ok: false, why: noRoutine('Python') }, m: { ok: false, why: noRoutine('MATLAB') } };

/**
 * The Compare page's recipe: the candidates fitted to the current dataset,
 * by maximum likelihood, and the tests between nested pairs.
 * @param {object} o `{ ds, level, title, provenance, candidates: [{ name, spec, result }], pairs: [{ a, b, kind, df, stat, p }] }`
 */
export function compareRecipe(o) {
  const specs = o.candidates.map(c => c.spec);
  const first = o.candidates[0];
  const r = baseRecipe({ page: 'compare', title: o.title, provenance: o.provenance, level: o.level, ds: o.ds, spec: first.spec, result: first.result });
  r.data = dataFor(o.ds, specs);
  r.candidates = o.candidates.map(c => {
    const f = formulaParts(c.spec, o.ds);
    const link = linkOf(c.spec.family, c.spec.link);
    return { name: c.name, formula: { R: f.R, py: f.py, m: f.m }, family: c.spec.family, link: link.id, group: c.spec.group || null, nested: c.spec.nested || null, slope: c.spec.slope || null, olre: !!c.spec.olre, mixed: !!(c.spec.group || c.spec.olre), extraCols: f.extraCols };
  });
  const e = r.expect;
  o.candidates.forEach(c => { e['loglik ' + c.name] = c.result.fit.logLik; e['k ' + c.name] = c.result.fit.df; e['AIC ' + c.name] = c.result.fit.aic; e['BIC ' + c.name] = c.result.fit.bic; });
  const minAic = Math.min(...o.candidates.map(c => c.result.fit.aic));
  const wsum = o.candidates.reduce((a, c) => a + Math.exp(-(c.result.fit.aic - minAic) / 2), 0);
  o.candidates.forEach(c => { e['weight ' + c.name] = Math.exp(-(c.result.fit.aic - minAic) / 2) / wsum; });
  r.pairs = o.pairs.map(p => ({ a: p.a, b: p.b, kind: p.kind, df: p.df }));
  o.pairs.forEach(p => { e['LRT ' + p.a + ' vs ' + p.b] = p.stat; e['LRT p ' + p.a + ' vs ' + p.b] = p.p; });
  return r;
}

/** The link's label and the family's, for a script's comments. */
export function describeModel(spec) {
  return FAMILIES[spec.family].label + ' family, ' + LINKS[spec.link].label + ' link';
}
