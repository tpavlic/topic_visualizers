// The Variance explained page: the fit on the Model page split into the
// pieces of its variance on the link scale, as one stacked bar and a table:
// the fixed-effect linear predictor, each random term, an observation-level
// effect as dispersion, and the distribution-specific residual, with the
// marginal and conditional R² and the ICC that follow, and each term's
// share as the fixed-effect variance lost when it is dropped.

import * as state from '../state.js';
import { FAMILIES, LINKS } from '../stats/families.js';
import { varianceParts } from '../stats/variance.js';
import { degenerateFit } from '../stats/inference.js';
import { currentFit } from './model.js';
import { makeFigure, exportButtons, svgEl, tok, legend } from '../ui/plots.js';
import { card, cardRow, notice } from '../ui/widgets.js';
import { installExportRow } from '../ui/exportrow.js';
import { varianceRecipe, tooBig, capRecipe, VARIANCE_CAPABILITY } from '../io/recipes.js';
import { esc, num, stat, intl } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'variance';
/** The page's title. */
export const title = 'Variance explained';

let rootEl = null;
let els = {};
let figs = [];
let timer = null;

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">This page shows how much of the response’s variation the model on the Model page accounts for and where the rest sits. On the link scale, the variance splits into the part the fixed effects predict, the part each random term carries, and a residual part that the family’s own spread sets. The pieces add, and so one bar shows them. Marginal R² is the fixed effects’ share, conditional R² adds the random terms, and the ICC is the random terms’ share of what the fixed effects leave. The definitions are those in the References.</p>' +
    '<div id="va-note"></div>' +
    '<div class="sec"><div class="sec-hd">The pieces of the variance</div><div id="va-bar"></div><div id="va-cards"></div><div id="va-table"></div></div>' +
    '<div class="sec"><div class="sec-hd">By term</div><div id="va-terms"></div></div>' +
    '<div class="sec"><div class="sec-hd">Reading the bar</div><div id="va-text"></div></div>';
  els = { note: root.querySelector('#va-note'), bar: root.querySelector('#va-bar'), cards: root.querySelector('#va-cards'), table: root.querySelector('#va-table'), terms: root.querySelector('#va-terms'), text: root.querySelector('#va-text') };
  installExportRow(root, id);
  state.on('results', ({ pageId } = {}) => { if (pageId === 'model') schedule(); });
  state.on('settings', schedule);
  schedule();
}

/** Called each time the page is shown. */
export function onShow() { schedule(); }

function schedule() { clearTimeout(timer); timer = setTimeout(compute, 40); }

const SHARE = v => (100 * v).toFixed(1) + '%';
// A variance that is rounding noise beside the scale it is read against shows as 0.
const tidy = (x, scale) => (Math.abs(x) < 1e-10 * Math.max(1, Math.abs(scale)) ? 0 : x);

// What the residual piece is, by family.
function residualWord(fit) {
  const link = LINKS[fit.link].label;
  switch (fit.family) {
    case 'normal': return 'the error variance σ²';
    case 'binomial': return fit.link === 'logit' ? 'π²/3, the variance of the logistic distribution, which stands for a 0/1 response’s spread on the logit scale' : fit.link === 'probit' ? '1, the variance of the standard normal, which stands for a 0/1 response’s spread on the probit scale' : 'π²/6, which stands for a 0/1 response’s spread on the ' + link + ' scale';
    case 'poisson': return 'log(1 + 1/λ), a Poisson count’s spread on the log scale at the mean λ the intercept-only model implies';
    case 'negbin': return 'log(1 + 1/λ + 1/θ), a negative binomial count’s spread on the log scale at the mean λ the intercept-only model implies';
    case 'gamma': return 'log(1 + φ), a gamma response’s spread on the log scale at its dispersion φ';
    case 'beta': return 'log(1 + (1 − μ)/(μ(1 + φ))), a beta response’s spread on the logit scale at the mean μ the intercept-only model implies';
    default: return 'the residual variance';
  }
}

function compute() {
  for (const f of figs) if (f.ro) f.ro.disconnect();
  figs = [];
  const cf = currentFit();
  for (const k of ['note', 'bar', 'cards', 'table', 'terms', 'text']) els[k].innerHTML = '';
  if (!cf) {
    els.note.appendChild(notice('info', 'No model is fitted. Build one on the <a href="#model">Model</a> page.'));
    state.setResult(id, null);
    return;
  }
  const { ds, result, spec } = cf;
  const fit = result.fit;
  const fam = FAMILIES[fit.family];
  const why = degenerateFit(result);
  if (why) {
    els.note.appendChild(notice('warn', esc(why)));
    state.setResult(id, null);
    return;
  }
  let v;
  try { v = varianceParts(ds, spec, result); } catch (err) { els.note.appendChild(notice('warn', 'The decomposition could not be computed: ' + esc(err.message))); state.setResult(id, null); return; }
  if (!v.ok) {
    els.note.appendChild(notice('info', esc(v.why)));
    state.setResult(id, null);
    return;
  }
  els.note.appendChild(notice('info', 'Model: <code>' + esc(result.formula) + '</code>, ' + esc(fam.label) + ' family with the ' + esc(LINKS[result.link].label) + ' link, fitted to ' + esc(ds.name) + ' (' + intl(fit.n) + ' rows).'));

  // The pieces, in the order the bar stacks them.
  const pieces = [{ key: 'fixed', label: 'Fixed effects', value: v.fixed, color: tok('--est') }];
  const randomColors = ['--ok', '--accent', '--truth'];
  v.random.forEach((t, i) => pieces.push({ key: 'random', label: (t.kind === 'nested' ? 'Nested random intercept: ' : t.slope ? 'Random intercept and slope: ' : 'Random intercept: ') + t.term, value: t.variance, color: tok(randomColors[i % randomColors.length]) }));
  if (v.dispersion > 0) pieces.push({ key: 'dispersion', label: 'Observation-level effect', value: v.dispersion, color: tok('--truth') });
  pieces.push({ key: 'distribution', label: 'Residual', value: v.distribution, color: tok('--muted') });
  const total = v.total;

  // The bar.
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.bar.appendChild(box);
  const fig = makeFigure(box, { height: 150, xLabel: 'Share of the total variance', title: 'Variance on the ' + LINKS[result.link].label + ' scale', margin: { l: 16, r: 16, t: 30, b: 44 } });
  exportButtons(box, fig, ds.name + ' variance explained');
  figs.push(fig);
  fig.render(f => {
    const sx = f.x([0, 1]);
    f.axes({ y: false });
    const y0 = f.ih * 0.22, y1 = f.ih * 0.78;
    let left = 0;
    const rec = { kind: 'rects', x0: [], x1: [], y0: [], y1: [], color: pieces.map(p => p.color), label: pieces.map(p => p.label) };
    const txt = { kind: 'text', x: [], y: [], text: [], color: tok('--card'), anchor: 'middle' };
    pieces.forEach(p => {
      const share = total > 0 ? p.value / total : 0;
      const a = sx(left), b = sx(left + share);
      svgEl('rect', { x: a, y: y0, width: Math.max(0, b - a), height: y1 - y0, fill: p.color, stroke: tok('--card'), 'stroke-width': 1 }, f.inner);
      rec.x0.push(left); rec.x1.push(left + share); rec.y0.push(0.22); rec.y1.push(0.78);
      if (b - a > 34) {
        svgEl('text', { x: (a + b) / 2, y: (y0 + y1) / 2 + 4, 'text-anchor': 'middle', 'font-size': 11.5, fill: tok('--card') }, f.inner).textContent = SHARE(share);
        txt.x.push(left + share / 2); txt.y.push(0.5); txt.text.push(SHARE(share));
      }
      left += share;
    });
    f.series.push(rec);
    if (txt.x.length) f.series.push(txt);
    f.readout((dx) => {
      let acc = 0;
      for (const p of pieces) { const share = total > 0 ? p.value / total : 0; if (dx >= acc && dx <= acc + share) return [p.label, stat(p.value, 4) + '  (' + SHARE(share) + ')']; acc += share; }
      return null;
    });
  });
  const lg = document.createElement('div');
  box.appendChild(lg);
  legend(lg, pieces.map(p => ({ label: p.label, color: p.color, swatch: 'bar' })));

  // The cards.
  const cards = [card('Marginal R²', SHARE(v.r2m), 'the fixed effects’ share')];
  if (v.random.length) {
    cards.push(card('Conditional R²', SHARE(v.r2c), 'the fixed effects and the random terms together'));
    cards.push(card('ICC', SHARE(v.icc), 'the random terms’ share of what the fixed effects leave'));
  } else if (v.dispersion > 0) {
    cards.push(card('Conditional R²', SHARE(v.r2c), 'the same here: the observation-level effect counts as residual'));
  }
  els.cards.appendChild(cardRow(cards));

  // The table of pieces.
  const rows = pieces.map(p => [p.label, p.value, p.value / total]);
  rows.push(['Total', total, 1]);
  els.table.innerHTML = '<div class="scroll-box"><table class="ptab"><thead><tr><th>Piece</th><th>Variance</th><th>Share</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + stat(r[1], 5) + '</td><td>' + SHARE(r[2]) + '</td></tr>').join('') + '</tbody></table></div>';

  // The terms.
  if (v.terms.length) {
    els.terms.innerHTML = '<p class="exp-note">Each term’s share is the fixed-effect variance the model loses when it is refitted without that term, over the total variance of the full model: the part of the marginal R² that term alone accounts for after the others. A term inside an interaction is not dropped on its own. The shares need not add up to the marginal R² because predictors that move together share their variance.</p>' +
      '<div class="scroll-box"><table class="ptab"><thead><tr><th>Term</th><th>Fixed-effect variance without it</th><th>Share lost</th></tr></thead><tbody>' +
      v.terms.map(t => '<tr><td>' + esc(t.term) + '</td><td>' + stat(tidy(t.fixed, v.fixed), 5) + '</td><td>' + SHARE(t.delta) + '</td></tr>').join('') + '</tbody></table></div>';
  } else {
    els.terms.innerHTML = '<p class="muted-line">The model has no fixed term to drop.</p>';
  }

  // The text.
  const parts = [];
  parts.push('The bar is the variance of the response on the ' + esc(LINKS[result.link].label) + ' scale, split into the pieces that add to it. The fixed effects’ piece is the variance of the linear predictor Xβ across the rows: how much the predictors move the response. ');
  if (v.random.length) parts.push('A random term’s piece is its variance' + (v.random.some(t => t.slope) ? ', averaged over the rows where a slope varies by group' : '') + ': how much the groups differ beyond what the predictors say. ');
  if (v.dispersion > 0) parts.push('The observation-level effect’s piece is its variance, which counts as residual: it is extra spread per row, not structure. ');
  parts.push('The residual piece is ' + residualWord(fit) + '. ');
  parts.push('Marginal R² = ' + SHARE(v.r2m) + ' is the fixed effects’ share of the whole' + (v.random.length ? '; conditional R² = ' + SHARE(v.r2c) + ' adds the random terms, which is how much the model predicts once the group is known; and the ICC = ' + SHARE(v.icc) + ' is the random terms’ share of the bar with the fixed effects taken out, the correlation between two rows of one group that the predictors do not explain' : '') + '. ');
  if (fit.family !== 'normal') parts.push('For a non-normal family, the residual piece is an approximation on the link scale, and the shares are best read against each other rather than as a fraction of a variance the data show directly. ');
  if (fit.family === 'normal' && !fit.mixed) parts.push('With a normal model and no random part, the marginal R² is the ordinary R² up to the degrees of freedom in the residual variance, which is estimated on n − p rather than n.');
  els.text.innerHTML = '<p class="exp-note">' + parts.join('') + '</p>';

  const provenance = { dataset: ds.name, formula: result.formula, family: fam.label, link: LINKS[result.link].label };
  const tables = [
    { name: 'Variance pieces', headers: ['piece', 'variance', 'share'], rows: rows.map(r => [r[0], r[1], r[2]]) },
    { name: 'R-squared', headers: ['statistic', 'value'], rows: [['marginal R2', v.r2m], ['conditional R2', v.r2c], ['ICC', v.icc == null ? NaN : v.icc]] }
  ];
  if (v.terms.length) tables.push({ name: 'Terms', headers: ['term', 'fixed variance without it', 'share lost'], rows: v.terms.map(t => [t.term, t.fixed, t.delta]) });
  const title_ = 'Variance explained: ' + result.formula;
  const level = state.settings.level;
  state.setResult(id, { title: title_, provenance, tables, regen: {
    spec, ds, capability: VARIANCE_CAPABILITY,
    tooBig: () => tooBig(ds, [spec]),
    build: () => capRecipe(varianceRecipe({ ds, spec, result, level, title: title_, provenance, parts: v }), ds, [spec])
  } });
  registerTips(rootEl);
}

export default { id, title, render, onShow };
