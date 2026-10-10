// The Diagnostics page: what the residuals say about the model on the Model
// page. Residuals: the randomized quantile residuals' normal quantile plot
// with the Shapiro–Wilk test, the residuals against the fitted values and
// against each predictor, and the scale–location plot. Dispersion: the
// Pearson dispersion and its test, and Cook's distances. Random effects:
// the group effects' quantile plot and caterpillar plot (with a mixed fit).

import * as state from '../state.js';
import { column } from '../data/model.js';
import { FAMILIES, LINKS } from '../stats/families.js';
import { residualSet, RESIDUAL_SEED } from '../stats/residuals.js';
import { shapiroWilk, normalQQ } from '../stats/normality.js';
import { binnedMeans } from '../stats/inference.js';
import { termVars } from '../stats/design.js';
import { currentFit } from './model.js';
import { makeFigure, qqPlot, exportButtons, legend, intervals } from '../ui/plots.js';
import { curveBand, dataPoints, rawPoints, categoricalX } from '../ui/modelplots.js';
import { card, cardRow, notice, details } from '../ui/widgets.js';
import { setSectionAvailable } from '../ui/tabs.js';
import { installExportRow } from '../ui/exportrow.js';
import { diagnosticsRecipe, tooBig, capRecipe } from '../io/recipes.js';
import { esc, num, stat, pValue, pEq, intl } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'diagnostics';
/** The page's title. */
export const title = 'Diagnostics';
/** The page's sections. */
export const sections = [
  { id: 'residuals', label: 'Residuals', tip: 'The quantile residuals against the normal and against the fitted values and the predictors.' },
  { id: 'dispersion', label: 'Dispersion and influence', tip: 'Whether the family’s variance holds, and which rows pull the fit.' },
  { id: 'random', label: 'Random effects', tip: 'The predicted group effects, with a mixed model.' }
];

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
    '<p class="lede">The residuals here are randomized quantile residuals: each observation’s position in its own fitted distribution, carried to the normal scale, so that a well-fitting model of any family leaves residuals that look standard normal and show no pattern against anything. A discrete family’s residuals are randomized within each count’s probability, from a fixed seed, and so they are the same on every visit and in the exported scripts.</p>' +
    '<div id="dg-fit-note"></div>' +
    '<div data-subnav class="subnav"></div>' +
    '<div data-section="residuals">' +
      '<div class="sec"><div class="sec-hd">Normality of the quantile residuals</div><div id="dg-qq"></div></div>' +
      '<div class="sec"><div class="sec-hd">Residuals against the fitted values</div><div id="dg-fitted"></div></div>' +
      '<div class="sec"><div class="sec-hd">Residuals against each predictor</div><div id="dg-preds"></div></div>' +
    '</div>' +
    '<div data-section="dispersion">' +
      '<div class="sec"><div class="sec-hd">Dispersion</div><div id="dg-disp"></div></div>' +
      '<div class="sec"><div class="sec-hd">Influence</div><div id="dg-cooks"></div></div>' +
    '</div>' +
    '<div data-section="random">' +
      '<div class="sec"><div class="sec-hd">Random effects</div><div id="dg-random"></div></div>' +
    '</div>';
  els = { note: root.querySelector('#dg-fit-note'), qq: root.querySelector('#dg-qq'), fitted: root.querySelector('#dg-fitted'), preds: root.querySelector('#dg-preds'),
    disp: root.querySelector('#dg-disp'), cooks: root.querySelector('#dg-cooks'), random: root.querySelector('#dg-random') };
  installExportRow(root, id);
  state.on('results', ({ pageId } = {}) => { if (pageId === 'model') schedule(); });
  state.on('settings', schedule);
  schedule();
}

/** Called each time the page is shown. */
export function onShow() { schedule(); }

function schedule() { clearTimeout(timer); timer = setTimeout(compute, 40); }

function figBox(parent, opts, name) {
  const box = document.createElement('div');
  box.className = 'fig-box';
  parent.appendChild(box);
  const fig = makeFigure(box, opts);
  exportButtons(box, fig, name);
  figs.push(fig);
  return { box, fig };
}

function compute() {
  for (const f of figs) if (f.ro) f.ro.disconnect();
  figs = [];
  const cf = currentFit();
  els.note.innerHTML = '';
  for (const k of ['qq', 'fitted', 'preds', 'disp', 'cooks', 'random']) els[k].innerHTML = '';
  if (!cf) {
    els.note.appendChild(notice('info', 'No model is fitted. Build one on the <a href="#model">Model</a> page.'));
    setSectionAvailable(id, { residuals: 'No model is fitted.', dispersion: 'No model is fitted.', random: 'No model is fitted.' });
    state.setResult(id, null);
    return;
  }
  const { ds, result } = cf;
  const fit = result.fit;
  const fam = FAMILIES[fit.family];
  const res = residualSet(result);
  const off = {};
  if (!fit.mixed) off.random = 'The model has no random effect.';
  setSectionAvailable(id, off);
  els.note.appendChild(notice('info', 'Model: <code>' + esc(result.formula) + '</code>, ' + esc(fam.label) + ' family with the ' + esc(LINKS[result.link].label) + ' link, fitted to ' + esc(ds.name) + ' (' + intl(fit.n) + ' rows).'));
  const tables = [];
  const provenance = { dataset: ds.name, formula: result.formula, family: fam.label, link: LINKS[result.link].label, 'residual seed': RESIDUAL_SEED };

  // Normality.
  const r = Array.from(res.quantile).filter(Number.isFinite);
  const sw = r.length >= 3 && r.length <= 5000 ? shapiroWilk(r) : null;
  const cards = [];
  if (sw) cards.push(card('Shapiro–Wilk W', stat(sw.W, 4), pEq(sw.p)));
  else cards.push(card('Shapiro–Wilk', '–', r.length > 5000 ? 'n is beyond the test' : 'too few residuals'));
  let m = 0, s2 = 0;
  for (const v of r) m += v;
  m /= r.length;
  for (const v of r) s2 += (v - m) * (v - m);
  s2 /= Math.max(1, r.length - 1);
  cards.push(card('Mean of residuals', stat(m, 3), 'near 0 when the model fits'), card('SD of residuals', stat(Math.sqrt(s2), 3), 'near 1 when the family’s variance holds'));
  els.qq.appendChild(cardRow(cards));
  if (sw) els.qq.appendChild(notice(sw.p < 0.05 ? 'warn' : 'ok', sw.p < 0.05
    ? 'The quantile residuals depart from the normal (' + pEq(sw.p) + '): the family or the link does not describe the response’s distribution well, or a predictor enters in a different shape. The plots below say where.'
    : 'The quantile residuals are consistent with a standard normal (' + pEq(sw.p) + '), as a well-fitting model leaves them.'));
  const q = normalQQ(r);
  const qf = figBox(els.qq, { height: 300, xLabel: 'Standard normal quantiles', yLabel: 'Quantile residuals', title: 'Normal quantile plot of the quantile residuals' }, ds.name + ' residual qq');
  qf.fig.render(f => qqPlot(f, q));
  tables.push({ name: 'Residual summary', headers: ['statistic', 'value'], rows: [['Shapiro-Wilk W', sw ? sw.W : NaN], ['Shapiro-Wilk p', sw ? sw.p : NaN], ['mean', m], ['sd', Math.sqrt(s2)]] });

  // Against the fitted values, and the scale–location plot.
  const fitted = Array.from(res.fitted);
  const ff = figBox(els.fitted, { height: 280, xLabel: 'Fitted value' + (fit.family === 'ordinal' ? ' (expected category index)' : ''), yLabel: 'Quantile residual', title: 'Residuals against fitted values' }, ds.name + ' residuals vs fitted');
  ff.fig.render(f => {
    rawPoints(f, fitted, Array.from(res.quantile), { label: 'residual' });
    const b = binnedMeans(fitted, res.quantile, 10);
    if (b.length > 1) curveBand(f, { x: b.map(p => p.x), y: b.map(p => p.y) }, { band: false, label: 'binned mean', width: 2 });
    dataPoints(f, b, { color: '--truth', hollow: true, r: 4, label: 'binned mean' });
  });
  legend(ff.box.appendChild(document.createElement('div')), [{ swatch: 'dot', color: '--est', label: 'residual' }, { swatch: 'hollow', color: '--truth', label: 'mean residual in a bin of fitted values' }]);
  const sl = figBox(els.fitted, { height: 240, xLabel: 'Fitted value', yLabel: '√|quantile residual|', title: 'Scale–location' }, ds.name + ' scale location');
  const sq = Array.from(res.quantile, v => Math.sqrt(Math.abs(v)));
  sl.fig.render(f => {
    rawPoints(f, fitted, sq, { label: 'root absolute residual' });
    const b = binnedMeans(fitted, sq, 10);
    if (b.length > 1) curveBand(f, { x: b.map(p => p.x), y: b.map(p => p.y) }, { band: false, label: 'binned mean', width: 2 });
  });
  const pf = document.createElement('p');
  pf.className = 'muted-line';
  pf.textContent = 'A trend in the binned means against the fitted values says the link or a predictor’s shape is wrong; a trend in the scale–location plot says the spread changes with the mean in a way the family does not allow.';
  els.fitted.appendChild(pf);

  // Against each predictor.
  const names = [];
  for (const t of result.design.terms) for (const v of termVars(t)) if (!names.includes(v)) names.push(v);
  if (!names.length) els.preds.innerHTML = '<p class="muted-line">The model has no predictor.</p>';
  for (const name of names) {
    const c = column(ds, name);
    const xs = result.design.keep.map(i => ds.rows[i][c.index]);
    const pf2 = figBox(els.preds, { height: 240, xLabel: name, yLabel: 'Quantile residual', title: 'Residuals against ' + name }, ds.name + ' residuals vs ' + name);
    pf2.fig.render(f => {
      if (c.col.type === 'continuous') {
        rawPoints(f, xs, Array.from(res.quantile), { label: 'residual' });
        const b = binnedMeans(xs, res.quantile, 10);
        if (b.length > 1) curveBand(f, { x: b.map(p => p.x), y: b.map(p => p.y) }, { band: false, label: 'binned mean', width: 2 });
      } else {
        const lv = c.col.levels;
        f.y([Math.min(...res.quantile), Math.max(...res.quantile)], { pad: 0.06, nice: true });
        const pos = categoricalX(f, lv);
        const jx = xs.map((v, k) => pos[lv.indexOf(v)] + (((k * 7919) % 100) / 100 - 0.5) * 0.4);
        rawPoints(f, jx, Array.from(res.quantile), { label: 'residual' });
        const means = lv.map((l, k) => { const v = res.quantile.filter((_, i) => xs[i] === l); return { x: pos[k], y: v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN, n: v.length }; });
        dataPoints(f, means, { color: '--truth', hollow: true, r: 4.5, label: 'mean residual per level' });
      }
    });
  }

  // Dispersion.
  const dcards = [];
  if (res.dispersion) {
    const d = res.dispersion;
    dcards.push(card('Pearson χ²', stat(d.chisq, 5), 'on ' + intl(d.df) + ' df'), card('χ² / df', stat(d.ratio, 4), 'near 1 when the family’s variance holds'), card('p (overdispersion)', pValue(d.p), 'upper tail of the χ²'));
    els.disp.appendChild(cardRow(dcards));
    els.disp.appendChild(notice(d.ratio > 1.5 && d.p < 0.05 ? 'warn' : d.p < 0.05 && d.ratio < 1 ? 'info' : 'ok',
      d.ratio > 1.5 && d.p < 0.05
        ? 'The residual variance is ' + num(d.ratio, 3) + ' times what the ' + esc(fam.label) + ' family allows (' + pEq(d.p) + '): the data are overdispersed, the standard errors above are too small, and ' +
          (fit.family === 'poisson' ? 'the negative binomial family, or a Poisson-lognormal with an observation-level random effect, allows for the extra spread.' : 'a missing predictor or grouping factor is the usual cause.')
        : d.p < 0.05 && d.ratio < 1 ? 'The residual variance is below what the family allows (χ² / df = ' + num(d.ratio, 3) + '): underdispersion, which is rare and usually means the responses are not independent.'
          : 'The residual variance is consistent with the ' + esc(fam.label) + ' family (χ² / df = ' + num(d.ratio, 3) + ', ' + pEq(d.p) + ').'));
    tables.push({ name: 'Dispersion', headers: ['statistic', 'value'], rows: [['Pearson chi-square', d.chisq], ['df', d.df], ['ratio', d.ratio], ['p', d.p]] });
  } else if (fam.dispersion === 'estimated') {
    els.disp.appendChild(cardRow([card('Dispersion', stat(fit.dispersion, 4), 'estimated by the Pearson χ² / df and used in every standard error')]));
    els.disp.appendChild(notice('info', 'The ' + esc(fam.label) + ' family estimates its dispersion rather than fixing it, and so there is no overdispersion test; the scale–location plot above says whether the spread changes with the mean.'));
  } else if (fit.family === 'negbin') {
    els.disp.appendChild(cardRow([card('θ', stat(fit.theta, 4), 'SE ' + stat(fit.thetaSe, 3)), card('Variance at the mean μ', 'μ + μ² / θ')]));
    els.disp.appendChild(notice('info', 'The negative binomial family measures the extra spread by θ: the smaller θ, the more the variance exceeds the mean. A very large θ says the Poisson would have done.'));
  } else if (fit.family === 'beta') {
    els.disp.appendChild(cardRow([card('Precision φ', stat(fit.phi, 4), 'SE ' + stat(fit.phiSe, 3)), card('Variance at the mean μ', 'μ(1 − μ) / (1 + φ)')]));
  } else els.disp.innerHTML = '<p class="muted-line">The ordinal model has no dispersion to check.</p>';

  // Influence.
  if (res.cooks) {
    const cooks = Array.from(res.cooks);
    const idx = cooks.map((_, i) => i).sort((a, b) => cooks[b] - cooks[a]).slice(0, 5);
    const cf2 = figBox(els.cooks, { height: 240, xLabel: 'Row (in fitting order)', yLabel: 'Cook’s distance', title: 'Cook’s distances' }, ds.name + ' cooks distances');
    cf2.fig.render(f => {
      f.x([0, cooks.length + 1]);
      f.y([0, Math.max(...cooks) * 1.05 || 1], { nice: true });
      f.axes({});
      rawPoints(f, cooks.map((_, i) => i + 1), cooks, { label: 'Cook’s distance' });
    });
    const p = document.createElement('p');
    p.className = 'muted-line';
    const thr = 4 / fit.n;
    p.innerHTML = 'The five largest: ' + idx.map(i => 'row ' + intl(result.design.keep[i] + 1) + ' (' + num(cooks[i], 3) + ')').join(', ') + '. A distance above 4/n = ' + num(thr, 3) + ' marks a row the fit leans on; above 1 is a row that moves the coefficients by about their standard error.';
    els.cooks.appendChild(p);
    tables.push({ name: 'Largest Cook distances', headers: ['row', 'cooks_distance'], rows: idx.map(i => [result.design.keep[i] + 1, cooks[i]]) });
  } else els.cooks.innerHTML = '<p class="muted-line">Cook’s distances are given for the families fitted by iteratively reweighted least squares; this fit has none.</p>';

  // Random effects, with a mixed fit.
  if (fit.mixed) drawRandom(ds, result);

  const title = 'Diagnostics: ' + result.formula;
  const spec = cf.spec, level = state.settings.level;
  const summary = { mean: m, sd: Math.sqrt(s2), sw };
  state.setResult(id, { title, provenance, tables, regen: {
    spec, ds, uniforms: res.uniforms || null,
    tooBig: () => tooBig(ds, [spec]),
    build: () => capRecipe(diagnosticsRecipe({ ds, spec, result, level, title, provenance, residuals: res, summary }), ds, [spec])
  } });
  registerTips(rootEl);
}

function drawRandom(ds, result) {
  const fit = result.fit;
  if (!fit.ranef) return;
  const p0 = document.createElement('p');
  p0.className = 'exp-note';
  p0.textContent = 'The predicted group effects are the conditional modes, each with a 95% interval from its conditional variance. A quantile plot of them against the normal checks the random effect’s own assumption; the caterpillar plot sorts the groups by their effect.';
  els.random.appendChild(p0);
  fit.ranef.forEach((block, k) => {
    const term = fit.random.terms[k];
    if (term.kind === 'olre') return;
    for (let j = 0; j < block.q; j++) {
      const label = (j === 0 ? 'intercept' : 'slope on ' + state.spec.slope) + ' by ' + block.term;
      const u = block.modes.map(m => m[j]);
      const q = normalQQ(u);
      const qf = figBox(els.random, { height: 260, xLabel: 'Standard normal quantiles', yLabel: 'Random ' + label, title: 'Normal quantile plot of the random ' + label }, ds.name + ' ranef qq ' + label);
      qf.fig.render(f => qqPlot(f, q));
      const items = block.levels.map((l, i) => ({ label: l, center: block.modes[i][j], lo: block.modes[i][j] - 1.96 * Math.sqrt(block.condvar[i][j]), hi: block.modes[i][j] + 1.96 * Math.sqrt(block.condvar[i][j]) })).sort((a, b) => a.center - b.center);
      const shown = items.length > 60 ? items.filter((_, i) => i < 30 || i >= items.length - 30) : items;
      const cf = figBox(els.random, { height: 'auto', xLabel: 'Random ' + label, title: 'Predicted random ' + label + ', with 95% conditional intervals' }, ds.name + ' caterpillar ' + label);
      cf.fig.render(f => intervals(f, shown, { ref: 0, rowPx: 22 }));
      if (items.length > 60) { const p = document.createElement('p'); p.className = 'muted-line'; p.textContent = 'The thirty smallest and thirty largest of ' + intl(items.length) + ' groups are shown.'; els.random.appendChild(p); }
    }
  });
}

export default { id, title, render, onShow, sections };
