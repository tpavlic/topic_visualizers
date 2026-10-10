// Tests for js/io/parse.js: cell splitting, header detection, type
// guessing, the suggested mapping, and the table built from a mapping. Every
// expected value is the tiny input written out here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCells, delimiterOf, parseRows, sniff, buildTable, isMissing } from '../js/io/parse.js';

test('splitCells keeps empty cells under a comma, tab, or semicolon and drops them under spaces', () => {
  assert.deepEqual(splitCells('a,b,,d'), ['a', 'b', '', 'd']);
  assert.deepEqual(splitCells('a,b,'), ['a', 'b', '']);
  assert.deepEqual(splitCells('a\tb\t\tc'), ['a', 'b', '', 'c']);
  assert.deepEqual(splitCells('a;b'), ['a', 'b']);
  assert.deepEqual(splitCells('  a   b  c '), ['a', 'b', 'c']);
  assert.deepEqual(splitCells('a, "b, c" ,d'), ['a', 'b, c', 'd']);
  assert.deepEqual(splitCells('"say ""hi""",2'), ['say "hi"', '2']);
  assert.deepEqual(splitCells('"two words" 3', ' '), ['two words', '3']);
  assert.deepEqual(splitCells('x', ','), ['x']);
  assert.deepEqual(splitCells('', ','), ['']);
});

test('delimiterOf prefers a comma, then a tab, then a semicolon, outside quotes', () => {
  assert.equal(delimiterOf('a,b'), ',');
  assert.equal(delimiterOf('a\tb;c'), '\t');
  assert.equal(delimiterOf('a;b'), ';');
  assert.equal(delimiterOf('"a,b" c'), ' ');
  assert.equal(delimiterOf('a b'), ' ');
});

test('parseRows picks one delimiter for the text and counts blanks and comments', () => {
  const r = parseRows('# a comment\nx,y\n\n1,2\n3,4\n');
  assert.equal(r.delimiter, ',');
  assert.equal(r.comments, 1);
  assert.equal(r.blanks, 1);
  assert.deepEqual(r.rows.map(x => x.line), [2, 4, 5]);
  assert.deepEqual(r.rows[1].vals, [1, 2]);
  assert.equal(parseRows('x y\n1 2\n').delimiter, ' ');
});

test('isMissing names the usual blanks', () => {
  for (const s of ['', ' ', 'NA', 'nan', 'N/A', 'null', 'None', '.', '?']) assert.ok(isMissing(s), s);
  assert.ok(!isMissing('0'));
  assert.ok(!isMissing('-'));
});

const text = 'wait,policy,load,rep\n2.5,A,0.8,1\n3.1,B,0.9,1\nNA,A,0.7,2\n4,B,,2\n';

test('sniff reads the header, guesses types, and suggests roles', () => {
  const sn = sniff(text, { name: 'q' });
  assert.deepEqual(sn.header, ['wait', 'policy', 'load', 'rep']);
  assert.deepEqual(sn.types, ['continuous', 'categorical', 'continuous', 'continuous']);
  assert.equal(sn.suggested.response, 'load');
  assert.equal(sn.suggested.columns.rep.role, 'group');
  assert.equal(sn.suggested.columns.rep.type, 'categorical');
  assert.equal(sn.suggested.columns.policy.role, 'predictor');
  assert.equal(sn.suggested.columns.wait.role, 'predictor');
  assert.equal(sn.issues.length, 0);
  assert.equal(sn.rows.length, 4);
});

test('sniff names a column headed y or response as the response', () => {
  const sn = sniff('x,y\n1,2\n');
  assert.equal(sn.suggested.response, 'y');
  assert.equal(sniff('response,x\n1,2\n').suggested.response, 'response');
});

test('sniff refuses a first row of numbers and reports short and long rows', () => {
  const bad = sniff('1,2\n3,4\n');
  assert.equal(bad.noHeader, true);
  assert.match(bad.issues[0].reason, /header row/);
  const sn = sniff('a,b\n1\n1,2,3\n4,5\n');
  assert.deepEqual(sn.issues.map(i => i.line), [2, 3]);
  assert.deepEqual(sn.rows.map(r => r.ok), [false, false, true]);
});

test('sniff tells duplicate headers apart as R does', () => {
  assert.deepEqual(sniff('x,x,x\n1,2,3\n').header, ['x', 'x.1', 'x.2']);
});

test('sniff reads the Output Analyzer export with the replication as the group', () => {
  const sn = sniff('dataset,replication,time,value\n"A",1,0,2.5\n"A",2,0,3\n');
  assert.equal(sn.analyzerExport, true);
  assert.equal(sn.suggested.response, 'value');
  assert.deepEqual(sn.suggested.columns.dataset, { role: 'predictor', type: 'categorical' });
  assert.deepEqual(sn.suggested.columns.replication, { role: 'group', type: 'categorical' });
  assert.equal(sn.suggested.columns.time.role, 'ignored');
  assert.equal(sniff('dataset,replication,value\nA,1,2\n').analyzerExport, true);
});

test('buildTable builds the dataset with missing values and reports non-numeric cells', () => {
  const sn = sniff(text, { name: 'q' });
  const m = { name: 'queue', response: 'wait', columns: { policy: { role: 'predictor', type: 'categorical' }, load: { role: 'predictor', type: 'continuous' }, rep: { role: 'group', type: 'categorical' } } };
  const { dataset } = buildTable(sn, m);
  assert.equal(dataset.name, 'queue');
  assert.deepEqual(dataset.columns.map(c => c.role), ['response', 'predictor', 'predictor', 'group']);
  assert.deepEqual(dataset.columns[1].levels, ['A', 'B']);
  assert.deepEqual(dataset.columns[3].levels, ['1', '2']);
  assert.deepEqual(dataset.rows[2], [null, 'A', 0.7, '2']);
  assert.deepEqual(dataset.rows[3], [4, 'B', null, '2']);
  assert.equal(dataset.issues.length, 0, 'NA and an empty cell are missing values, not errors');
  const sn2 = sniff('y,x\n1,2\nabc,3\n');
  const r2 = buildTable(sn2, { name: 'd', response: 'y', columns: { y: { type: 'continuous' }, x: { role: 'predictor', type: 'continuous' } } });
  assert.equal(r2.dataset.rows.length, 2);
  assert.equal(r2.dataset.rows[1][0], null);
  assert.match(r2.issues[0].reason, /non-numeric cell in "y"/);
});

test('buildTable keeps an ordinal column in the order the mapping gives', () => {
  const sn = sniff('size,y\nsmall,1\nlarge,2\nmedium,3\n');
  const { dataset } = buildTable(sn, { name: 'd', response: 'y', columns: { size: { role: 'predictor', type: 'ordinal', levels: ['small', 'medium', 'large'] } } });
  assert.deepEqual(dataset.columns[0].levels, ['small', 'medium', 'large']);
  assert.throws(() => buildTable(sn, { name: 'd', response: 'nope', columns: {} }), /response/);
});
