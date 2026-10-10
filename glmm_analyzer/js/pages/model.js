// The Model page: the formula builder, the fit, and what the fit says: the
// coefficient table with its Wald intervals and back-transformed ratios,
// the variance components, the fit statistics, the term table, and the
// checks line; and the Keep button that adds the model to the candidates
// the Compare page ranks.

import * as state from '../state.js';
import { column, support, valuesOf, SUPPORT_LABEL } from '../data/model.js';
import { FAMILIES, LINKS, familyOf } from '../stats/families.js';
import { fitModel, FLAG_TEXT } from '../stats/fit.js';
import { termTests, randomEffectTest, waldTable } from '../stats/inference.js';
import { residualSet } from '../stats/residuals.js';
import { shapiroWilk } from '../stats/normality.js';
import { formulaOf, termLabel, orderedTerms } from '../stats/design.js';
import { normCdf, normInv, tCdf, tQuantile } from '../stats/special.js';
import { formulaBuilder } from '../ui/formula.js';
import { card, cardRow, notice, details, listWords } from '../ui/widgets.js';
import { installExportRow } from '../ui/exportrow.js';
import { modelRecipe, tooBig, capRecipe } from '../io/recipes.js';
import { esc, num, stat, pValue, pEq, intl, plural, lvl } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'model';
/** The page's title. */
export const title = 'Model';

let rootEl = null;
let els = {};
let lastFit = null;
let timer = null;

/**
 * The current fit, or null, for the other pages: `{ ds, spec, result }`
 * where `result` is fitModel's output. Recomputed when the spec changes.
 */
export function currentFit() { return lastFit; }

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Choose the response, the family and link, and the terms, and the model is fitted as you build it. The coefficients are on the link scale, with the ratio each one implies where the link gives one, and every interval is a Wald interval at the shared confidence level. A term’s likelihood-ratio test refits the model without it.</p>' +
    '<div class="sec ctrl-card" id="md-builder"></div>' +
    '<div id="md-flags"></div>' +
    '<div class="sec" id="md-coef"><div class="sec-hd">Coefficients</div><div id="md-coef-body"></div></div>' +
    '<div class="sec" id="md-random" hidden><div class="sec-hd">Random effects</div><div id="md-random-body"></div></div>' +
    '<div class="sec" id="md-stats"><div class="sec-hd">Fit</div><div id="md-stats-body"></div></div>' +
    '<div class="sec" id="md-terms"><div class="sec-hd">Term tests</div><div id="md-terms-body"></div></div>' +
    '<div class="sec" id="md-keep"><div class="sec-hd">Keep for comparison</div>' +
      '<div class="ctrl-row"><span class="ctrl-pair"><label class="ctrl-lbl" for="md-keep-name">Name</label><input type="text" id="md-keep-name" class="txt-inp" autocomplete="off" spellcheck="false"></span>' +
      '<button type="button" class="btn-run2" id="md-keep-btn">Keep this model</button><span class="ctrl-note" id="md-keep-note" aria-live="polite"></span></div>' +
      '<p class="exp-note">A kept model joins the table on the Compare page, where the candidates are ranked by AIC and tested against one another. Keeping the same model twice renames it.</p>' +
    '</div>';
  els = { builder: root.querySelector('#md-builder'), flags: root.querySelector('#md-flags'), coef: root.querySelector('#md-coef-body'), stats: root.querySelector('#md-stats-body'),
    random: root.querySelector('#md-random'), randomBody: root.querySelector('#md-random-body'), terms: root.querySelector('#md-terms-body'), keepName: root.querySelector('#md-keep-name'), keepBtn: root.querySelector('#md-keep-btn'), keepNote: root.querySelector('#md-keep-note') };
  formulaBuilder(els.builder, { page: id });
  els.keepBtn.addEventListener('click', () => {
    if (!lastFit || !lastFit.result || !lastFit.result.fit) return;
    const name = els.keepName.value.trim() || defaultName();
    const m = state.keepModel(name);
    els.keepNote.textContent = 'Kept as ' + m.name + '.';
    els.keepName.value = '';
  });
  installExportRow(root, id);
  state.on('spec', schedule);
  state.on('settings', schedule);
  state.on('datasets', schedule);
  schedule();
}

/** Called each time the page is shown. */
export function onShow() { schedule(); }

function defaultName() {
  const n = state.models.length + 1;
  return 'Model ' + n + ': ' + formulaOf(state.spec);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(compute, 30);
}

function compute() {
  const ds = state.get(state.spec.dataset);
  els.flags.innerHTML = '';
  if (!ds || !state.spec.response) {
    lastFit = null;
    els.coef.innerHTML = '<p class="muted-line">Choose a dataset and a response above.</p>';
    els.stats.innerHTML = ''; els.terms.innerHTML = '';
    els.keepBtn.disabled = true;
    state.setResult(id, null);
    return;
  }
  let result;
  try {
    result = fitModel(ds, state.spec);
  } catch (err) {
    lastFit = null;
    els.flags.appendChild(notice('warn', esc(err.message)));
    els.coef.innerHTML = '';
    els.stats.innerHTML = ''; els.terms.innerHTML = '';
    els.keepBtn.disabled = true;
    state.setResult(id, null);
    return;
  }
  if (result.refused) {
    lastFit = null;
    const r = result.refused;
    const fam = familyOf(state.spec.family);
    const MAX = 10;
    const rows = r.rows.slice(0, MAX).map(x => intl(x)).join(', ') + (r.rows.length > MAX ? ', and ' + intl(r.rows.length - MAX) + ' more' : '');
    const fits = r.fitting.map(f => FAMILIES[f].label);
    els.flags.appendChild(notice('warn', 'The ' + esc(fam.label) + ' family needs every response value to be ' + esc(fam.domain) + ', and so no model is fitted. The response holds ' + esc(r.support) + '; outside the family’s support: ' + (r.rows.length === 1 ? 'row ' : 'rows ') + rows + '. ' +
      (fits.length ? 'Of the families offered, ' + (fits.length === 1 ? 'only the ' + esc(fits[0]) + ' fits' : esc(listWords(fits)) + ' fit') + ' these values.' : 'No family offered fits these values.')));
    els.coef.innerHTML = '';
    els.stats.innerHTML = ''; els.terms.innerHTML = '';
    els.keepBtn.disabled = true;
    state.setResult(id, null);
    return;
  }
  lastFit = { ds, spec: state.copySpec(state.spec), result };
  for (const f of result.flags) {
    let text = FLAG_TEXT[f] || f;
    if (f === 'aliased') text += ' Dropped: ' + result.design.aliased.join(', ') + '.';
    els.flags.appendChild(notice('warn', esc(text)));
  }
  if (result.design.dropped) els.flags.appendChild(notice('info', esc(plural(result.design.dropped, 'row was', 'rows were') + ' left out for a missing value in a column the model uses; ' + intl(result.design.X.length) + ' rows remain.')));
  if (result.event) els.flags.appendChild(notice('info', 'The response ' + esc(state.spec.response) + ' is modeled as the probability of <b>' + esc(result.event) + '</b>, its second level in sorted order.'));
  drawCoefficients(result);
  drawRandom(ds, result);
  drawStats(result);
  drawChecks(result);
  const tt = drawTerms(ds, result);
  els.keepBtn.disabled = false;
  registerResult(ds, result, tt);
}

function waldRows(result) { return waldTable(result, state.settings.level); }

function drawCoefficients(result) {
  const rows = waldRows(result);
  const link = LINKS[result.link];
  const useT = rows.length && rows[0].useT;
  const level = state.settings.level;
  const backHead = link.backName ? '<th>' + esc(link.backName === 'ratio' ? (FAMILIES[result.fit.family].id === 'poisson' || FAMILIES[result.fit.family].id === 'negbin' ? 'rate ratio' : 'ratio of means') : link.backName) + '</th><th>its ' + esc(lvl(level)) + ' interval</th>' : '';
  let html = '<div class="scroll-box"><table class="ptab"><thead><tr><th>Term</th><th>Estimate</th><th>Std. error</th><th>' + (useT ? 't' : 'z') + '</th><th>p</th><th>' + esc(lvl(level)) + ' interval</th>' + backHead + '</tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr><td>' + esc(r.name) + '</td><td>' + stat(r.b, 5) + '</td><td>' + stat(r.se, 4) + '</td><td>' + stat(r.z, 4) + '</td><td>' + pValue(r.p) + '</td><td>[' + stat(r.lo, 5) + ', ' + stat(r.hi, 5) + ']</td>' +
      (link.backName ? (r.back ? '<td>' + stat(r.back.est, 4) + '</td><td>[' + stat(r.back.lo, 4) + ', ' + stat(r.back.hi, 4) + ']</td>' : '<td>–</td><td>–</td>') : '') + '</tr>';
  }
  html += '</tbody></table></div>';
  const scale = result.link === 'identity' ? 'in the response’s units' : 'on the ' + link.label + ' scale';
  html += '<p class="muted-line">Estimates ' + scale + (useT ? '; t tests on ' + intl(result.fit.dfResidual) + ' residual degrees of freedom, because the dispersion is estimated.' : '; z tests, because the dispersion is fixed by the family.') +
    (link.backName ? ' The last two columns carry each coefficient through the exponential: the ' + esc(link.backWord) + ' for a one-unit change in the predictor, or against the reference level.' : '') + '</p>';
  if (result.fit.family === 'ordinal') {
    const z = result.fit.zeta, zn = result.fit.zetaNames, p = result.fit.beta.length, V = result.fit.vcov;
    html += '<div class="ctrl-grp-lbl im-gap">Thresholds</div><div class="scroll-box"><table class="ptab"><thead><tr><th>Between</th><th>ζ</th><th>Std. error</th></tr></thead><tbody>' +
      zn.map((n, k) => '<tr><td>' + esc(n) + '</td><td>' + stat(z[k], 5) + '</td><td>' + stat(Math.sqrt(V[p + k][p + k]), 4) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="muted-line">P(Y ≤ k) = logit⁻¹(ζ<sub>k</sub> − x′β): a positive coefficient moves the response toward the higher levels, and exp(β) is the odds ratio of being above any threshold.</p>';
  }
  els.coef.innerHTML = html;
}

// The variance components, the correlation of a random slope with its
// intercept, and the likelihood-ratio test of the random part.
function drawRandom(ds, result) {
  const fit = result.fit;
  els.random.hidden = !fit.mixed;
  if (!fit.mixed) { els.randomBody.innerHTML = ''; return; }
  let html = '<div class="scroll-box"><table class="ptab"><thead><tr><th>Group</th><th>Effect</th><th>Variance</th><th>Std. dev.</th><th>Correlation</th><th>Levels</th></tr></thead><tbody>';
  const vcRows = [];
  fit.varcomp.forEach((v, k) => {
    const term = fit.random.terms[k];
    v.names.forEach((nm, i) => {
      const label = nm === 'slope' ? state.spec.slope : nm;
      html += '<tr><td>' + esc(v.term) + '</td><td>' + esc(label) + '</td><td>' + stat(v.variances[i], 5) + '</td><td>' + stat(Math.sqrt(v.variances[i]), 4) + '</td><td>' + (i === 1 && v.correlation != null ? stat(v.correlation, 3) : '–') + '</td><td>' + intl(term.levels.length) + '</td></tr>';
      vcRows.push([v.term, label, v.variances[i], Math.sqrt(v.variances[i]), i === 1 && v.correlation != null ? v.correlation : NaN, term.levels.length]);
    });
  });
  if (fit.family === 'normal') { html += '<tr><td>Residual</td><td>–</td><td>' + stat(fit.sigma2, 5) + '</td><td>' + stat(Math.sqrt(fit.sigma2), 4) + '</td><td>–</td><td>' + intl(fit.n) + '</td></tr>'; vcRows.push(['Residual', '', fit.sigma2, Math.sqrt(fit.sigma2), NaN, fit.n]); }
  html += '</tbody></table></div>';
  let test = null;
  try { test = randomEffectTest(ds, state.spec, result); } catch (err) { test = null; }
  if (test) {
    html += '<p class="muted-line">' + (fit.family === 'normal' ? 'The normal family\'s mixed model is fitted by ' + (fit.reml ? 'REML, which the likelihood-ratio tests refit by maximum likelihood' : 'maximum likelihood') + '. ' : 'Fitted by maximum likelihood with the Laplace approximation. ') +
      'The standard errors of the fixed effects come from the Hessian of the deviance over the variance parameters and the fixed effects together.</p>';
    els.randomBody.innerHTML = html;
    const bad = test.p >= 0.05;
    els.randomBody.appendChild(notice(bad ? 'info' : 'ok', '<b>Does the random part matter?</b> Likelihood-ratio test against the same model without random effects: χ² = ' + num(test.stat, 4) + ' on ' + intl(test.k) + (test.k === 1 ? ' variance parameter' : ' variance parameters') + ', ' + pEq(test.p) +
      ' (the null puts the variance at zero, the edge of its range, and so the p-value is ' + (test.k === 1 ? 'half of the usual chi-square tail' : 'a 50:50 mixture of chi-square tails on ' + intl(test.k - 1) + ' and ' + intl(test.k) + ' degrees of freedom') + '). ' +
      (bad ? 'The grouping explains little beyond the fixed effects; the fixed-effects model would do.' : 'The grouping explains variation the fixed effects do not.')));
    result.randomTest = test;
  } else els.randomBody.innerHTML = html;
  result.vcRows = vcRows;
}

// The checks line: the Shapiro–Wilk test on the quantile residuals and the
// dispersion test where the family fixes its dispersion. Flags, never gates.
function drawChecks(result) {
  const fit = result.fit;
  let res;
  try { res = residualSet(result); } catch (err) { return; }
  const r = Array.from(res.quantile).filter(Number.isFinite);
  const parts = [];
  let warn = false;
  if (r.length >= 3 && r.length <= 5000) {
    const sw = shapiroWilk(r);
    const bad = sw.p < 0.05;
    if (bad) warn = true;
    parts.push('<span class="' + (bad ? 'chk-bad' : 'chk-ok') + '">Shapiro–Wilk on the quantile residuals: W = ' + num(sw.W, 3) + ', ' + pEq(sw.p) + (bad ? ' <b>(the residuals depart from the normal)</b>' : '') + '</span>');
  }
  if (res.dispersion) {
    const d = res.dispersion;
    const bad = d.p < 0.05 && d.ratio > 1;
    if (bad) warn = true;
    parts.push('<span class="' + (bad ? 'chk-bad' : 'chk-ok') + '">Pearson dispersion: χ² / df = ' + num(d.ratio, 3) + ', ' + pEq(d.p) + (bad ? ' <b>(overdispersed)</b>' : '') + '</span>');
  }
  if (!parts.length) return;
  els.stats.appendChild(notice(warn ? 'warn' : 'ok', '<b>Checks.</b> ' + parts.join('; ') + '. ' + (warn ? 'See the <a href="#diagnostics">Diagnostics</a> page for where the model falls short.' : 'The <a href="#diagnostics">Diagnostics</a> page has the plots behind these.')));
}

function drawStats(result) {
  const fit = result.fit, fam = FAMILIES[fit.family];
  const cards = [card('Observations', intl(fit.n))];
  if (fit.mixed) cards.push(card(fit.reml ? 'REML criterion' : 'Deviance', stat(fit.deviance, 5), fit.family === 'normal' ? 'profiled over β and σ²' : 'Laplace approximation'), card('Groups', fit.random.terms.map(t => intl(t.levels.length) + ' ' + t.name).join(', ')));
  else if (fit.family === 'ordinal') cards.push(card('Deviance', stat(fit.deviance, 5), '−2 log-likelihood'), card('Null deviance', stat(fit.nullDeviance, 5), 'thresholds only'));
  else if (fit.family === 'beta') cards.push(card('Precision φ', stat(fit.phi, 4), 'SE ' + stat(fit.phiSe, 3)));
  else cards.push(
    card('Deviance', stat(fit.deviance, 5), 'on ' + intl(fit.dfResidual) + ' residual df'),
    card('Null deviance', stat(fit.nullDeviance, 5), 'intercept only, ' + intl(fit.n - 1) + ' df'));
  cards.push(
    card('Log-likelihood', stat(fit.logLik, 5), intl(fit.df) + ' parameters'),
    card('AIC', stat(fit.aic, 5)),
    card('BIC', stat(fit.bic, 5)));
  if (fit.mixed && fit.family === 'negbin') cards.push(card('θ', stat(fit.theta, 4), 'estimated with the other parameters'));
  else if (fit.mixed && fit.family === 'beta') cards.push(card('Precision φ', stat(fit.phi, 4)));
  else if (fit.mixed) { /* the residual variance sits in the random-effects table */ }
  else if (fit.family === 'ordinal' || fit.family === 'beta') { /* no dispersion card */ }
  else if (fam.dispersion === 'estimated') cards.push(card('Dispersion', stat(fit.dispersion, 4), 'Pearson χ² / df'));
  else if (fam.id === 'negbin') cards.push(card('θ', stat(fit.theta, 4), Number.isFinite(fit.thetaSe) ? 'SE ' + stat(fit.thetaSe, 3) : ''));
  else cards.push(card('Dispersion', '1', 'fixed by the family'));
  if (fam.id === 'binomial' || fam.id === 'poisson') {
    let s = 0;
    for (let i = 0; i < fit.n; i++) s += fit.pearson[i] * fit.pearson[i];
    cards.push(card('Pearson χ² / df', stat(s / fit.dfResidual, 4), 'near 1 when the family’s variance holds'));
  }
  cards.push(card('Iterations', intl(fit.iterations), fit.converged ? 'converged' : 'did not converge'));
  els.stats.innerHTML = '';
  els.stats.appendChild(cardRow(cards));
}

function drawTerms(ds, result) {
  let tt;
  try { tt = termTests(ds, state.spec, result); } catch (err) { els.terms.innerHTML = '<p class="muted-line">' + esc(err.message) + '</p>'; return null; }
  if (!tt.rows.length) { els.terms.innerHTML = '<p class="muted-line">The model has no term to drop.</p>'; return tt; }
  const fam = FAMILIES[result.fit.family];
  let html = '<div class="scroll-box"><table class="ptab"><thead><tr><th>Term dropped</th><th>df</th><th>' + (tt.scaled && fam.id !== 'normal' ? 'scaled deviance' : 'LR statistic') + '</th><th>p</th><th>deviance without it</th></tr></thead><tbody>';
  for (const r of tt.rows) html += '<tr><td>' + esc(r.term) + '</td><td>' + intl(r.df) + '</td><td>' + stat(r.stat, 4) + '</td><td>' + pValue(r.p) + '</td><td>' + stat(r.deviance, 5) + '</td></tr>';
  html += '</tbody></table></div>';
  html += '<p class="muted-line">Each row refits the model without that term and compares the two by a likelihood-ratio test on a chi-square with the change in parameter count as its degrees of freedom. A main effect that an interaction still uses is not dropped. ' +
    (fam.id === 'normal' ? 'For the normal family the statistic is n times the log of the deviance ratio, with σ² profiled out.' : tt.scaled ? 'The deviance change is divided by the full model’s dispersion.' : '') + '</p>';
  els.terms.innerHTML = html;
  return tt;
}

function registerResult(ds, result, tt) {
  const rows = waldRows(result);
  const link = LINKS[result.link];
  const fit = result.fit;
  const headers = ['term', 'estimate', 'std_error', rows.length && rows[0].useT ? 't' : 'z', 'p', 'ci_lower', 'ci_upper'];
  if (link.backName) headers.push('ratio', 'ratio_lower', 'ratio_upper');
  const coefRows = rows.map(r => {
    const out = [r.name, r.b, r.se, r.z, r.p, r.lo, r.hi];
    if (link.backName) out.push(r.back ? r.back.est : NaN, r.back ? r.back.lo : NaN, r.back ? r.back.hi : NaN);
    return out;
  });
  const statRows = [['observations', fit.n], ['deviance', fit.deviance], ['residual df', fit.dfResidual], ['null deviance', fit.nullDeviance], ['log-likelihood', fit.logLik], ['parameters', fit.df], ['AIC', fit.aic], ['BIC', fit.bic], ['dispersion', fit.dispersion]];
  if (fit.theta != null) statRows.push(['theta', fit.theta], ['theta SE', fit.thetaSe]);
  if (fit.mixed && result.randomTest) statRows.push(['random part LRT', result.randomTest.stat], ['random part p', result.randomTest.p]);
  const provenance = {
    dataset: ds.name,
    formula: result.formula,
    family: FAMILIES[fit.family].label,
    link: link.label,
    rows: fit.n,
    'rows dropped for missing values': result.design.dropped,
    level: lvl(state.settings.level)
  };
  if (result.event) provenance.event = result.event;
  if (fit.mixed) { provenance['random part'] = result.formula.slice(result.formula.indexOf('(')); provenance.fit = fit.reml ? 'REML' : 'maximum likelihood' + (fit.family === 'normal' ? '' : ', Laplace approximation'); }
  if (result.design.aliased.length) provenance.aliased = result.design.aliased.join(', ');
  if (result.flags.length) provenance.flags = result.flags.join(', ');
  const title = 'Model: ' + result.formula;
  const spec = lastFit.spec, level = state.settings.level;
  state.setResult(id, {
    title,
    provenance,
    regen: {
      spec, ds,
      tooBig: () => tooBig(ds, [spec]),
      build: () => capRecipe(modelRecipe({ ds, spec, result, level, title, provenance, waldRows: rows, termTests: tt, randomTest: result.randomTest || null }), ds, [spec])
    },
    tables: [
      { name: 'Coefficients', headers, rows: coefRows },
      { name: 'Fit statistics', headers: ['statistic', 'value'], rows: statRows }
    ].concat(fit.mixed && result.vcRows ? [{ name: 'Variance components', headers: ['group', 'effect', 'variance', 'std_dev', 'correlation', 'levels'], rows: result.vcRows }] : []).concat(tt && tt.rows.length ? [{ name: 'Term tests', headers: ['term', 'df', 'statistic', 'p', 'deviance_without'], rows: tt.rows.map(r => [r.term, r.df, r.stat, r.p, r.deviance]) }] : [])
  });
}

export default { id, title, render, onShow };
