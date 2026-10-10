// The dataset model: a table of observations, one row each, whose columns
// carry a role (the response, a predictor, a grouping factor, or ignored)
// and a type (continuous, categorical, or ordinal). The response's support,
// read from its values, says which families can describe it. Pure
// functions, no DOM.

/**
 * @typedef {{ name: string, role: 'response'|'predictor'|'group'|'ignored',
 *   type: 'continuous'|'categorical'|'ordinal', levels: string[]|null }} Column
 *   `levels` holds a categorical or ordinal column's distinct values, sorted
 *   as R sorts character levels, and null for a continuous column.
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
 * (the given one, or a new one from `newId`). Each column's `levels` is
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
    levels: null
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
 * The column with this name, or null.
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

/** The response column, or null. */
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
