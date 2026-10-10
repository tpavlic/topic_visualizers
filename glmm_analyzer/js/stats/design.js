// The design matrix: a model specification and a dataset become the columns
// a fitter works on, built as R's model.matrix builds them so that a
// coefficient here carries the name the exported scripts print. The
// intercept comes first; a continuous predictor is one column; a
// categorical predictor gives treatment contrasts against its first sorted
// level; an ordinal predictor gives orthogonal polynomial contrasts (R's
// contr.poly); a polynomial term is a raw power; an interaction is the
// products of its terms' columns, the first term's columns varying fastest.
// Pure functions, no DOM.

import { column, usedRows } from '../data/model.js';
import { independentColumns, selectColumns } from './linalg.js';

/**
 * R's contr.poly for k levels: a k by (k − 1) matrix of orthonormal
 * polynomial contrasts on the scores 1..k, found by Gram–Schmidt on the
 * centered powers in order, which fixes each column's sign as R's QR does.
 * @param {number} k
 * @returns {Float64Array[]} rows are levels, columns are .L, .Q, .C, ^4, ...
 */
export function contrPoly(k) {
  const scores = Array.from({ length: k }, (_, i) => i + 1);
  const mean = (k + 1) / 2;
  const cols = [];
  for (let d = 1; d < k; d++) {
    const v = Float64Array.from(scores, s => (s - mean) ** d);
    for (let pass = 0; pass < 2; pass++) {
      // The constant column is the first direction removed.
      let m = 0;
      for (let i = 0; i < k; i++) m += v[i];
      m /= k;
      for (let i = 0; i < k; i++) v[i] -= m;
      for (const q of cols) {
        let dot = 0;
        for (let i = 0; i < k; i++) dot += q[i] * v[i];
        for (let i = 0; i < k; i++) v[i] -= dot * q[i];
      }
    }
    let norm = 0;
    for (let i = 0; i < k; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < k; i++) v[i] /= norm;
    cols.push(v);
  }
  const out = [];
  for (let i = 0; i < k; i++) out.push(Float64Array.from(cols, c => c[i]));
  return out;
}

/** The suffixes R gives the polynomial contrast columns. */
export function polyNames(k) {
  const names = ['.L', '.Q', '.C'];
  for (let d = 4; d < k; d++) names.push('^' + d);
  return names.slice(0, k - 1);
}

/**
 * A term as R writes it in a formula: a name, `I(x^2)`, or `a:b`.
 * @param {string|{name: string, degree: number}|{of: string[]}} t
 */
export function termLabel(t) {
  if (typeof t === 'string') return t;
  if (t.degree) return 'I(' + t.name + '^' + t.degree + ')';
  return t.of.join(':');
}

/** The predictor names a term uses. */
export function termVars(t) {
  if (typeof t === 'string') return [t];
  if (t.degree) return [t.name];
  return t.of.slice();
}

/** A term's order: 1 for a main effect or a power, the number of factors for an interaction. */
export function termOrder(t) {
  return typeof t === 'object' && t.of ? t.of.length : 1;
}

/**
 * The terms of a spec in R's order: by order first (main effects and then
 * two-way interactions), and within an order as listed. Duplicates are
 * dropped.
 * @param {object} spec
 */
export function orderedTerms(spec) {
  const seen = new Set();
  const out = [];
  for (const t of spec.terms || []) {
    const l = termLabel(t);
    if (seen.has(l)) continue;
    seen.add(l);
    out.push(t);
  }
  return out.map((t, i) => [t, i]).sort((a, b) => termOrder(a[0]) - termOrder(b[0]) || a[1] - b[1]).map(x => x[0]);
}

/**
 * Whether the main effects every interaction needs are present: `a:b`
 * needs `a` and `b`. Returns the missing labels.
 * @param {object} spec
 */
export function missingMainEffects(spec) {
  const labels = new Set((spec.terms || []).map(termLabel));
  const missing = [];
  for (const t of spec.terms || []) {
    if (typeof t === 'object' && t.of) for (const v of t.of) if (!labels.has(v) && !missing.includes(v)) missing.push(v);
  }
  return missing;
}

/**
 * The columns one variable contributes, for the rows kept: `{ names, cols }`
 * where each col is a Float64Array over the kept rows.
 * @param {import('../data/model.js').Dataset} ds
 * @param {string} name
 * @param {number[]} keep row indices
 * @param {number} [degree] a raw power for a polynomial term
 */
function variableColumns(ds, name, rows, degree = 1) {
  const c = column(ds, name);
  if (!c) throw new Error('The column ' + name + ' is not in the dataset.');
  const col = c.col, j = c.index;
  if (col.type === 'continuous') {
    const v = Float64Array.from(rows, r => (degree === 1 ? r[j] : r[j] ** degree));
    return { names: [degree === 1 ? name : 'I(' + name + '^' + degree + ')'], cols: [v] };
  }
  if (degree !== 1) throw new Error('A power applies to a continuous predictor; ' + name + ' is ' + col.type + '.');
  const levels = col.levels || [];
  const index = new Map(levels.map((l, k) => [l, k]));
  const at = r => { const k = index.get(r[j]); if (k === undefined) throw new Error('"' + r[j] + '" is not a level of ' + name + '.'); return k; };
  if (col.type === 'categorical') {
    const names = levels.slice(1).map(l => name + l);
    const cols = levels.slice(1).map((l, k) => Float64Array.from(rows, r => (at(r) === k + 1 ? 1 : 0)));
    return { names, cols };
  }
  const k = levels.length;
  const P = contrPoly(k);
  const names = polyNames(k).map(s => name + s);
  const cols = names.map((_, d) => Float64Array.from(rows, r => P[at(r)][d]));
  return { names, cols };
}

// Every column of the fixed part for the given rows (arrays of cells in
// the dataset's column order), before any aliased column is dropped.
function allColumns(ds, terms, rows) {
  const names = ['(Intercept)'];
  const cols = [Float64Array.from(rows, () => 1)];
  const assign = [-1];
  terms.forEach((t, ti) => {
    let part;
    if (typeof t === 'string') part = variableColumns(ds, t, rows);
    else if (t.degree) part = variableColumns(ds, t.name, rows, t.degree);
    else {
      // The products of the factors' columns, the first factor's varying fastest.
      part = variableColumns(ds, t.of[0], rows);
      for (const v of t.of.slice(1)) {
        const next = variableColumns(ds, v, rows);
        const names2 = [], cols2 = [];
        for (let b = 0; b < next.cols.length; b++) {
          for (let a = 0; a < part.cols.length; a++) {
            names2.push(part.names[a] + ':' + next.names[b]);
            const ca = part.cols[a], cb = next.cols[b];
            cols2.push(Float64Array.from(ca, (x, i) => x * cb[i]));
          }
        }
        part = { names: names2, cols: cols2 };
      }
    }
    for (let k = 0; k < part.cols.length; k++) { names.push(part.names[k]); cols.push(part.cols[k]); assign.push(ti); }
  });
  return { names, cols, assign };
}

/**
 * Design rows for new predictor values, with the columns of a fitted design
 * (aliased columns left out). Each new row is an object naming a value for
 * every predictor the terms use: a number for a continuous predictor and a
 * level for a categorical or ordinal one.
 * @param {import('../data/model.js').Dataset} ds
 * @param {ReturnType<typeof modelMatrix>} design
 * @param {Object<string, number|string>[]} newRows
 * @returns {Float64Array[]}
 */
export function newDataMatrix(ds, design, newRows) {
  const rows = newRows.map(o => ds.columns.map(c => (o[c.name] === undefined ? null : o[c.name])));
  const all = allColumns(ds, design.terms, rows);
  const pick = design.names.map(n => all.names.indexOf(n));
  if (pick.some(k => k < 0)) throw new Error('The new rows do not give every column of the design.');
  return rows.map((_, i) => Float64Array.from(pick, k => all.cols[k][i]));
}

/**
 * Builds the design matrix of a spec on a dataset.
 * @param {import('../data/model.js').Dataset} ds
 * @param {{ response: string, terms: (string|{name: string, degree: number}|{of: string[]})[], group?: string|null, nested?: string|null, slope?: string|null }} spec
 * @returns {{ X: Float64Array[], names: string[], assign: number[], terms: object[], keep: number[], dropped: number,
 *   y: Float64Array, yRaw: (number|string|null)[], aliased: string[], groups: { name: string, ids: number[], levels: string[] }|null,
 *   nested: { name: string, ids: number[], levels: string[] }|null, slopeCol: Float64Array|null }}
 *   `assign[j]` is the index into `terms` of column j (−1 for the intercept),
 *   `keep` the dataset rows used, `aliased` the column names dropped for
 *   rank deficiency, `groups` the group column's level index per kept row,
 *   `nested` the same for the nested group, and `slopeCol` the random-slope
 *   predictor's column (a continuous predictor's values).
 */
export function modelMatrix(ds, spec) {
  const terms = orderedTerms(spec);
  const vars = new Set([spec.response]);
  for (const t of terms) for (const v of termVars(t)) vars.add(v);
  if (spec.group) vars.add(spec.group);
  if (spec.nested) vars.add(spec.nested);
  if (spec.slope) vars.add(spec.slope);
  const { keep, dropped } = usedRows(ds, Array.from(vars));
  const { names, cols, assign } = allColumns(ds, terms, keep.map(i => ds.rows[i]));
  const n = keep.length;
  let X = Array.from({ length: n }, (_, i) => Float64Array.from(cols, c => c[i]));
  const rank = independentColumns(X);
  const aliased = rank.drop.map(j => names[j]);
  let keptNames = names, keptAssign = assign;
  if (rank.drop.length) {
    X = selectColumns(X, rank.keep);
    keptNames = rank.keep.map(j => names[j]);
    keptAssign = rank.keep.map(j => assign[j]);
  }
  const rc = column(ds, spec.response);
  const yRaw = keep.map(i => ds.rows[i][rc.index]);
  const y = Float64Array.from(yRaw, v => (typeof v === 'number' ? v : NaN));
  const groupOf = name => {
    if (!name) return null;
    const c = column(ds, name);
    const levels = c.col.levels || [];
    const index = new Map(levels.map((l, k) => [l, k]));
    return { name, ids: keep.map(i => index.get(String(ds.rows[i][c.index]))), levels };
  };
  let slopeCol = null;
  if (spec.slope) {
    const sc = column(ds, spec.slope);
    if (!sc || sc.col.type !== 'continuous') throw new Error('A random slope applies to a continuous predictor; ' + spec.slope + ' is not one.');
    slopeCol = Float64Array.from(keep, i => ds.rows[i][sc.index]);
  }
  return { X, names: keptNames, assign: keptAssign, terms, keep, dropped, y, yRaw, aliased, groups: groupOf(spec.group), nested: groupOf(spec.nested), slopeCol };
}

/**
 * The spec's fixed part as an R formula's right-hand side: `x + f + x:f`,
 * or `1` with no terms.
 * @param {object} spec
 */
export function formulaRhs(spec) {
  const t = orderedTerms(spec).map(termLabel);
  return t.length ? t.join(' + ') : '1';
}

/**
 * The spec as a Wilkinson formula: `y ~ x + f + (1 | g)`. The random part
 * is written as lme4 writes it.
 * @param {object} spec
 */
export function formulaOf(spec) {
  let f = (spec.response || 'y') + ' ~ ' + formulaRhs(spec);
  if (spec.group) {
    const inner = spec.slope ? '1 + ' + spec.slope : '1';
    f += ' + (' + inner + ' | ' + spec.group + ')';
    if (spec.nested) f += ' + (1 | ' + spec.group + ':' + spec.nested + ')';
  }
  if (spec.olre) f += ' + (1 | obs)';
  return f;
}
