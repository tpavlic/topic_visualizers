// Tests for js/data/model.js: dataset construction, level sorting, the
// response's support, the rows a model uses, and dataset equality. Every
// expected value is the tiny input written out here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDataset, sortLevels, support, usedRows, sameData, canModel, column, valuesOf, datasetSummary, responseColumn, deriveColumn, removeDerivedColumn, derivationText, derivedName, derivedColumns, DERIVATIONS, defaultTerms, termColumns, outcomeColumns, uniqueName } from '../js/data/model.js';

const cols = [
  { name: 'y', role: 'response', type: 'continuous' },
  { name: 'g', role: 'predictor', type: 'categorical' },
  { name: 'k', role: 'group', type: 'categorical' }
];

test('sortLevels sorts as R sorts character levels', () => {
  assert.deepEqual(sortLevels(['2', '10', '1', '10']), ['1', '10', '2']);
  assert.deepEqual(sortLevels(['b', 'B', 'a']), ['B', 'a', 'b']);
});

test('makeDataset converts cells by type and computes levels', () => {
  const ds = makeDataset({ name: 'd', columns: cols, rows: [['1.5', 'b', 2], ['', 'a', 10], [3, null, 1]] });
  assert.deepEqual(ds.rows, [[1.5, 'b', '2'], [null, 'a', '10'], [3, null, '1']]);
  assert.deepEqual(ds.columns[1].levels, ['a', 'b']);
  assert.deepEqual(ds.columns[2].levels, ['1', '10', '2']);
  assert.equal(ds.columns[0].levels, null);
  assert.ok(/^ds\d+-/.test(ds.id));
  assert.equal(makeDataset({ id: 'x', columns: cols, rows: [] }).id, 'x');
});

test('makeDataset keeps a given level order for an ordinal column and appends the rest', () => {
  const ds = makeDataset({ columns: [{ name: 's', role: 'predictor', type: 'ordinal', levels: ['low', 'high'] }], rows: [['high'], ['mid'], ['low']] });
  assert.deepEqual(ds.columns[0].levels, ['low', 'high', 'mid']);
});

test('support reads the response', () => {
  const cont = { type: 'continuous' };
  assert.equal(support(cont, [0, 1, 1, 0]), 'binary');
  assert.equal(support(cont, [0, 1, 2, 5]), 'count');
  assert.equal(support(cont, [0.2, 0.5, 1]), 'unit');
  assert.equal(support(cont, [0.5, 2, 3.5]), 'positive');
  assert.equal(support(cont, [-1, 2, 3]), 'real');
  assert.equal(support(cont, [null, null]), 'empty');
  assert.equal(support(cont, [2, 3, 7]), 'count', 'whole numbers above zero are still counts');
  assert.equal(support({ type: 'categorical' }, ['yes', 'no', 'yes']), 'binary');
  assert.equal(support({ type: 'ordinal' }, ['a', 'b', 'c']), 'ordinal');
});

test('usedRows drops rows with a missing value in a used column', () => {
  const ds = makeDataset({ columns: cols, rows: [[1, 'a', 1], [null, 'a', 1], [2, null, 2], [3, 'b', null]] });
  assert.deepEqual(usedRows(ds, ['y', 'g']), { keep: [0, 3], dropped: 2 });
  assert.deepEqual(usedRows(ds, ['y']), { keep: [0, 2, 3], dropped: 1 });
  assert.deepEqual(usedRows(ds, ['y', 'g', 'k']).keep, [0]);
});

test('sameData compares the table, not the names or roles', () => {
  const a = makeDataset({ name: 'a', columns: cols, rows: [[1, 'a', 1]] });
  const b = makeDataset({ name: 'b', columns: cols.map(c => Object.assign({}, c, { role: 'ignored' })), rows: [[1, 'a', 1]] });
  const c = makeDataset({ columns: cols, rows: [[1, 'a', 2]] });
  assert.ok(sameData(a, b));
  assert.ok(!sameData(a, c));
});

test('column, valuesOf, datasetSummary, and canModel', () => {
  const ds = makeDataset({ columns: cols, rows: [[1, 'a', 1], [2, 'b', 2]] });
  assert.equal(column(ds, 'g').index, 1);
  assert.equal(column(ds, 'nope'), null);
  assert.deepEqual(valuesOf(ds, 'y'), [1, 2]);
  assert.deepEqual(datasetSummary(ds), { nRows: 2, nCols: 3, response: 'y', predictors: ['g'], groups: ['k'] });
  assert.equal(responseColumn(ds).name, 'y');
  assert.equal(canModel(ds).ok, true);
  assert.equal(canModel(makeDataset({ columns: cols, rows: [[1, 'a', 1]] })).ok, false);
  assert.equal(canModel(makeDataset({ columns: cols.slice(1), rows: [] })).ok, false);
});

const dcols = [
  { name: 'y', role: 'response', type: 'continuous' },
  { name: 'x', role: 'predictor', type: 'continuous' },
  { name: 'g', role: 'predictor', type: 'categorical' }
];
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, msg + ': ' + a + ' vs ' + b);

test('deriveColumn adds a transformed copy of a continuous column as data', () => {
  const ds = makeDataset({ name: 'd', columns: dcols, rows: [[1, 4, 'a'], [2, 1, 'b'], [null, 1, 'a'], [4, 9, 'b']] });
  assert.deepEqual(deriveColumn(ds, { of: 'x', transform: 'rank', name: derivedName('x', 'rank') }), { ok: true, reason: null });
  assert.equal(ds.columns.length, 4);
  assert.deepEqual(ds.columns[3], { name: 'x_rank', role: 'predictor', type: 'continuous', levels: null, derived: { of: 'x', transform: 'rank', replaced: null } });
  assert.deepEqual(ds.rows.map(r => r[3]), [3, 1.5, 1.5, 4]);
  assert.equal(derivationText(ds.columns[3]), 'x_rank = rank(x)');
  assert.deepEqual(derivedColumns(ds).map(c => c.name), ['x_rank']);
  // A missing value stays missing, and the centered and standardized versions use the sample sd.
  assert.ok(deriveColumn(ds, { of: 'y', transform: 'center', name: 'y_centered' }).ok);
  assert.deepEqual(ds.rows.map(r => r[4]), [1 - 7 / 3, 2 - 7 / 3, null, 4 - 7 / 3]);
  assert.ok(deriveColumn(ds, { of: 'x', transform: 'standardize', name: 'x_std' }).ok);
  const sdx = Math.sqrt(42.75 / 3);
  ds.rows.forEach((r, i) => close(r[5], [0.25, -2.75, -2.75, 5.25][i] / sdx, 'standardized row ' + i));
  assert.ok(deriveColumn(ds, { of: 'x', transform: 'sqrt', name: 'x_sqrt' }).ok);
  assert.deepEqual(ds.rows.map(r => r[6]), [2, 1, 1, 3]);
  assert.equal(derivationText(ds.columns[5]), 'x_std = (x - mean(x)) / sd(x)');
  // A derived column made the response steps the old response back to an outcome.
  assert.ok(deriveColumn(ds, { of: 'y', transform: 'log', name: 'y_log', role: 'response' }).ok);
  assert.deepEqual(ds.columns.map(c => c.name + ':' + c.role), ['y:outcome', 'x:predictor', 'g:predictor', 'x_rank:predictor', 'y_centered:predictor', 'x_std:predictor', 'x_sqrt:predictor', 'y_log:response']);
  assert.equal(responseColumn(ds).name, 'y_log');
  assert.equal(ds.columns[7].derived.replaced, 'y');
  assert.deepEqual(ds.rows.map(r => r[7]), [0, Math.log(2), null, Math.log(4)]);
  // Removing the derived response gives the role back to y.
  assert.equal(removeDerivedColumn(ds, 'y_log'), true);
  assert.equal(responseColumn(ds).name, 'y');
  assert.ok(deriveColumn(ds, { of: 'y', transform: 'log', name: 'y_log', role: 'response' }).ok);
  // Removal takes the column out of every row; an original column stays.
  assert.equal(removeDerivedColumn(ds, 'x'), false);
  assert.equal(removeDerivedColumn(ds, 'x_rank'), true);
  assert.equal(ds.columns.length, 7);
  assert.ok(ds.rows.every(r => r.length === 7));
  assert.equal(column(ds, 'x_rank'), null);
  assert.deepEqual(ds.rows[0], [1, 4, 'a', 1 - 7 / 3, 0.25 / sdx, 2, 0]);
});

test('deriveColumn refuses what it cannot make, and changes nothing then', () => {
  const ds = makeDataset({ name: 'd', columns: dcols, rows: [[1, 0, 'a'], [2, -1, 'b'], [3, 4, 'a'], [3, 4, 'b']] });
  const before = JSON.stringify(ds);
  const bad = [
    deriveColumn(ds, { of: 'g', transform: 'rank', name: 'g_rank' }),
    deriveColumn(ds, { of: 'x', transform: 'log', name: 'x_log' }),
    deriveColumn(ds, { of: 'x', transform: 'sqrt', name: 'x_sqrt' }),
    deriveColumn(ds, { of: 'x', transform: 'rank', name: 'y' }),
    deriveColumn(ds, { of: 'x', transform: 'rank', name: ' ' }),
    deriveColumn(ds, { of: 'x', transform: 'cube', name: 'x_cube' }),
    deriveColumn(ds, { of: 'nope', transform: 'rank', name: 'z' }),
    deriveColumn(ds, { of: 'x', transform: 'rank', name: 'x_rank', role: 'group' })
  ];
  assert.ok(bad.every(r => r.ok === false && typeof r.reason === 'string'));
  assert.match(bad[0].reason, /categorical/);
  assert.equal(bad[1].reason, 'log(x) needs positive values, and 2 rows have a value that is not (rows 1, 2).');
  assert.equal(bad[2].reason, 'sqrt(x) needs non-negative values, and row 2 has a value that is not.');
  assert.match(bad[3].reason, /already a column named y/);
  assert.equal(JSON.stringify(ds), before);
  // A constant column cannot be standardized, but it can be centered.
  const flat = makeDataset({ name: 'f', columns: dcols, rows: [[1, 2, 'a'], [2, 2, 'b']] });
  assert.match(deriveColumn(flat, { of: 'x', transform: 'standardize', name: 'x_std' }).reason, /no spread/);
  assert.ok(deriveColumn(flat, { of: 'x', transform: 'center', name: 'x_centered' }).ok);
  assert.deepEqual(flat.rows.map(r => r[3]), [0, 0]);
  assert.deepEqual(Object.keys(DERIVATIONS), ['rank', 'log', 'sqrt', 'center', 'centerAt', 'standardize']);
});

test('deriveColumn centers a column at a value the reader gives', () => {
  const ds = makeDataset({ name: 'd', columns: dcols, rows: [[1, 4, 'a'], [2, 1, 'b'], [null, null, 'a'], [4, 9, 'b']] });
  assert.equal(derivedName('x', 'centerAt'), 'x_c');
  assert.deepEqual(deriveColumn(ds, { of: 'x', transform: 'centerAt', at: 2.5, name: 'x_c' }), { ok: true, reason: null });
  assert.deepEqual(ds.columns[3].derived, { of: 'x', transform: 'centerAt', replaced: null, at: 2.5 });
  assert.deepEqual(ds.rows.map(r => r[3]), [1.5, -1.5, null, 6.5]);
  assert.equal(derivationText(ds.columns[3]), 'x_c = x - 2.5');
  // A negative value is written in parentheses, and a value of 0 is a value.
  assert.ok(deriveColumn(ds, { of: 'y', transform: 'centerAt', at: -3, name: 'y_c' }).ok);
  assert.equal(derivationText(ds.columns[4]), 'y_c = y - (-3)');
  assert.deepEqual(ds.rows.map(r => r[4]), [4, 5, null, 7]);
  assert.ok(deriveColumn(ds, { of: 'y', transform: 'centerAt', at: 0, name: 'y_c0' }).ok);
  // With no value, or one that is not a finite number, nothing is added.
  const before = JSON.stringify(ds);
  for (const at of [undefined, NaN, Infinity, '2']) {
    assert.match(deriveColumn(ds, { of: 'x', transform: 'centerAt', at, name: 'x_c2' }).reason, /^Give the value to center x at, as a number\.$/);
  }
  assert.equal(JSON.stringify(ds), before);
  // The value travels with the column through a saved session, and a record without one is dropped.
  const back = makeDataset(JSON.parse(JSON.stringify({ name: 'd', columns: ds.columns, rows: ds.rows })));
  assert.equal(back.columns[3].derived.at, 2.5);
  const lost = makeDataset({ name: 'd', columns: [{ name: 'x', role: 'predictor', type: 'continuous' }, { name: 'x_c', role: 'predictor', type: 'continuous', derived: { of: 'x', transform: 'centerAt' } }], rows: [[1, 0]] });
  assert.equal(lost.columns[1].derived, null);
});

test('makeDataset keeps a column\'s derivation, as the saved session needs', () => {
  const ds = makeDataset({ name: 'd', columns: [{ name: 'y', role: 'response', type: 'continuous' }, { name: 'y_log', role: 'predictor', type: 'continuous', derived: { of: 'y', transform: 'log' } }, { name: 'z', role: 'predictor', type: 'continuous', derived: { of: 'y', transform: 'cube' } }], rows: [[1, 0, 1]] });
  assert.deepEqual(ds.columns[1].derived, { of: 'y', transform: 'log', replaced: null });
  const kept = makeDataset({ name: 'd', columns: [{ name: 'y', role: 'ignored', type: 'continuous' }, { name: 'y_log', role: 'response', type: 'continuous', derived: { of: 'y', transform: 'log', replaced: 'y' } }], rows: [[1, 0]] });
  assert.equal(kept.columns[1].derived.replaced, 'y');
  assert.ok(removeDerivedColumn(kept, 'y_log'));
  assert.equal(responseColumn(kept).name, 'y');
  assert.equal(ds.columns[0].derived, null);
  assert.equal(ds.columns[2].derived, null);
});

test('defaultTerms names every other predictor or response column, never a group', () => {
  const ds = makeDataset({ name: 'd', columns: [
    { name: 'y', role: 'response', type: 'continuous' }, { name: 'a', role: 'predictor', type: 'categorical' },
    { name: 'k', role: 'group', type: 'categorical' }, { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'z', role: 'ignored', type: 'continuous' }
  ], rows: [[1, 'p', 'g1', 2, 0], [2, 'q', 'g2', 3, 0]] });
  assert.deepEqual(defaultTerms(ds, 'y'), ['a', 'x']);
  // The column that was the response is a candidate predictor for any other response, and going back restores the original.
  assert.deepEqual(defaultTerms(ds, 'x'), ['y', 'a']);
  assert.deepEqual(defaultTerms(ds, 'a'), ['y', 'x']);
  assert.deepEqual(defaultTerms(ds, null), ['y', 'a', 'x']);
});

test('outcomes can be the response but never a term', () => {
  const ds = makeDataset({ name: 'd', columns: [
    { name: 'wait', role: 'response', type: 'continuous' }, { name: 'busy', role: 'outcome', type: 'continuous' },
    { name: 'a', role: 'predictor', type: 'categorical' }, { name: 'k', role: 'group', type: 'categorical' },
    { name: 'x', role: 'predictor', type: 'continuous' }, { name: 'longest', role: 'outcome', type: 'continuous' }
  ], rows: [[1, 0.5, 'p', 'g1', 2, 3], [2, 0.6, 'q', 'g2', 3, 4]] });
  assert.deepEqual(outcomeColumns(ds).map(c => c.name), ['wait', 'busy', 'longest']);
  // Whichever output is modeled, the others stay out of the terms, the response at import included.
  assert.deepEqual(defaultTerms(ds, 'wait'), ['a', 'x']);
  assert.deepEqual(defaultTerms(ds, 'busy'), ['a', 'x']);
  assert.deepEqual(termColumns(ds, 'longest').map(c => c.name), ['a', 'x']);
  // A predictor modeled as the response still leaves every output out.
  assert.deepEqual(defaultTerms(ds, 'x'), ['a']);
  // A dataset with no outcome has none, and its response stays a candidate predictor.
  const plain = makeDataset({ name: 'p', columns: ds.columns.filter(c => c.role !== 'outcome').map(c => Object.assign({}, c)), rows: [[1, 'p', 'g1', 2], [2, 'q', 'g2', 3]] });
  assert.deepEqual(outcomeColumns(plain), []);
  assert.deepEqual(defaultTerms(plain, 'x'), ['wait', 'a']);
  // A derived column can be an outcome, and a derived response steps the response back to one.
  assert.ok(deriveColumn(ds, { of: 'wait', transform: 'log', name: 'wait_log', role: 'outcome' }).ok);
  assert.deepEqual(defaultTerms(ds, 'wait_log'), ['a', 'x']);
  assert.ok(deriveColumn(ds, { of: 'busy', transform: 'sqrt', name: 'busy_sqrt', role: 'response' }).ok);
  assert.equal(column(ds, 'wait').col.role, 'outcome');
  assert.deepEqual(defaultTerms(ds, 'wait'), ['a', 'x']);
  assert.equal(removeDerivedColumn(ds, 'busy_sqrt'), true);
  assert.equal(responseColumn(ds).name, 'wait');
  assert.equal(makeDataset({ columns: [{ name: 'o', role: 'outcome', type: 'continuous' }], rows: [[1]] }).columns[0].role, 'outcome');
});

test('uniqueName numbers a name that is taken, and counts on from a number it ends in', () => {
  assert.equal(uniqueName('A', []), 'A');
  assert.equal(uniqueName('A', ['A']), 'A (2)');
  assert.equal(uniqueName('A', ['A', 'A (2)', 'A (3)']), 'A (4)');
  assert.equal(uniqueName('A', ['A', 'A (3)']), 'A (2)');
  assert.equal(uniqueName('A (2)', ['A', 'A (2)']), 'A (3)');
  assert.equal(uniqueName('Run 2', ['Run 2']), 'Run 2 (2)');
});
