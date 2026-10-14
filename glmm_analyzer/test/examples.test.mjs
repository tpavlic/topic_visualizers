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
const { fitModel } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'fit.js')).href);
const { marginalMeans, waldP, waldDf, randomEffectTest } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'inference.js')).href);
const { onewayAnova } = await import(pathToFileURL(path.join(ROOT, 'js', 'stats', 'classical.js')).href);

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
    assert.ok(dataset.rows.length >= (e.tour ? 6 : 50), e.id);
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
  assert.equal(sup('service-speed'), 'positive');
  assert.equal(sup('on-time'), 'binary');
  assert.equal(sup('cycle-time'), 'positive');
  assert.equal(sup('balks'), 'count');
  assert.equal(sup('utilization'), 'unit');
  assert.equal(sup('colony-recruits'), 'count');
  assert.equal(sup('rating'), 'ordinal');
  assert.deepEqual(EXAMPLES.filter(e => e.tour).map(e => e.tour), ['one', 't', 'anova', 'twoway', 'regression', 'ancova', 'paired', 'repeated', 'chisq', 'gof', 'proportion']);
});

// The three readings the service-speed example is built for: one-way ANOVA with Tukey's pairs,
// one slope in place of the ten pairs, and the replication as a group, which the common random
// numbers make worth having.
test('the service-speed example shows its three readings', () => {
  const ex = EXAMPLES.find(e => e.id === 'service-speed');
  const load = m => buildTable(sniff(ex.text, { name: m.name }), m).dataset;
  const spec = (terms, group) => ({ response: 'time_in_system', family: 'normal', link: 'identity', terms, group, nested: null, slope: null, olre: false, reml: !!group });
  const dc = load(ex.mapping);
  const asNumber = structuredClone(ex.mapping);
  asNumber.columns.mean_service.type = 'continuous';
  const dn = load(asNumber);
  assert.equal(dc.rows.length, 50);

  // One-way ANOVA: the model's F is the classical one, most adjacent designs are not told
  // apart, and the extremes are.
  const anova = fitModel(dc, spec(['mean_service'], null));
  assert.deepEqual(anova.flags, []);
  const levels = dc.columns[1].levels;
  assert.deepEqual(levels, ['0.5', '0.6', '0.7', '0.8', '0.9']);
  const ow = onewayAnova(levels.map(l => dc.rows.filter(r => r[1] === l).map(r => r[0])));
  const F = ((anova.fit.nullDeviance - anova.fit.deviance) / 4) / anova.fit.dispersion;
  assert.ok(Math.abs(F - ow.F) < 1e-9 * ow.F, 'F ' + F + ' vs ' + ow.F);
  const mm = marginalMeans(dc, anova, 'mean_service', 0.95);
  const adjacent = mm.pairs.filter(p => Math.abs(Number(p.a) - Number(p.b)) < 0.15);
  assert.equal(adjacent.length, 4);
  assert.ok(adjacent.filter(p => p.p > 0.05).length >= 3, adjacent.map(p => p.p).join(', '));
  const extremes = mm.pairs.find(p => p.a === '0.5' && p.b === '0.9');
  assert.ok(extremes.p < 1e-6, 'extremes p ' + extremes.p);

  // The trend: one slope whose test is stronger than every pairwise test, and well below
  // the smallest Tukey-adjusted p.
  const trend = fitModel(dn, spec(['mean_service'], null));
  assert.deepEqual(trend.flags, []);
  const t = trend.fit.beta[1] / Math.sqrt(trend.fit.vcov[1][1]);
  const p = waldP(t, waldDf(trend.fit));
  assert.ok(trend.fit.beta[1] > 0);
  assert.ok(Math.abs(t) > Math.max(...mm.pairs.map(q => Math.abs(q.t))), 'slope t ' + t);
  assert.ok(p < Math.min(...mm.pairs.map(q => q.p)) / 10, 'slope p ' + p);

  // The replication as a group: a clear between-replication variance, and the residual
  // variance about half of the fixed-effects model's.
  for (const [ds, label] of [[dc, 'anova'], [dn, 'trend']]) {
    const s = spec(['mean_service'], 'replication');
    const mixed = fitModel(ds, s);
    const fixed = label === 'anova' ? anova : trend;
    assert.deepEqual(mixed.flags, [], label);
    assert.ok(mixed.fit.sigma2 < 0.6 * fixed.fit.dispersion, label + ': ' + mixed.fit.sigma2 + ' vs ' + fixed.fit.dispersion);
    assert.ok(randomEffectTest(ds, s, mixed).p < 0.001, label);
  }
});

// The page opens this example on a gamma model with the replication as the group. Its dispersion
// is small, as a mean over many customers makes it, and a search whose inner solve started from
// the previous evaluation's modes ran to its cap at the optimum.
test('the service-speed example\'s default gamma mixed fit converges', () => {
  const ex = EXAMPLES.find(e => e.id === 'service-speed');
  const ds = buildTable(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).dataset;
  const r = fitModel(ds, { response: 'time_in_system', family: 'gamma', link: 'log', terms: ['mean_service'], group: 'replication', nested: null, slope: null, olre: false, reml: false });
  assert.deepEqual(r.flags, []);
  assert.ok(r.fit.converged);
});
