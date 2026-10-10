// Tests for js/stats/design.js against reference/design.R: R's model.matrix
// on continuous, categorical, and ordinal predictors, a raw power, an
// interaction, and an aliased column, plus contr.poly itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDataset } from '../js/data/model.js';
import { modelMatrix, contrPoly, polyNames, orderedTerms, termLabel, formulaOf, missingMainEffects } from '../js/stats/design.js';

const ref = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'reference', 'design.json'), 'utf8'));
const close = (a, b, tol = 1e-12, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + ' ' + a + ' vs ' + b);

const ds = makeDataset({
  name: 'd',
  columns: [
    { name: 'y', role: 'response', type: 'continuous' },
    { name: 'x', role: 'predictor', type: 'continuous' },
    { name: 'f', role: 'predictor', type: 'categorical' },
    { name: 'o', role: 'predictor', type: 'ordinal', levels: ['low', 'mid', 'high'] },
    { name: 'g', role: 'predictor', type: 'categorical' },
    { name: 'z', role: 'predictor', type: 'continuous' }
  ],
  rows: [
    [1.2, 0.5, 'a', 'low', '10', 1.5], [0.8, 1.5, 'b', 'mid', '2', 2.5], [2.5, 2.0, 'c', 'high', '1', 3.0], [3.1, 3.5, 'a', 'high', '10', 4.5],
    [0.4, 0.2, 'b', 'low', '2', 1.2], [1.9, 2.8, 'c', 'mid', '1', 3.8], [2.2, 1.1, 'a', 'low', '10', 2.1], [2.8, 3.9, 'b', 'high', '2', 4.9],
    [1.0, 0.9, 'c', 'mid', '1', 1.9], [1.5, 2.3, 'a', 'low', '10', 3.3]
  ]
});

function check(m, r) {
  assert.deepEqual(m.names, r.names);
  assert.equal(m.X.length, r.rows.length);
  for (let i = 0; i < r.rows.length; i++) for (let j = 0; j < r.names.length; j++) close(m.X[i][j], r.rows[i][j], 1e-12, r.names[j] + ' row ' + i);
}

test('contr.poly matches R, sign and all', () => {
  for (const [k, key] of [[4, 'poly4'], [5, 'poly5']]) {
    const P = contrPoly(k);
    for (let i = 0; i < k; i++) for (let j = 0; j < k - 1; j++) close(P[i][j], ref[key][i][j], 1e-12, key + ' ' + i + ',' + j);
  }
  assert.deepEqual(polyNames(5), ['.L', '.Q', '.C', '^4']);
});

test('continuous, categorical, ordinal, a power, and an interaction, in R\'s order and names', () => {
  const m = modelMatrix(ds, { response: 'y', terms: ['x', 'f', 'o', { name: 'x', degree: 2 }, { of: ['x', 'f'] }] });
  check(m, ref.m1);
  assert.deepEqual(m.assign, [-1, 0, 1, 1, 2, 2, 3, 4, 4]);
  assert.deepEqual(m.aliased, []);
  assert.deepEqual(Array.from(m.y), [1.2, 0.8, 2.5, 3.1, 0.4, 1.9, 2.2, 2.8, 1.0, 1.5]);
});

test('numeric-looking levels sort as R sorts them', () => {
  check(modelMatrix(ds, { response: 'y', terms: ['g'] }), ref.m2);
});

test('an aliased column is dropped and named', () => {
  const m = modelMatrix(ds, { response: 'y', terms: ['x', 'z'] });
  assert.deepEqual(m.names, ['(Intercept)', 'x']);
  assert.deepEqual(m.aliased, ['z']);
});

test('terms are reordered as R orders them, main effects before interactions', () => {
  const spec = { response: 'y', terms: [{ of: ['f', 'o'] }, 'f', 'o'] };
  assert.deepEqual(orderedTerms(spec).map(termLabel), ['f', 'o', 'f:o']);
  // Two of the nine cells of f by o are empty, and so the table's rank is 7:
  // R's model.matrix keeps all nine columns and glm reports the last two as
  // NA, and here they are dropped as aliased.
  const m = modelMatrix(ds, spec);
  assert.deepEqual(m.aliased, ['fb:o.Q', 'fc:o.Q']);
  check(m, { names: ref.m4.names.slice(0, 7), rows: ref.m4.rows.map(r => r.slice(0, 7)) });
  assert.deepEqual(missingMainEffects({ terms: [{ of: ['f', 'o'] }, 'f'] }), ['o']);
});

test('rows with a missing value in a used column are dropped', () => {
  const d2 = makeDataset({ columns: ds.columns, rows: ds.rows.map((r, i) => (i === 3 ? [r[0], null, r[2], r[3], r[4], r[5]] : r)) });
  const m = modelMatrix(d2, { response: 'y', terms: ['x'] });
  assert.equal(m.X.length, 9);
  assert.equal(m.dropped, 1);
  assert.deepEqual(m.keep, [0, 1, 2, 4, 5, 6, 7, 8, 9]);
  assert.equal(modelMatrix(d2, { response: 'y', terms: ['f'] }).dropped, 0);
});

test('the group column gives level indices, and the formula reads as lme4 writes it', () => {
  const m = modelMatrix(ds, { response: 'y', terms: ['x'], group: 'f' });
  assert.deepEqual(m.groups.levels, ['a', 'b', 'c']);
  assert.deepEqual(m.groups.ids, [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  assert.equal(formulaOf({ response: 'y', terms: ['x', 'f', { of: ['x', 'f'] }, { name: 'x', degree: 2 }], group: 'g', slope: 'x' }), 'y ~ x + f + I(x^2) + x:f + (1 + x | g)');
  assert.equal(formulaOf({ response: 'y', terms: [], group: 'g', nested: 'h' }), 'y ~ 1 + (1 | g) + (1 | g:h)');
  assert.equal(formulaOf({ response: 'y', terms: ['x'], group: null, olre: true }), 'y ~ x + (1 | obs)');
});
