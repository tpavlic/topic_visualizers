// The dataset model: a table of observations, one row each, whose columns
// carry a role (the response, a predictor, a grouping factor, or ignored)
// and a type (continuous, categorical, or ordinal). The response's support,
// read from its values, says which families can describe it. Pure
// functions, no DOM.


import { mean, sd, ranks } from '../stats/descriptive.js';

/**
 * @typedef {{ name: string, role: 'response'|'predictor'|'group'|'ignored',
 *   type: 'continuous'|'categorical'|'ordinal', levels: string[]|null,
 *   derived?: { of: string, transform: string, replaced?: string|null }|null }} Column
 *   `levels` holds a categorical or ordinal column's distinct values, sorted
 *   as R sorts character levels, and null for a continuous column. `derived`
 *   names the continuous column and the transform a derived column was made
 *   from (see DERIVATIONS), with `replaced` naming the column it stepped back
 *   from the response when it was made the response, and is absent or null
 *   on a column read from the data.
 */
/**
 * @typedef {{
 *   id: string, name: string, columns: Column[], rows: (number|string|null)[][],
 *   source: { file: string, notes: string[] },
 *   issues: { line: number, text: string, reason: string }[]
 * }} Dataset
 *   A row holds one cell per column: a number for a continuous column, the
 *   level's text for a categorical or ordinal one, and null for a missing
 *   value in either.
 */

/** How each column role and type is named on the page and in a data file's # lines. */
export const ROLE_LABEL = { response: 'response', predictor: 'predictor', group: 'group', ignored: 'ignored' };
export const TYPE_LABEL = { continuous: 'continuous', categorical: 'categorical', ordinal: 'ordinal' };
export const ROLES = ['response', 'predictor', 'group', 'ignored'];
export const TYPES = ['continuous', 'categorical', 'ordinal'];

let idCounter = 0;

/**
 * A fresh dataset id: a session counter plus a random suffix, so that ids
 * restored from storage in a later session do not collide with new ones.
 * @returns {string}
 */
export function newId() {
  idCounter += 1;
  return 'ds' + idCounter + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Sorts level names as R sorts character levels in the C locale: by code
 * point, so that "1", "10", "2" is the order of the numeric-looking names
 * too. The page keeps this order so that the reference level and the
 * contrast columns match the exported scripts.
 * @param {Iterable<string>} names
 * @returns {string[]}
 */
export function sortLevels(names) {
  return Array.from(new Set(Array.from(names))).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Build a dataset from partial fields, filling defaults and assigning an id
 * (the given one or a new one from `newId`). Each column's `levels` is
 * computed from the rows unless given; a continuous column's cells are
 * numbers or null, and a categorical or ordinal column's are strings or null.
 * @param {Partial<Dataset>} fields
 * @returns {Dataset}
 */
export function makeDataset(fields = {}) {
  const src = fields.source || {};
  const given = fields.columns || [];
  const columns = given.map(c => ({
    name: String(c.name),
    role: ROLES.includes(c.role) ? c.role : 'ignored',
    type: TYPES.includes(c.type) ? c.type : 'continuous',
    levels: null,
    derived: c.derived && c.derived.of != null && DERIVATIONS[c.derived.transform] ? { of: String(c.derived.of), transform: String(c.derived.transform), replaced: c.derived.replaced != null ? String(c.derived.replaced) : null } : null
  }));
  const rows = (fields.rows || []).map(r => columns.map((c, j) => {
    const v = r[j];
    if (v == null || v === '') return null;
    if (c.type === 'continuous') { const x = typeof v === 'number' ? v : Number(v); return Number.isFinite(x) ? x : null; }
    return String(v);
  }));
  columns.forEach((c, j) => {
    if (c.type === 'continuous') return;
    const have = sortLevels(rows.map(r => r[j]).filter(v => v != null));
    const want = Array.isArray(given[j].levels) ? given[j].levels.map(String).filter(l => have.includes(l)) : [];
    // An ordinal column keeps the order it was given in; a level the rows
    // hold but the list does not follows in sorted order.
    c.levels = want.length ? want.concat(have.filter(l => !want.includes(l))) : have;
  });
  return {
    id: fields.id != null ? fields.id : newId(),
    name: fields.name != null ? fields.name : 'data',
    columns,
    rows,
    source: { file: src.file != null ? src.file : '', notes: (src.notes || []).slice() },
    issues: (fields.issues || []).slice()
  };
}

/**
 * The column with this name or null.
 * @param {Dataset} ds
 * @param {string} name
 * @returns {{ col: Column, index: number }|null}
 */
export function column(ds, name) {
  const index = ds.columns.findIndex(c => c.name === name);
  return index < 0 ? null : { col: ds.columns[index], index };
}

/**
 * One column's values down the rows.
 * @param {Dataset} ds
 * @param {string} name
 * @returns {(number|string|null)[]}
 */
export function valuesOf(ds, name) {
  const c = column(ds, name);
  if (!c) return [];
  return ds.rows.map(r => r[c.index]);
}

/** The response column or null. */
export function responseColumn(ds) {
  return ds.columns.find(c => c.role === 'response') || null;
}

/** The predictor columns, in table order. */
export function predictorColumns(ds) {
  return ds.columns.filter(c => c.role === 'predictor');
}

/** The group columns, in table order. */
export function groupColumns(ds) {
  return ds.columns.filter(c => c.role === 'group');
}

/**
 * The support of a response, read from its values: 'binary' for exactly two
 * distinct values, 'count' for non-negative integers (three or more distinct),
 * 'unit' for values in [0, 1] that are not all integers, 'positive' for
 * values above 0, 'real' otherwise, and 'ordinal' for a column typed ordinal
 * or categorical with three or more levels. Null cells are skipped.
 * @param {Column} col
 * @param {(number|string|null)[]} values
 * @returns {'binary'|'count'|'unit'|'positive'|'real'|'ordinal'|'empty'}
 */
export function support(col, values) {
  const v = values.filter(x => x != null);
  if (!v.length) return 'empty';
  if (col.type !== 'continuous') {
    const n = new Set(v).size;
    return n === 2 ? 'binary' : 'ordinal';
  }
  const nums = v.map(Number);
  const distinct = new Set(nums).size;
  if (distinct === 2) return 'binary';
  const allInt = nums.every(x => Number.isInteger(x));
  let min = Infinity, max = -Infinity;
  for (const x of nums) { if (x < min) min = x; if (x > max) max = x; }
  if (allInt && min >= 0) return 'count';
  if (min >= 0 && max <= 1) return 'unit';
  if (min > 0) return 'positive';
  return 'real';
}

/** What each support means, as the page says it. */
export const SUPPORT_LABEL = {
  binary: 'two values (binary)',
  count: 'non-negative whole numbers (counts)',
  unit: 'values between 0 and 1 (a proportion)',
  positive: 'positive values',
  real: 'any real value',
  ordinal: 'ordered levels',
  empty: 'no values'
};

/**
 * The rows a model can use: those with no missing value in any of the named
 * columns. Returns the indices of the kept rows and the count dropped.
 * @param {Dataset} ds
 * @param {string[]} names the columns the model uses
 * @returns {{ keep: number[], dropped: number }}
 */
export function usedRows(ds, names) {
  const idx = names.map(n => { const c = column(ds, n); return c ? c.index : -1; }).filter(i => i >= 0);
  const keep = [];
  ds.rows.forEach((r, i) => { if (idx.every(j => r[j] != null)) keep.push(i); });
  return { keep, dropped: ds.rows.length - keep.length };
}

/**
 * A short description of a dataset for the page: rows, columns, and which is
 * the response.
 * @param {Dataset} ds
 * @returns {{ nRows: number, nCols: number, response: string|null, predictors: string[], groups: string[] }}
 */
export function datasetSummary(ds) {
  const resp = responseColumn(ds);
  return {
    nRows: ds.rows.length,
    nCols: ds.columns.length,
    response: resp ? resp.name : null,
    predictors: predictorColumns(ds).map(c => c.name),
    groups: groupColumns(ds).map(c => c.name)
  };
}

/**
 * Whether two datasets hold the same table: the same column names and types
 * and the same cells, row for row. Names, ids, roles, and sources are not
 * compared, and so a file loaded twice is caught however its roles were set.
 * @param {Dataset} a
 * @param {Dataset} b
 */
export function sameData(a, b) {
  if (a.columns.length !== b.columns.length || a.rows.length !== b.rows.length) return false;
  for (let j = 0; j < a.columns.length; j++) {
    if (a.columns[j].name !== b.columns[j].name || a.columns[j].type !== b.columns[j].type) return false;
  }
  for (let i = 0; i < a.rows.length; i++) {
    const ra = a.rows[i], rb = b.rows[i];
    for (let j = 0; j < ra.length; j++) {
      const x = ra[j], y = rb[j];
      if (x === y || (typeof x === 'number' && typeof y === 'number' && Object.is(x, y))) continue;
      return false;
    }
  }
  return true;
}

/**
 * Whether a dataset can be modeled at all: a response column and at least
 * two rows with a response value.
 * @param {Dataset} ds
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function canModel(ds) {
  const resp = responseColumn(ds);
  if (!resp) return { ok: false, reason: 'The dataset has no response column.' };
  const n = valuesOf(ds, resp.name).filter(v => v != null).length;
  if (n < 2) return { ok: false, reason: 'The response has fewer than two values.' };
  return { ok: true, reason: null };
}

/**
 * The transforms a derived column applies to a continuous column: the label
 * the page shows, the suffix of the default name, how the derivation is
 * written out, and the domain the source values must satisfy.
 */
export const DERIVATIONS = {
  rank: { label: 'rank (ties averaged)', suffix: 'rank', text: n => 'rank(' + n + ')', domain: null },
  log: { label: 'natural log', suffix: 'log', text: n => 'log(' + n + ')', domain: v => v > 0, needs: 'positive values' },
  sqrt: { label: 'square root', suffix: 'sqrt', text: n => 'sqrt(' + n + ')', domain: v => v >= 0, needs: 'non-negative values' },
  center: { label: 'centered', suffix: 'centered', text: n => n + ' - mean(' + n + ')', domain: null },
  standardize: { label: 'standardized', suffix: 'std', text: n => '(' + n + ' - mean(' + n + ')) / sd(' + n + ')', domain: null }
};

/**
 * The derived columns of a dataset.
 * @param {Dataset} ds
 * @returns {Column[]}
 */
export function derivedColumns(ds) { return ds.columns.filter(c => c.derived); }

/**
 * How a derived column was made, as `name = rank(source)`.
 * @param {Column} col
 * @returns {string}
 */
export function derivationText(col) { return col.name + ' = ' + DERIVATIONS[col.derived.transform].text(col.derived.of); }

/**
 * The default name of a derived column: the source's name and the transform's suffix.
 * @param {string} of
 * @param {string} transform
 * @returns {string}
 */
export function derivedName(of, transform) { return of + '_' + DERIVATIONS[transform].suffix; }

/**
 * Adds a derived column to a dataset, in place: a continuous column's
 * ranks, natural log, square root, centered values, or standardized values,
 * stored as data like any other column, with the derivation kept on the
 * column. A missing value stays missing. A derived column made the
 * response steps the current response back to ignored and remembers it,
 * so that removing the derived column restores it. Nothing changes when
 * the request is refused.
 * @param {Dataset} ds
 * @param {{ of: string, transform: string, name: string, role?: 'predictor'|'response' }} req
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function deriveColumn(ds, req) {
  const d = DERIVATIONS[req.transform];
  if (!d) return { ok: false, reason: 'Choose a transform.' };
  const src = column(ds, req.of);
  if (!src) return { ok: false, reason: 'There is no column named ' + req.of + '.' };
  if (src.col.type !== 'continuous') return { ok: false, reason: req.of + ' is ' + src.col.type + '; a derived column is made from a continuous one.' };
  const name = String(req.name || '').trim();
  if (!name) return { ok: false, reason: 'Name the new column.' };
  if (column(ds, name)) return { ok: false, reason: 'There is already a column named ' + name + '.' };
  const role = req.role || 'predictor';
  if (role !== 'predictor' && role !== 'response') return { ok: false, reason: 'A derived column is a predictor or the response.' };
  const vals = ds.rows.map(r => r[src.index]);
  if (d.domain) {
    const bad = [];
    vals.forEach((v, i) => { if (v != null && !d.domain(v)) bad.push(i + 1); });
    if (bad.length) return { ok: false, reason: d.text(req.of) + ' needs ' + d.needs + ', and ' + (bad.length === 1 ? 'row ' + bad[0] + ' has a value that is not.' : bad.length + ' rows have a value that is not (rows ' + bad.slice(0, 8).join(', ') + (bad.length > 8 ? ', …' : '') + ').') };
  }
  const present = vals.filter(v => v != null);
  const out = new Array(vals.length).fill(null);
  if (req.transform === 'rank') {
    const idx = []; vals.forEach((v, i) => { if (v != null) idx.push(i); });
    const r = ranks(idx.map(i => vals[i]));
    idx.forEach((i, k) => { out[i] = r[k]; });
  } else if (req.transform === 'log' || req.transform === 'sqrt') {
    const f = req.transform === 'log' ? Math.log : Math.sqrt;
    vals.forEach((v, i) => { if (v != null) out[i] = f(v); });
  } else {
    if (present.length < 2) return { ok: false, reason: d.text(req.of) + ' needs at least two values.' };
    const m = mean(present), s = req.transform === 'standardize' ? sd(present) : 1;
    if (req.transform === 'standardize' && !(s > 0)) return { ok: false, reason: req.of + ' has no spread, and so it cannot be standardized.' };
    vals.forEach((v, i) => { if (v != null) out[i] = (v - m) / s; });
  }
  let replaced = null;
  if (role === 'response') for (const c of ds.columns) if (c.role === 'response') { c.role = 'ignored'; replaced = c.name; }
  ds.columns.push({ name, role, type: 'continuous', levels: null, derived: { of: req.of, transform: req.transform, replaced } });
  ds.rows.forEach((r, i) => { r.push(out[i]); });
  return { ok: true, reason: null };
}

/**
 * Removes a derived column from a dataset, in place, and gives the response
 * role back to the column the derived one took it from, when it was the
 * response and that column is still there. A column read from the data is
 * never removed.
 * @param {Dataset} ds
 * @param {string} name
 * @returns {boolean} whether a column was removed
 */
export function removeDerivedColumn(ds, name) {
  const c = column(ds, name);
  if (!c || !c.col.derived) return false;
  ds.columns.splice(c.index, 1);
  for (const r of ds.rows) r.splice(c.index, 1);
  if (c.col.role === 'response' && c.col.derived.replaced && !ds.columns.some(x => x.role === 'response')) {
    const back = column(ds, c.col.derived.replaced);
    if (back && back.col.role === 'ignored') back.col.role = 'response';
  }
  return true;
}
