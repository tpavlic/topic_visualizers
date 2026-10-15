// A derived column travels with its dataset: the data file names the
// derivation in a provenance line, and every regenerate script says in its
// data block how the column was made, in that language's own words, beside
// the embedded values. A column centered at a known mean makes the intercept
// a control-variate estimate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/data/examples.js';
import { sniff, buildTable } from '../js/io/parse.js';
import { deriveColumn, makeDataset } from '../js/data/model.js';
import { fitModel } from '../js/stats/fit.js';
import { termTests, waldTable } from '../js/stats/inference.js';
import { modelRecipe, csvMode } from '../js/io/recipes.js';
import { analysisScript } from '../js/io/analysis_scripts.js';
import { dataFileText } from '../js/io/datafiles.js';

function derivedExample() {
  const ex = EXAMPLES.find(e => e.id === 'tour-regression');
  const ds = buildTable(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).dataset;
  assert.ok(deriveColumn(ds, { of: 'distance', transform: 'rank', name: 'distance_rank' }).ok);
  assert.ok(deriveColumn(ds, { of: 'delivery_time', transform: 'log', name: 'log_time', role: 'response' }).ok);
  return ds;
}

test('the data file names every derived column', () => {
  const text = dataFileText(derivedExample());
  assert.match(text, /^# derived columns: distance_rank = rank\(distance\); log_time = log\(delivery_time\)$/m);
  assert.match(text, /^delivery_time,distance,distance_rank,log_time$/m);
});

test('each script says how a derived column it uses was made', () => {
  const ds = derivedExample();
  const spec = { response: 'log_time', family: 'normal', link: 'identity', terms: ['distance_rank'], group: null, nested: null, slope: null, olre: false, reml: false };
  const result = fitModel(ds, spec);
  const recipe = modelRecipe({ ds, spec, result, level: 0.95, title: 'Model: ' + result.formula, provenance: { dataset: ds.name, formula: result.formula, family: spec.family }, waldRows: waldTable(result, 0.95), termTests: termTests(ds, spec, result), randomTest: null });
  const want = {
    R: ['# distance_rank was derived on the Import page as rank(distance) (ties averaged); its values are embedded above.', '# log_time was derived on the Import page as log(delivery_time); its values are embedded above.'],
    tidy: ['# distance_rank was derived on the Import page as rank(distance) (ties averaged); its values are embedded above.'],
    py: ['# distance_rank was derived on the Import page as pd.Series(distance).rank() (ties averaged); its values are embedded above.', '# log_time was derived on the Import page as np.log(delivery_time); its values are embedded above.'],
    m: ['% distance_rank was derived on the Import page as tiedrank(distance) (ties averaged); its values are embedded above.', '% log_time was derived on the Import page as log(delivery_time); its values are embedded above.']
  };
  for (const [lang, lines] of Object.entries(want)) {
    const text = analysisScript(recipe, lang);
    for (const l of lines) assert.ok(text.includes(l), lang + ' carries: ' + l);
    assert.ok(/^[\x00-\x7f]*$/.test(text), lang + ' is 7-bit ASCII');
  }
  // The comment names only the columns the model reads; in CSV mode it points at the file.
  const csv = analysisScript(csvMode(modelRecipe({ ds, spec, result, level: 0.95, title: 't', provenance: {}, waldRows: waldTable(result, 0.95), termTests: termTests(ds, spec, result), randomTest: null }), ds), 'R');
  assert.ok(csv.includes('# distance_rank was derived on the Import page as rank(distance) (ties averaged); its values are in the data file.'));
});

// A column centered at a value: the value in the data file's provenance and in every script's comment.
test('a column centered at a value names the value in the data file and the scripts', () => {
  const ex = EXAMPLES.find(e => e.id === 'tour-regression');
  const ds = buildTable(sniff(ex.text, { name: ex.mapping.name }), ex.mapping).dataset;
  assert.ok(deriveColumn(ds, { of: 'distance', transform: 'centerAt', at: -1.5, name: 'distance_c' }).ok);
  assert.match(dataFileText(ds), /^# derived columns: distance_c = distance - \(-1\.5\)$/m);
  const spec = { response: 'delivery_time', family: 'normal', link: 'identity', terms: ['distance_c'], group: null, nested: null, slope: null, olre: false, reml: false };
  const result = fitModel(ds, spec);
  const recipe = modelRecipe({ ds, spec, result, level: 0.95, title: 'Model: ' + result.formula, provenance: { dataset: ds.name, formula: result.formula, family: spec.family }, waldRows: waldTable(result, 0.95), termTests: termTests(ds, spec, result), randomTest: null });
  for (const [lang, c] of [['R', '#'], ['tidy', '#'], ['py', '#'], ['m', '%']]) {
    assert.ok(analysisScript(recipe, lang).split('\n').includes(c + ' distance_c was derived on the Import page as distance - (-1.5); its values are embedded above.'), lang);
  }
});

// The control-variate estimator is the intercept of the response regressed on the control
// centered at its known mean: Ybar - b (Cbar - mu) with b the least-squares slope, and its
// standard error s sqrt(1/n + (Cbar - mu)^2 / Sxx) on n - 2 degrees of freedom, which a
// plain t interval on the adjusted values would not give.
test('centered at its known mean, a control makes the intercept the control-variate estimate', () => {
  const Y = [10.2, 11.8, 9.5, 12.9, 10.9, 11.1, 13.4, 9.9];
  const C = [4.1, 5.0, 3.6, 5.8, 4.4, 4.9, 6.1, 3.9];
  const mu = 4.5, n = Y.length;
  const ds = makeDataset({ name: 'cv', columns: [{ name: 'y', role: 'response', type: 'continuous' }, { name: 'c', role: 'predictor', type: 'continuous' }], rows: Y.map((y, i) => [y, C[i]]) });
  assert.ok(deriveColumn(ds, { of: 'c', transform: 'centerAt', at: mu, name: 'c_c' }).ok);
  const result = fitModel(ds, { response: 'y', family: 'normal', link: 'identity', terms: ['c_c'], group: null, nested: null, slope: null, olre: false, reml: false });
  const row = waldTable(result, 0.95).find(r => r.name === '(Intercept)');
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const yb = mean(Y), cb = mean(C);
  const sxx = C.reduce((s, c) => s + (c - cb) ** 2, 0), sxy = C.reduce((s, c, i) => s + (c - cb) * (Y[i] - yb), 0);
  const b = sxy / sxx;
  const sse = Y.reduce((s, y, i) => s + (y - yb - b * (C[i] - cb)) ** 2, 0);
  const near = (a, e, msg) => assert.ok(Math.abs(a - e) <= 1e-10 * Math.max(1, Math.abs(e)), msg + ': ' + a + ' vs ' + e);
  near(row.b, yb - b * (cb - mu), 'estimate');
  near(row.se, Math.sqrt(sse / (n - 2) * (1 / n + (cb - mu) ** 2 / sxx)), 'standard error');
  assert.equal(row.df, n - 2);
});
