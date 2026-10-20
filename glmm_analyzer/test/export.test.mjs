// Tests for js/io/export.js: the shape of every CSV writer's output. Expected
// values are the tiny inputs written out here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDataset } from '../js/data/model.js';
import { csvEscape, toCsv, provenanceLines, datasetCsv, tableCsv, svgToString, svgToPngBlob, downloadText, downloadBlob, slug, csvHead } from '../js/io/export.js';

const lines = text => text.split('\n').filter(l => l !== '');

const ds = makeDataset({
  name: 'queue',
  columns: [{ name: 'wait', role: 'response', type: 'continuous' }, { name: 'policy', role: 'predictor', type: 'categorical' }, { name: 'rep', role: 'group', type: 'categorical' }],
  rows: [[2.5, 'A', '1'], [null, 'B, "x"', '1'], [4, 'A', 'run#2']]
});

test('csvEscape and toCsv quote by RFC 4180', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('a, b'), '"a, b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape('two\nlines'), '"two\nlines"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(NaN), '');
  assert.equal(csvEscape(2.5), '2.5');
  assert.equal(toCsv([['a', 'b'], [1, 'x,y']]), 'a,b\n1,"x,y"\n');
});

test('provenanceLines keeps insertion order', () => {
  assert.deepEqual(
    provenanceLines({ dataset: 'wait', level: 0.95, skipped: undefined, note: 'two\nlines' }),
    ['# dataset: wait', '# level: 0.95', '# note: two lines']
  );
});

test('provenanceLines turns commas into semicolons and stays unquoted', () => {
  // A spreadsheet would split a comma into a new column; quoting the line
  // would hide its '#' from R and Python.
  assert.deepEqual(
    provenanceLines({ dataset: 'Queue, "A"', fit: 'maximum likelihood, Laplace approximation', flags: ['a', 'b'], 'x, y': 1 }),
    ['# dataset: Queue; "A"', '# fit: maximum likelihood; Laplace approximation', '# flags: a; b', '# x; y: 1']
  );
});

test('datasetCsv writes every column, a missing value as an empty field, and quotes a #', () => {
  assert.deepEqual(lines(datasetCsv(ds, { dataset: 'queue', response: 'wait' })), [
    '# dataset: queue', '# response: wait', 'wait,policy,rep', '2.5,A,1', ',"B, ""x""",1', '4,A,"run#2"'
  ]);
});

test('tableCsv writes an infinite number as Inf and NaN as an empty field', () => {
  assert.deepEqual(lines(tableCsv(['term', 'F', 'p'], [['x', Infinity, 0], ['z', -Infinity, NaN]], { comparisons: 1 })),
    ['# comparisons: 1', 'term,F,p', 'x,Inf,0', 'z,-Inf,']);
});

test('browser-only functions throw without a DOM', () => {
  assert.throws(() => svgToString({}), /browser/);
  assert.throws(() => svgToPngBlob({}, 2), /browser/);
  assert.throws(() => downloadText('a.csv', 'x'), /browser/);
  assert.throws(() => downloadBlob('a.png', null), /browser/);
});

test('slug: lower-case words joined by hyphens, at most 60 characters, never ending in one', () => {
  assert.equal(slug('Queue, "A"'), 'queue-a');
  assert.equal(slug('···'), 'data');
  assert.equal(slug('x'.repeat(80)).length, 60);
  assert.equal(slug('a'.repeat(59) + ' b'), 'a'.repeat(59));
  for (let k = 50; k <= 62; k++) {
    const t = slug('w'.repeat(k) + ' tail ' + 'z'.repeat(20));
    assert.ok(t.length <= 60 && !/^-|-$/.test(t), t);
  }
});

test('csvHead reads the notes, the header, the first records, and a count of the rest', () => {
  const text = datasetCsv(ds, { dataset: 'queue' });
  const h = csvHead(text, 2);
  assert.deepEqual(h.notes, ['dataset: queue']);
  assert.deepEqual(h.header, ['wait', 'policy', 'rep']);
  assert.deepEqual(h.rows, [['2.5', 'A', '1'], ['', 'B, "x"', '1']]);
  assert.equal(h.more, 1);
  assert.deepEqual(csvHead('', 3), { notes: [], header: [], rows: [], more: 0 });
});
