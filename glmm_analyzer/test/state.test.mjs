// Tests for the dataset list in js/state.js: two datasets never share a name,
// because the data files and the regenerate scripts are named from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../js/state.js';
import { makeDataset } from '../js/data/model.js';

const ds = name => makeDataset({ name, columns: [{ name: 'y', role: 'response', type: 'continuous' }], rows: [[1], [2]] });

test('a dataset added under a name in use takes the next number, and a rename to one is refused', () => {
  const a = state.add(ds('Trial'));
  const b = state.add(ds('Trial'));
  assert.deepEqual([a.name, b.name], ['Trial', 'Trial (2)']);
  assert.equal(state.add(Object.assign(ds('Trial (2)'), { id: b.id })).name, 'Trial (2)');
  assert.equal(state.rename(b.id, 'Trial'), false);
  assert.equal(state.get(b.id).name, 'Trial (2)');
  assert.equal(state.rename(b.id, 'Pilot'), true);
  assert.equal(state.get(b.id).name, 'Pilot');
  for (const d of [a, b]) state.remove(d.id);
});
