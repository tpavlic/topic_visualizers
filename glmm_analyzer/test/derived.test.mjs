// A derived column travels with its dataset: the data file names the
// derivation in a provenance line, and every regenerate script says in its
// data block how the column was made, in that language's own words, beside
// the embedded values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAMPLES } from '../js/data/examples.js';
import { sniff, buildTable } from '../js/io/parse.js';
import { deriveColumn } from '../js/data/model.js';
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
