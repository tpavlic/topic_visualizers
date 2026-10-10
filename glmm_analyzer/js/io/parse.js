// Reading a table from delimited text: splitting lines into cells, finding
// the header, guessing each column's type, and building a dataset from a
// mapping that assigns every column a role and a type. Every row that is not
// used is reported with its line number and a reason. Pure functions, no
// DOM.

import { makeDataset } from '../data/model.js';

/**
 * @typedef {{ name: string, response: string|null,
 *   columns: Object<string, { role: string, type: string, levels?: string[] }> }} Mapping
 */
/** @typedef {{ line: number, text: string, reason: string }} Issue */

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

// A cell's number, or null when the cell is not a plain finite decimal. NaN,
// Inf, and -Inf are therefore non-numeric.
function cellNumber(s) {
  return NUMBER_RE.test(s) ? Number(s) : null;
}

// The cells that mean a missing value, after trimming and lower-casing.
const MISSING = new Set(['', 'na', 'nan', 'n/a', 'null', 'none', '.', '?']);

/** Whether a cell is read as a missing value. */
export function isMissing(cell) {
  return MISSING.has(String(cell).trim().toLowerCase());
}

/**
 * The delimiter a line uses: a comma, a tab, or a semicolon when the line
 * has one outside quotes, in that order of preference, and otherwise a space.
 * @param {string} line
 * @returns {','|'\t'|';'|' '}
 */
export function delimiterOf(line) {
  let quoted = false;
  const seen = { ',': false, '\t': false, ';': false };
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in seen) seen[ch] = true;
  }
  if (seen[',']) return ',';
  if (seen['\t']) return '\t';
  if (seen[';']) return ';';
  return ' ';
}

/**
 * Split one line into cells on the delimiter given, or on the one
 * `delimiterOf` finds. Cells are trimmed and an empty cell is kept, as a
 * table's missing value, except under the space delimiter, where runs of
 * spaces are one delimiter and an empty cell cannot be expressed. A
 * double-quoted cell is kept whole, delimiters included, with its quotes
 * removed and a doubled quote read as one quote.
 * @param {string} line
 * @param {','|'\t'|';'|' '} [delim]
 * @returns {string[]}
 */
export function splitCells(line, delim) {
  const d = delim || delimiterOf(line);
  const cells = [];
  const t = d === ' ' ? line.trim() : line;
  let i = 0;
  const skipSpaces = () => { while (i < t.length && (t[i] === ' ' || t[i] === '\t')) i++; };
  while (i <= t.length) {
    if (d === ' ') skipSpaces();
    if (i >= t.length) { if (d !== ' ') cells.push(''); break; }
    let cell;
    if (t[i] === '"' || (d !== ' ' && /^\s*"/.test(t.slice(i)))) {
      while (t[i] !== '"') i++;
      let s = '';
      i++;
      while (i < t.length) {
        if (t[i] === '"') { if (t[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += t[i++];
      }
      cell = s;
      // Anything after the closing quote and before the delimiter is dropped.
      if (d === ' ') { while (i < t.length && t[i] !== ' ' && t[i] !== '\t') i++; }
      else { while (i < t.length && t[i] !== d) i++; }
    } else {
      let k = i;
      if (d === ' ') { while (k < t.length && t[k] !== ' ' && t[k] !== '\t') k++; }
      else { while (k < t.length && t[k] !== d) k++; }
      cell = t.slice(i, k).trim();
      i = k;
    }
    cells.push(cell);
    if (i >= t.length) break;
    // Past the delimiter: a trailing one under a comma, tab, or semicolon
    // means one more, empty, cell.
    i++;
    if (i === t.length && d !== ' ') { cells.push(''); break; }
  }
  return cells;
}

/**
 * Split text into rows of cells. Blank lines are counted in `blanks` and
 * omitted; lines whose first non-space character is `#` are comments,
 * counted in `comments` and omitted. One delimiter is chosen for the whole
 * text from its first thirty data lines. Each row carries its cells and
 * `vals`, each cell's number or null.
 * @param {string} text
 * @returns {{ rows: { line: number, text: string, cells: string[], vals: (number|null)[] }[],
 *   blanks: number, comments: number, delimiter: string }}
 */
export function parseRows(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const data = lines.map(s => s.trim()).filter(s => s && s[0] !== '#').slice(0, 30);
  const counts = { ',': 0, '\t': 0, ';': 0, ' ': 0 };
  for (const l of data) counts[delimiterOf(l)]++;
  let delimiter = ' ';
  for (const d of [',', '\t', ';']) if (counts[d] > 0 && counts[d] >= counts[delimiter]) delimiter = d;
  const rows = [];
  let blanks = 0, comments = 0;
  lines.forEach((raw, k) => {
    const trimmed = raw.trim();
    if (trimmed === '') { blanks++; return; }
    if (trimmed[0] === '#') { comments++; return; }
    const cells = splitCells(raw, delimiter);
    if (!cells.length || cells.every(c => c === '')) { blanks++; return; }
    rows.push({ line: k + 1, text: raw, cells, vals: cells.map(cellNumber) });
  });
  return { rows, blanks, comments, delimiter };
}

const DELIM_NAME = { ',': 'comma', '\t': 'tab', ';': 'semicolon', ' ': 'spaces' };
const GROUP_NAMES = ['group', 'subject', 'colony', 'site', 'replication', 'rep', 'seed', 'block', 'id', 'plot', 'cluster', 'nest', 'hive'];
const RESP_NAMES = ['response', 'y', 'outcome'];

/**
 * Read a text's layout: the header (required, as the first row, whose cells
 * name the columns; a first row of nothing but numbers is refused), the
 * column count, each column's guessed type (continuous when every
 * non-missing cell is a number, categorical otherwise), and which rows are
 * usable (the right width). Rows wider or narrower than the header are
 * issues. The suggested mapping names the column headed like a response, or
 * else the last continuous column not headed like a group, as the response,
 * a column headed like a group (`group`, `subject`, `colony`, `site`,
 * `replication`, `seed`, `block`, `id`, and so on) as a group, and every
 * other column as a predictor. The Output Analyzer's export, headed
 * `dataset, replication, value` (with or without `time`), is read with the
 * dataset as a categorical predictor, the replication as the group, and the
 * value as the response.
 * @param {string} text
 * @param {{ name?: string }} [opts]
 * @returns {{ header: string[], nCols: number, types: string[], rows: { line: number, text: string,
 *   cells: string[], vals: (number|null)[], ok: boolean }[], suggested: Mapping, issues: Issue[],
 *   blanks: number, comments: number, delimiter: string, delimiterName: string, noHeader: boolean,
 *   analyzerExport: boolean }}
 */
export function sniff(text, opts = {}) {
  const parsed = parseRows(text);
  const all = parsed.rows;
  const name = opts.name != null ? opts.name : 'data';
  const base = { header: [], nCols: 0, types: [], rows: [], suggested: { name, response: null, columns: {} }, issues: [],
    blanks: parsed.blanks, comments: parsed.comments, delimiter: parsed.delimiter, delimiterName: DELIM_NAME[parsed.delimiter],
    noHeader: false, analyzerExport: false };
  if (!all.length) return base;
  const first = all[0];
  if (first.vals.every(x => x !== null)) {
    return Object.assign(base, { noHeader: true, rows: all.map(r => Object.assign({ ok: false }, r)),
      issues: [{ line: first.line, text: first.text, reason: 'the first row holds only numbers; a table needs a header row naming its columns' }] });
  }
  const header = first.cells.map((s, j) => (s.trim() === '' ? 'column ' + (j + 1) : s.trim()));
  // Duplicate names are told apart by a suffix, as R's make.unique does.
  const seen = new Map();
  header.forEach((h, j) => {
    const k = seen.get(h) || 0;
    seen.set(h, k + 1);
    if (k) header[j] = h + '.' + k;
  });
  const nCols = header.length;
  const data = all.slice(1);
  const issues = [];
  const rows = data.map(r => {
    const reason = r.cells.length !== nCols ? 'expected ' + nCols + (nCols === 1 ? ' cell' : ' cells') + ', found ' + r.cells.length : null;
    if (reason) issues.push({ line: r.line, text: r.text, reason });
    return { line: r.line, text: r.text, cells: r.cells, vals: r.vals, ok: reason === null };
  });
  const shaped = rows.filter(r => r.ok);
  const types = [];
  for (let j = 0; j < nCols; j++) {
    let numeric = true, any = false;
    for (const r of shaped) {
      if (isMissing(r.cells[j])) continue;
      any = true;
      if (r.vals[j] === null) { numeric = false; break; }
    }
    types.push(any && numeric ? 'continuous' : 'categorical');
  }
  const lower = header.map(h => h.toLowerCase());
  const analyzerExport = lower[0] === 'dataset' && lower[1] === 'replication' && lower[nCols - 1] === 'value' && (nCols === 3 || (nCols === 4 && lower[2] === 'time'));
  let response = null;
  const rj = lower.findIndex(h => RESP_NAMES.includes(h));
  if (analyzerExport) response = header[nCols - 1];
  else if (rj >= 0) response = header[rj];
  else {
    for (let j = nCols - 1; j >= 0; j--) if (types[j] === 'continuous' && !GROUP_NAMES.includes(lower[j])) { response = header[j]; break; }
    if (response === null) response = header[nCols - 1];
  }
  const columns = {};
  header.forEach((h, j) => {
    let role = 'predictor', type = types[j];
    if (h === response) role = 'response';
    else if (analyzerExport) { role = lower[j] === 'replication' ? 'group' : lower[j] === 'time' ? 'ignored' : 'predictor'; if (role !== 'ignored') type = 'categorical'; }
    else if (GROUP_NAMES.includes(lower[j])) { role = 'group'; type = 'categorical'; }
    columns[h] = { role, type };
  });
  return Object.assign(base, { header, nCols, types, rows, suggested: { name, response, columns }, issues, analyzerExport });
}

/**
 * Build a dataset from sniffed rows and a mapping. Every column keeps its
 * place; a continuous column's non-numeric cells are missing values and are
 * reported as issues; a categorical or ordinal column's cells are its level
 * names, and an ordinal column's `levels` in the mapping give their order.
 * The response must be named and must be a column.
 * @param {ReturnType<typeof sniff>} sniffed
 * @param {Mapping} mapping
 * @returns {{ dataset: import('../data/model.js').Dataset, issues: Issue[] }}
 */
export function buildTable(sniffed, mapping) {
  if (sniffed.noHeader || !sniffed.header.length) throw new Error('The table needs a header row naming its columns.');
  if (!mapping.response || !sniffed.header.includes(mapping.response)) throw new Error('Choose the response column.');
  const columns = sniffed.header.map((h, j) => {
    const m = (mapping.columns && mapping.columns[h]) || {};
    const role = h === mapping.response ? 'response' : (m.role === 'response' || !m.role ? 'ignored' : m.role);
    return { name: h, role, type: m.type || sniffed.types[j] || 'continuous', levels: Array.isArray(m.levels) ? m.levels : null };
  });
  const issues = [];
  const rows = [];
  for (const r of sniffed.rows) {
    if (!r.ok) continue;
    const row = [];
    const bad = [];
    for (let j = 0; j < columns.length; j++) {
      const cell = r.cells[j];
      if (isMissing(cell)) { row.push(null); continue; }
      if (columns[j].type === 'continuous') {
        if (r.vals[j] === null) { bad.push(j); row.push(null); }
        else row.push(r.vals[j]);
      } else row.push(cell.trim());
    }
    const named = bad.filter(j => columns[j].role !== 'ignored');
    if (named.length) {
      issues.push({ line: r.line, text: r.text, reason: 'non-numeric ' + (named.length === 1 ? 'cell' : 'cells') + ' in ' +
        named.map(j => '"' + columns[j].name + '"').join(', ') + ' read as missing: ' + named.map(j => '"' + r.cells[j] + '"').join(', ') });
    }
    rows.push(row);
  }
  const name = mapping.name != null && String(mapping.name).trim() ? String(mapping.name).trim() : 'data';
  const dataset = makeDataset({
    name, columns, rows,
    source: { file: name, notes: [] },
    issues: sniffed.issues.concat(issues).sort((a, b) => a.line - b.line)
  });
  return { dataset, issues: dataset.issues };
}
