// Regenerates the example datasets into a temporary directory and checks that they match the
// committed files byte for byte, that each module entry's text equals its data file, and that
// every example loads through the importer with its own mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'data', 'generate_examples.mjs');
const { EXAMPLES } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'examples.js')).href);
const { sniff, buildTable } = await import(pathToFileURL(path.join(ROOT, 'js', 'io', 'parse.js')).href);
const { support, responseColumn, valuesOf } = await import(pathToFileURL(path.join(ROOT, 'js', 'data', 'model.js')).href);

test('regenerated files match the committed ones byte for byte', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'examples-'));
  try {
    execFileSync('node', [GEN, '--out', tmp]);
    const files = fs.readdirSync(path.join(tmp, 'data'));
    assert.equal(files.length, EXAMPLES.length);
    for (const f of files) {
      assert.ok(fs.readFileSync(path.join(tmp, 'data', f)).equals(fs.readFileSync(path.join(ROOT, 'data', f))), f);
    }
    const mod = path.join('js', 'data', 'examples.js');
    assert.ok(fs.readFileSync(path.join(tmp, mod)).equals(fs.readFileSync(path.join(ROOT, mod))), mod);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('each example carries its data file text and loads with no flagged row', () => {
  for (const e of EXAMPLES) {
    assert.equal(e.text, fs.readFileSync(path.join(ROOT, 'data', e.file), 'utf8'), e.file);
    const { dataset, issues } = buildTable(sniff(e.text, { name: e.mapping.name }), e.mapping);
    assert.equal(issues.length, 0, e.id);
    assert.ok(dataset.rows.length >= (e.tour ? 6 : 60), e.id);
    assert.ok(responseColumn(dataset), e.id);
  }
});

test('the examples show the supports their descriptions name', () => {
  const sup = id => {
    const e = EXAMPLES.find(x => x.id === id);
    const { dataset } = buildTable(sniff(e.text, { name: e.mapping.name }), e.mapping);
    const r = responseColumn(dataset);
    return support(r, valuesOf(dataset, r.name));
  };
  assert.equal(sup('on-time'), 'binary');
  assert.equal(sup('cycle-time'), 'positive');
  assert.equal(sup('balks'), 'count');
  assert.equal(sup('utilization'), 'unit');
  assert.equal(sup('colony-recruits'), 'count');
  assert.equal(sup('rating'), 'ordinal');
  assert.deepEqual(EXAMPLES.filter(e => e.tour).map(e => e.tour), ['t', 'anova', 'paired', 'chisq', 'proportion']);
});
