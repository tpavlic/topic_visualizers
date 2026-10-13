// The Predict page's recipe with no predictor: the effect plot and the
// calculator both reduce to the intercept, and so the scripts take both from
// the intercept coefficient, with no new-data rows, and draw the mean across
// the observations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDataset } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';
import { predictRows, waldTable } from '../js/stats/inference.js';
import { predictRecipe } from '../js/io/recipes.js';
import { analysisScript } from '../js/io/analysis_scripts.js';

test('an intercept-only effect plot and calculator come from the intercept in every script', () => {
  const ds = makeDataset({ name: 'd', columns: [{ name: 'y', role: 'response', type: 'continuous' }], rows: [[5.1], [4.8], [6.2], [5.5], [4.9], [5.8]] });
  const spec = { response: 'y', family: 'normal', link: 'identity', terms: [], group: null, nested: null, slope: null, olre: false, reml: false };
  const result = fitModel(ds, spec);
  const pred = predictRows(ds, result, [{}], 0.95);
  const effect = { x: null, by: null, series: [{ label: 'predicted mean', by: null, rows: [{}], pred }] };
  const calc = { row: {}, pred };
  const r = predictRecipe({ ds, spec, result, level: 0.95, title: 't', provenance: {}, waldRows: waldTable(result, 0.95), effect, means: null, calc });
  assert.equal(r.interceptOnly, true);
  assert.equal(r.effect.x, null);
  assert.deepEqual(r.calc.row, {});
  assert.equal(r.expect['effect predicted mean point 1 fit'], pred.fit[0]);
  assert.equal(r.expect['calc lower'], pred.fitLo[0]);
  const want = {
    R: ['eta1 <- b[1]', 'etac <- b[1]', 'fig_effect(list(seq_len(nrow(d)))'],
    tidy: ['eta1 <- b[1]', 'fig_effect(list(seq_len(nrow(d)))'],
    py: ['eta1 = np.array([b[0]])', 'etac = np.array([b[0]])', 'fig_effect([np.arange(1, len(d) + 1, dtype=float)]'],
    m: ['eta1 = b(1);', 'etac = b(1);', "fig_effect({(1:height(tbl))'}"]
  };
  for (const [lang, lines] of Object.entries(want)) {
    const text = analysisScript(r, lang);
    for (const l of lines) assert.ok(text.includes(l), lang + ' carries: ' + l);
    assert.ok(!/\bnd1\b|\bnc\b/.test(text), lang + ' has no new-data rows');
  }
  // With a predictor, the recipe is as before.
  const ds2 = makeDataset({ name: 'd', columns: [{ name: 'y', role: 'response', type: 'continuous' }, { name: 'x', role: 'predictor', type: 'continuous' }], rows: [[5.1, 1], [4.8, 2], [6.2, 3], [5.5, 4], [4.9, 5], [5.8, 6]] });
  const spec2 = Object.assign({}, spec, { terms: ['x'] });
  const result2 = fitModel(ds2, spec2);
  const pred2 = predictRows(ds2, result2, [{ x: 2 }, { x: 4 }], 0.95);
  const r2 = predictRecipe({ ds: ds2, spec: spec2, result: result2, level: 0.95, title: 't', provenance: {}, waldRows: waldTable(result2, 0.95), effect: { x: 'x', by: null, series: [{ label: null, by: null, rows: [{ x: 2 }, { x: 4 }], pred: pred2 }] }, means: null, calc: { row: { x: 3 }, pred: predictRows(ds2, result2, [{ x: 3 }], 0.95) } });
  assert.equal(r2.interceptOnly, false);
  assert.equal(r2.effect.x, 'x');
  assert.deepEqual(r2.calc.row, { x: 3 });
});
