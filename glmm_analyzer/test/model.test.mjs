// Tests for js/data/model.js: dataset construction, level sorting, the
// response's support, the rows a model uses, and dataset equality. Every
// expected value is the tiny input written out here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDataset, sortLevels, support, usedRows, sameData, canModel, column, valuesOf, datasetSummary, responseColumn } from '../js/data/model.js';

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
