// The Compare page: the candidate models kept on the Model page, refitted
// and ranked by AIC, with the likelihood-ratio test between every nested
// pair, and a plain statement of what the criteria can and cannot compare.

import * as state from '../state.js';
import { FAMILIES, LINKS } from '../stats/families.js';
import { fitModel } from '../stats/fit.js';
import { formulaOf, termLabel, orderedTerms } from '../stats/design.js';
import { chi2Cdf } from '../stats/special.js';
import { notice, details } from '../ui/widgets.js';
import { installExportRow } from '../ui/exportrow.js';
import { compareRecipe, tooBig, capRecipe } from '../io/recipes.js';
import { esc, num, stat, pValue, intl, plural } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'compare';
/** The page's title. */
export const title = 'Compare';

let rootEl = null;
let els = {};
let timer = null;

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">The models kept on the Model page, side by side. AIC and BIC rank models of the same response fitted by maximum likelihood to the same rows: the smaller the better, and a difference in AIC under about 2 is no difference at all. A likelihood-ratio test compares two models where one holds the other’s terms and more. Comparing the models by their fit says nothing about which one answers the question; a model with a predictor you care about stays in on those grounds.</p>' +
    '<div class="sec"><div class="sec-hd">Candidate models</div><div id="cp-table"></div></div>' +
    '<div class="sec"><div class="sec-hd">Likelihood-ratio tests between nested pairs</div><div id="cp-pairs"></div></div>';
  els = { table: root.querySelector('#cp-table'), pairs: root.querySelector('#cp-pairs') };
  installExportRow(root, id);
  state.on('models', schedule);
  state.on('datasets', schedule);
  state.on('settings', schedule);
  schedule();
}

/** Called each time the page is shown. */
export function onShow() { schedule(); }

function schedule() { clearTimeout(timer); timer = setTimeout(compute, 40); }

// Whether model a's fixed terms are a subset of model b's, with the same
// response, family, link, dataset, and random part, and so the pair can be
// tested by a likelihood ratio.
function nestedIn(a, b) {
  const same = ['dataset', 'response', 'family', 'group', 'nested', 'slope', 'olre'].every(k => (a.spec[k] || null) === (b.spec[k] || null)) && LINKS[a.result.link].id === LINKS[b.result.link].id;
  if (!same) return false;
  const ta = orderedTerms(a.spec).map(termLabel), tb = orderedTerms(b.spec).map(termLabel);
  return ta.length < tb.length && ta.every(t => tb.includes(t));
}
// Whether model a has b's fixed terms and no random part where b has one.
function randomNestedIn(a, b) {
  const sameFixed = ['dataset', 'response', 'family'].every(k => (a.spec[k] || null) === (b.spec[k] || null)) && LINKS[a.result.link].id === LINKS[b.result.link].id &&
    orderedTerms(a.spec).map(termLabel).join('|') === orderedTerms(b.spec).map(termLabel).join('|');
  return sameFixed && !a.spec.group && !a.spec.olre && !!(b.spec.group || b.spec.olre);
}

function compute() {
  const rows = [];
  for (const m of state.models) {
    const ds = state.get(m.spec.dataset);
    if (!ds) continue;
    let result = null, error = null;
    try {
      // The comparisons need maximum-likelihood fits.
      result = fitModel(ds, Object.assign({}, m.spec, { reml: false }));
      if (result.refused) { error = 'the response lies outside the family’s support'; result = null; }
    } catch (err) { error = err.message; }
    rows.push({ model: m, ds, spec: m.spec, result, error });
  }
  if (!rows.length) {
    els.table.innerHTML = '<p class="muted-line">No models kept yet. Fit one on the <a href="#model">Model</a> page and press Keep this model.</p>';
    els.pairs.innerHTML = '';
    state.setResult(id, null);
    return;
  }
  const fitted = rows.filter(r => r.result);
  const minAic = Math.min(...fitted.map(r => r.result.fit.aic));
  fitted.sort((a, b) => a.result.fit.aic - b.result.fit.aic);
  let html = '<div class="scroll-box"><table class="ptab"><thead><tr><th>Model</th><th>Dataset</th><th>Formula</th><th>Family, link</th><th>k</th><th>log-likelihood</th><th>AIC</th><th>ΔAIC</th><th>BIC</th><th class="no-print"></th></tr></thead><tbody>';
  const tableRows = [];
  for (const r of fitted) {
    const f = r.result.fit;
    html += '<tr><td>' + esc(r.model.name) + '</td><td>' + esc(r.ds.name) + '</td><td><code>' + esc(formulaOf(r.spec)) + '</code></td><td>' + esc(FAMILIES[f.family].label + ', ' + LINKS[r.result.link].label) + '</td><td>' + intl(f.df) + '</td><td>' + stat(f.logLik, 5) + '</td><td>' + stat(f.aic, 5) + '</td><td>' + stat(f.aic - minAic, 4) + '</td><td>' + stat(f.bic, 5) + '</td>' +
      '<td class="no-print"><button type="button" class="btn-clear cp-use" data-id="' + esc(r.model.id) + '">Open</button> <button type="button" class="btn-clear cp-drop" data-id="' + esc(r.model.id) + '">Drop</button></td></tr>';
    tableRows.push([r.model.name, r.ds.name, formulaOf(r.spec), FAMILIES[f.family].label + ', ' + LINKS[r.result.link].label, f.df, f.logLik, f.aic, f.aic - minAic, f.bic]);
  }
  for (const r of rows.filter(x => !x.result)) {
    html += '<tr><td>' + esc(r.model.name) + '</td><td>' + esc(r.ds.name) + '</td><td><code>' + esc(formulaOf(r.spec)) + '</code></td><td colspan="5" class="muted-line">could not be fitted: ' + esc(r.error) + '</td><td class="no-print"><button type="button" class="btn-clear cp-drop" data-id="' + esc(r.model.id) + '">Drop</button></td></tr>';
  }
  html += '</tbody></table></div>';
  els.table.innerHTML = html;
  const notes = [];
  if (new Set(fitted.map(r => r.spec.dataset + '|' + r.spec.response)).size > 1) notes.push('The models do not all share one response in one dataset. AIC and BIC compare only models of the same response fitted to the same rows; across responses or datasets the numbers mean nothing against each other.');
  if (new Set(fitted.map(r => r.spec.family === 'normal' && r.result.link === 'identity' ? 'lin' : r.spec.family)).size > 1 && new Set(fitted.map(r => r.spec.dataset + '|' + r.spec.response)).size === 1) notes.push('The models use different families. AIC compares families of the same response on their full likelihoods, which these are, with one caution: a normal model of a count or a proportion is a different kind of claim about the same numbers, and a lower AIC does not make it the right kind.');
  if (state.models.some(m => m.spec.reml)) notes.push('A model kept with REML on was refitted by maximum likelihood here, as the comparisons need.');
  if (new Set(fitted.map(r => r.result.design.X.length)).size > 1 && new Set(fitted.map(r => r.spec.dataset)).size === 1) notes.push('The models were fitted to different numbers of rows, because missing values were dropped by the columns each uses; that alone changes the log-likelihood.');
  for (const n of notes) els.table.appendChild(notice('warn', esc(n)));
  els.table.appendChild(details('What the criteria measure',
    '<p>AIC is −2 log-likelihood + 2k and BIC is −2 log-likelihood + k log n, for k estimated parameters: the fit, charged for its size, so that a term stays only if it improves the likelihood by more than its own cost. BIC’s charge grows with the sample and so it prefers smaller models in large samples. Neither says the best model is a good one; the Diagnostics page says that.</p>' +
    '<p>A likelihood-ratio test asks whether the extra terms of the larger model improve the fit by more than chance would: twice the difference in log-likelihood, against a chi-square with the extra parameters as its degrees of freedom. It applies only where one model nests inside the other.</p>'));
  const pairRows = [];
  let ph = '';
  for (let i = 0; i < fitted.length; i++) {
    for (let j = 0; j < fitted.length; j++) {
      if (i === j) continue;
      const a = fitted[i], b = fitted[j];
      let kind = null;
      if (nestedIn(a, b)) kind = 'terms';
      else if (randomNestedIn(a, b)) kind = 'random';
      if (!kind) continue;
      const fa = a.result.fit, fb = b.result.fit;
      const stat_ = Math.max(0, 2 * (fb.logLik - fa.logLik)), df = fb.df - fa.df;
      let p;
      if (kind === 'random') p = 0.5 * (df > 1 ? 1 - chi2Cdf(stat_, df - 1) : (stat_ > 0 ? 0 : 1)) + 0.5 * (1 - chi2Cdf(stat_, df));
      else p = df > 0 ? 1 - chi2Cdf(stat_, df) : NaN;
      ph += '<tr><td>' + esc(a.model.name) + '</td><td>' + esc(b.model.name) + '</td><td>' + esc(kind === 'random' ? 'the random part' : 'extra terms') + '</td><td>' + intl(df) + '</td><td>' + stat(stat_, 4) + '</td><td>' + pValue(p) + (kind === 'random' ? ' <span class="ctrl-note">(boundary-corrected)</span>' : '') + '</td></tr>';
      pairRows.push([a.model.name, b.model.name, kind, df, stat_, p]);
    }
  }
  els.pairs.innerHTML = ph ? '<div class="scroll-box"><table class="ptab"><thead><tr><th>Smaller model</th><th>Larger model</th><th>Adds</th><th>df</th><th>χ²</th><th>p</th></tr></thead><tbody>' + ph + '</tbody></table></div>' : '<p class="muted-line">No kept pair nests: a pair is tested when one model holds the other’s terms and more, with the same response, family, link, and random part, or adds a random part to the same fixed terms.</p>';
  els.table.querySelectorAll('.cp-use').forEach(b => b.addEventListener('click', () => { const m = state.models.find(x => x.id === b.dataset.id); if (m) { state.setSpec(m.spec); location.hash = '#model'; } }));
  els.table.querySelectorAll('.cp-drop').forEach(b => b.addEventListener('click', () => state.dropModel(b.dataset.id)));
  const title = 'Compare: ' + plural(fitted.length, 'candidate model');
  const provenance = { models: fitted.length, 'ranked by': 'AIC', fits: 'maximum likelihood' };
  // One script fits every candidate to one dataset; candidates spread over
  // several datasets get none.
  let regen = null;
  if (fitted.length && new Set(fitted.map(r => r.spec.dataset)).size === 1) {
    const ds = fitted[0].ds, level = state.settings.level;
    const candidates = fitted.map(r => ({ name: r.model.name, spec: Object.assign({}, r.spec, { reml: false }), result: r.result }));
    const specs = candidates.map(c => c.spec);
    const pairs = pairRows.map(p => ({ a: p[0], b: p[1], kind: p[2], df: p[3], stat: p[4], p: p[5] }));
    regen = { specs, ds, tooBig: () => tooBig(ds, specs), build: () => capRecipe(compareRecipe({ ds, level, title, provenance, candidates, pairs }), ds, specs) };
  }
  state.setResult(id, {
    title,
    provenance,
    regen,
    tables: [
      { name: 'Candidate models', headers: ['model', 'dataset', 'formula', 'family_link', 'k', 'log_likelihood', 'AIC', 'delta_AIC', 'BIC'], rows: tableRows }
    ].concat(pairRows.length ? [{ name: 'Likelihood-ratio tests', headers: ['smaller', 'larger', 'adds', 'df', 'chi_square', 'p'], rows: pairRows }] : [])
  });
  registerTips(rootEl);
}

export default { id, title, render, onShow };
