// The Predict page: what the fitted model says. Effect: the predicted mean
// against one predictor with its band and the data overlaid, by the levels
// of a second one. Means: the marginal means of a categorical predictor and
// their pairwise comparisons. Calculator: a prediction at typed values.

import * as state from '../state.js';
import { column, support, valuesOf } from '../data/model.js';
import { FAMILIES, LINKS, backWord } from '../stats/families.js';
import { predictRows, marginalMeans, effectGrid, binnedMeans, waldDf } from '../stats/inference.js';
import { ordinalProbs } from '../stats/ordinal.js';
import { newDataMatrix } from '../stats/design.js';
import { termVars } from '../stats/design.js';
import { currentFit } from './model.js';
import { makeFigure, intervals, exportButtons, legend } from '../ui/plots.js';
import { curveBand, dataPoints, rawPoints, categoricalX, LEVEL_COLORS, LEVEL_DASHES } from '../ui/modelplots.js';
import { card, cardRow, notice } from '../ui/widgets.js';
import { setSectionAvailable } from '../ui/tabs.js';
import { installExportRow } from '../ui/exportrow.js';
import { predictRecipe, tooBig, capRecipe } from '../io/recipes.js';
import { esc, num, stat, pValue, intl, lvl } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'predict';
/** The page's title. */
export const title = 'Predict';
/** The page's sections. */
export const sections = [
  { id: 'effect', label: 'Effect plot', tip: 'The predicted mean against one predictor, with the data.' },
  { id: 'means', label: 'Marginal means', tip: 'The predicted mean at each level of a categorical predictor, and the pairwise differences.' },
  { id: 'calculator', label: 'Calculator', tip: 'A prediction at values you type.' }
];

let rootEl = null;
let els = {};
let figs = [];
let timer = null;
// What each section last drew, for the page's result and its scripts.
const last = { effect: null, means: null, calc: null };

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Everything here comes from the model on the Model page. The curves and means are on the response’s scale, carried through the inverse link, with bands from the Wald intervals on the link scale; the other predictors are held at their means or their first levels, which the captions say.</p>' +
    '<div id="pr-fit-note"></div>' +
    '<div data-subnav class="subnav"></div>' +
    '<div data-section="effect" class="sec">' +
      '<div class="sec-hd">Effect plot</div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="pr-x">Predictor on the x axis</label><select id="pr-x"></select></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="pr-by">Lines by</label><select id="pr-by"></select></span>' +
        '<label class="ctrl-chk"><input type="checkbox" id="pr-data" checked> show the data</label>' +
        '<label class="ctrl-chk" id="pr-groups-lbl" hidden><input type="checkbox" id="pr-groups"> show each group</label>' +
      '</div>' +
      '<div id="pr-effect"></div>' +
    '</div>' +
    '<div data-section="means" class="sec">' +
      '<div class="sec-hd">Marginal means</div>' +
      '<div class="ctrl-row"><span class="ctrl-pair"><label class="ctrl-lbl" for="pr-factor">Predictor</label><select id="pr-factor"></select></span></div>' +
      '<div id="pr-means"></div>' +
    '</div>' +
    '<div data-section="calculator" class="sec">' +
      '<div class="sec-hd">Calculator</div>' +
      '<div class="ctrl-row" id="pr-calc-inputs"></div>' +
      '<div id="pr-calc"></div>' +
    '</div>';
  els = { note: root.querySelector('#pr-fit-note'), x: root.querySelector('#pr-x'), by: root.querySelector('#pr-by'), data: root.querySelector('#pr-data'), effect: root.querySelector('#pr-effect'),
    factor: root.querySelector('#pr-factor'), means: root.querySelector('#pr-means'), calcInputs: root.querySelector('#pr-calc-inputs'), calc: root.querySelector('#pr-calc') };
  els.x.addEventListener('change', () => { state.setPick(id, 'x', els.x.value); drawEffect(); });
  els.by.addEventListener('change', () => { state.setPick(id, 'by', els.by.value || null); drawEffect(); });
  els.data.addEventListener('change', () => { state.setPick(id, 'data', els.data.checked); drawEffect(); });
  els.groups = root.querySelector('#pr-groups');
  els.groups.addEventListener('change', () => { state.setPick(id, 'groups', els.groups.checked); drawEffect(); });
  els.factor.addEventListener('change', () => { state.setPick(id, 'factor', els.factor.value); drawMeans(); });
  els.calcInputs.addEventListener('change', drawCalc);
  els.calcInputs.addEventListener('input', drawCalc);
  installExportRow(root, id);
  state.on('results', ({ pageId } = {}) => { if (pageId === 'model') schedule(); });
  state.on('settings', schedule);
  schedule();
}

/** Called each time the page is shown. */
export function onShow() { schedule(); }

function schedule() { clearTimeout(timer); timer = setTimeout(compute, 40); }

function predictorsOf(ds, result) {
  const names = [];
  for (const t of result.design.terms) for (const v of termVars(t)) if (!names.includes(v)) names.push(v);
  return names.map(n => column(ds, n).col);
}

function compute() {
  const root_ = rootEl;
  for (const f of figs) if (f.ro) f.ro.disconnect();
  figs = [];
  const cf = currentFit();
  els.note.innerHTML = '';
  if (!cf) {
    els.note.appendChild(notice('info', 'No model is fitted. Build one on the <a href="#model">Model</a> page.'));
    els.effect.innerHTML = ''; els.means.innerHTML = ''; els.calc.innerHTML = ''; els.calcInputs.innerHTML = '';
    setSectionAvailable(id, { effect: 'No model is fitted.', means: 'No model is fitted.', calculator: 'No model is fitted.' });
    state.setResult(id, null);
    return;
  }
  const { ds, result } = cf;
  const preds = predictorsOf(ds, result);
  const cats = preds.filter(c => c.type !== 'continuous');
  const off = {};
  if (!preds.length) { off.effect = 'The model has no predictor to plot against.'; off.calculator = 'The model has no predictor to set.'; }
  if (!cats.length) off.means = 'The model has no categorical predictor.';
  if (result.fit.family === 'ordinal') off.means = 'Marginal means are not formed for the ordinal model; the effect plot shows each level’s probability.';
  setSectionAvailable(id, off);
  els.note.appendChild(notice('info', 'Model: <code>' + esc(result.formula) + '</code>, ' + esc(FAMILIES[result.fit.family].label) + ' family with the ' + esc(LINKS[result.link].label) + ' link, fitted to ' + esc(ds.name) + '.'));
  const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  const wantX = state.getPick(id, 'x');
  els.x.innerHTML = preds.map((c, i) => opt(c.name, c.name, c.name === wantX || (!preds.some(p => p.name === wantX) && i === 0))).join('');
  const wantBy = state.getPick(id, 'by');
  els.by.innerHTML = opt('', 'none', !wantBy) + preds.map(c => opt(c.name, c.name, c.name === wantBy)).join('');
  els.data.checked = state.getPick(id, 'data') !== false;
  root_.querySelector('#pr-groups-lbl').hidden = !(result.fit.mixed && result.fit.random.terms[0].kind === 'group');
  els.groups.checked = state.getPick(id, 'groups') === true;
  const wantF = state.getPick(id, 'factor');
  els.factor.innerHTML = cats.map((c, i) => opt(c.name, c.name, c.name === wantF || (!cats.some(p => p.name === wantF) && i === 0))).join('');
  buildCalcInputs(ds, result, preds);
  drawEffect();
  drawMeans();
  drawCalc();
  registerTips(rootEl);
}

// The ordinal model's predictions: a probability per level.
function ordinalPredict(ds, result, rows) {
  const X = newDataMatrix(ds, result.design, rows).map(r => r.slice(1));
  const eta = X.map(x => x.reduce((s, v, j) => s + v * result.fit.beta[j], 0));
  return ordinalProbs(result.fit, eta);
}

function drawOrdinalEffect(ds, result) {
  const x = els.x.value;
  const grid = effectGrid(ds, result, x, null, 60);
  const xc = column(ds, x);
  const levels = column(ds, state.spec.response).col.levels;
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.effect.appendChild(box);
  const fig = makeFigure(box, { height: 320, xLabel: x, yLabel: 'probability', title: 'Predicted probability of each level against ' + x });
  exportButtons(box, fig, ds.name + ' ordinal effect of ' + x);
  const s = grid.series[0];
  const probs = ordinalPredict(ds, result, s.rows);
  fig.render(f => {
    const xs = xc.col.type === 'continuous' ? s.xs : null;
    if (xs) f.x([Math.min(...xs), Math.max(...xs)], { pad: 0.03, nice: true });
    f.y([0, 1]);
    const pos = xs ? null : categoricalX(f, grid.xLevels);
    if (xs) f.axes({});
    levels.forEach((l, k) => {
      const cx = xs || pos;
      const yk = probs.map(pr => pr[k]);
      curveBand(f, { x: cx, y: yk }, { band: false, color: LEVEL_COLORS[k % LEVEL_COLORS.length], dash: LEVEL_DASHES[k % LEVEL_DASHES.length], label: 'P(' + l + ')' });
      if (!xs) dataPoints(f, pos.map((p, i) => ({ x: p, y: yk[i] })), { color: LEVEL_COLORS[k % LEVEL_COLORS.length], r: 4, label: 'P(' + l + ')' });
    });
  });
  legend(box.appendChild(document.createElement('div')), levels.map((l, k) => ({ swatch: LEVEL_DASHES[k % LEVEL_DASHES.length] ? 'dash' : 'line', color: LEVEL_COLORS[k % LEVEL_COLORS.length], label: 'P(' + esc(l) + ')' })));
  const held = Object.entries(grid.held).map(([k, v]) => esc(k) + ' = ' + (typeof v === 'number' ? num(v, 4) : esc(v))).join(', ');
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = (held ? 'Other predictors held at ' + held + '. ' : '') + 'The probabilities of the levels sum to 1 at every ' + esc(x) + '.';
  els.effect.appendChild(p);
  figs.push(fig);
}

function drawEffect() {
  const cf = currentFit();
  els.effect.innerHTML = '';
  last.effect = null;
  if (!cf || !els.x.value) { registerResult(); return; }
  const { ds, result } = cf;
  if (result.fit.family === 'ordinal') { drawOrdinalEffect(ds, result); registerResult(); return; }
  const x = els.x.value, by = els.by.value && els.by.value !== x ? els.by.value : null;
  const level = state.settings.level;
  const grid = effectGrid(ds, result, x, by, 60);
  const resp = column(ds, result.design && state.spec.response).col;
  const xc = column(ds, x);
  const link = LINKS[result.link];
  const yLabel = result.event ? 'probability of ' + result.event : state.spec.response;
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.effect.appendChild(box);
  const fig = makeFigure(box, { height: 320, xLabel: x, yLabel, title: 'Predicted ' + yLabel + ' against ' + x + (by ? ' by ' + by : '') });
  exportButtons(box, fig, ds.name + ' effect of ' + x);
  const showData = els.data.checked;
  const yData = result.codedY || result.design.y;
  const keep = result.design.keep;
  const xs = keep.map(i => ds.rows[i][xc.index]);
  const byc = by ? column(ds, by) : null;
  const legendItems = [];
  const curves = grid.series.map(s => Object.assign({}, s, { pred: predictRows(ds, result, s.rows, level) }));
  fig.render(f => {
    const allY = [];
    for (const c of curves) { for (const v of c.pred.fitLo) allY.push(v); for (const v of c.pred.fitHi) allY.push(v); }
    let pts = [];
    if (showData) {
      if (xc.col.type === 'continuous') {
        if (resp && (resp.type !== 'continuous' || support(resp, valuesOf(ds, resp.name)) === 'binary')) {
          // A binary response: binned proportions per series.
          // One set of bins per level of a categorical "by"; a continuous "by" gets one set of all the data.
          const byLevels = !!(byc && byc.col.type !== 'continuous');
          pts = (byLevels ? curves : [{ by: null }]).map(c => {
            const idx = keep.map((row, k) => k).filter(k => !byLevels || ds.rows[keep[k]][byc.index] === c.by);
            return { by: c.by, bins: binnedMeans(idx.map(k => xs[k]), idx.map(k => yData[k]), 10) };
          });
          for (const p of pts) for (const b of p.bins) allY.push(b.y);
        } else {
          for (let k = 0; k < keep.length; k++) allY.push(yData[k]);
        }
      } else {
        for (let k = 0; k < keep.length; k++) allY.push(yData[k]);
      }
    }
    let lo = Math.min(...allY), hi = Math.max(...allY);
    const prob = result.fit.family === 'binomial' || result.fit.family === 'beta';
    if (xc.col.type === 'continuous') f.x([Math.min(...xs), Math.max(...xs)], { pad: 0.03, nice: true });
    // A probability stays on [0, 1]; anything else gets a little room and round ticks.
    if (prob) f.y([Math.min(0, lo), Math.max(1, hi)]); else f.y([lo, hi], { pad: 0.06, nice: true });
    let pos = null;
    if (xc.col.type !== 'continuous') pos = categoricalX(f, grid.xLevels); else f.axes({});
    if (showData) {
      if (xc.col.type === 'continuous') {
        if (pts.length) pts.forEach((p, i) => dataPoints(f, p.bins, { color: p.by != null ? LEVEL_COLORS[i % LEVEL_COLORS.length] : '--est', hollow: true, r: 4.2, label: 'binned proportion' + (p.by != null ? ', ' + p.by : '') }));
        else rawPoints(f, xs, Array.from(yData), { label: 'observation' });
      } else {
        // A categorical x: the observations jittered within each level.
        const jx = keep.map((i, k) => pos[grid.xLevels.indexOf(ds.rows[i][xc.index])] + (((k * 7919) % 100) / 100 - 0.5) * 0.3);
        rawPoints(f, jx, Array.from(yData), { label: 'observation' });
      }
    }
    // Each group's own curve: the population linear predictor shifted by its
    // predicted intercept, and slope where the model has one.
    if (els.groups.checked && result.fit.mixed && result.fit.random.terms[0].kind === 'group' && !by) {
      const re = result.fit.ranef[0], term = result.fit.random.terms[0];
      const c = curves[0];
      const cx = xc.col.type === 'continuous' ? c.xs : pos;
      const slopeIsX = term.q === 2 && state.spec.slope === x;
      re.levels.forEach((l, g) => {
        const u0 = re.modes[g][0], u1 = term.q === 2 ? re.modes[g][1] : 0;
        const yg = c.pred.eta.map((e, k) => link.linkinv(e + u0 + (term.q === 2 ? u1 * (slopeIsX ? c.xs[k] : grid.held[state.spec.slope] || 0) : 0)));
        curveBand(f, { x: cx, y: Array.from(yg) }, { band: false, color: '--pair', width: 1, label: 'group ' + l });
      });
    }
    curves.forEach((c, i) => {
      const cx = xc.col.type === 'continuous' ? c.xs : pos;
      const color = by ? LEVEL_COLORS[i % LEVEL_COLORS.length] : '--truth';
      curveBand(f, { x: cx, y: c.pred.fit, lo: c.pred.fitLo, hi: c.pred.fitHi }, { color, dash: by ? LEVEL_DASHES[i % LEVEL_DASHES.length] : null, label: c.label || 'predicted mean' });
      if (xc.col.type !== 'continuous') dataPoints(f, pos.map((p, k) => ({ x: p, y: c.pred.fit[k] })), { color, r: 4.5, label: (c.label || 'predicted mean') + ' at each level' });
    });
    legendItems.length = 0;
    curves.forEach((c, i) => legendItems.push({ swatch: by && LEVEL_DASHES[i % LEVEL_DASHES.length] ? 'dash' : 'line', color: by ? LEVEL_COLORS[i % LEVEL_COLORS.length] : '--truth', label: esc(c.label || 'predicted mean') + ' with its ' + lvl(level) + ' band' }));
    if (showData) legendItems.push(pts.length ? { swatch: 'hollow', color: '--est', label: 'observed proportion in a bin of ' + esc(x) + ' (ten bins of equal count)' } : { swatch: 'dot', color: '--est', label: 'observation' });
    if (els.groups.checked && result.fit.mixed && !by) legendItems.push({ swatch: 'thin', color: '--pair', label: 'one group’s curve, from its predicted random effect' });
  });
  legend(box.appendChild(document.createElement('div')), legendItems);
  const held = Object.entries(grid.held).map(([k, v]) => esc(k) + ' = ' + (typeof v === 'number' ? num(v, 4) : esc(v))).join(', ');
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = (held ? 'Other predictors held at ' + held + ' (a continuous one at its mean over the fitted rows, a categorical one at its first level). ' : '') +
    (result.fit.mixed ? 'The population curve is the prediction at a random effect of zero: the typical group’s' + (result.link === 'identity' ? '' : ', not the average over groups, because the inverse link is not linear') + '. ' : '') +
    (els.groups.checked && result.fit.mixed && !by ? 'Each thin line is one group’s curve: the population curve shifted by the group’s predicted random effect' + (result.fit.random.terms[0].q === 2 ? ' and slope' : '') + '. ' : '') +
    (by && byc.col.type === 'continuous' ? 'The lines take ' + esc(by) + ' at its quartiles. ' : '') +
    (result.fit.family === 'binomial' ? 'Binned proportions are the share of ' + esc(result.event || '1') + ' among the observations in each bin, at the bin’s mean ' + esc(x) + '.' : '');
  els.effect.appendChild(p);
  figs.push(fig);
  last.effect = { x, by, series: curves.map(c => ({ label: c.label, by: c.by, rows: c.rows, pred: c.pred })) };
  registerResult();
}

function drawMeans() {
  const cf = currentFit();
  els.means.innerHTML = '';
  last.means = null;
  if (!cf || !els.factor.value) { registerResult(); return; }
  const { ds, result } = cf;
  const level = state.settings.level;
  let m;
  try { m = marginalMeans(ds, result, els.factor.value, level); } catch (err) { els.means.appendChild(notice('warn', esc(err.message))); registerResult(); return; }
  const link = LINKS[result.link];
  const useT = Number.isFinite(m.df);
  const yLabel = result.event ? 'probability of ' + result.event : state.spec.response;
  let html = '<div class="scroll-box"><table class="ptab"><thead><tr><th>' + esc(m.factor) + '</th><th>mean (link scale)</th><th>std. error</th><th>' + esc(lvl(level)) + ' interval</th><th>mean (' + esc(yLabel) + ')</th><th>its interval</th></tr></thead><tbody>';
  for (const r of m.means) html += '<tr><td>' + esc(r.level) + '</td><td>' + stat(r.eta, 5) + '</td><td>' + stat(r.se, 4) + '</td><td>[' + stat(r.lo, 5) + ', ' + stat(r.hi, 5) + ']</td><td>' + stat(r.fit, 5) + '</td><td>[' + stat(r.fitLo, 5) + ', ' + stat(r.fitHi, 5) + ']</td></tr>';
  html += '</tbody></table></div>';
  html += '<div class="ctrl-grp-lbl im-gap">Pairwise differences, Tukey-adjusted</div>' +
    '<div class="scroll-box"><table class="ptab"><thead><tr><th>Pair</th><th>difference (link scale)</th><th>std. error</th><th>' + (useT ? 't' : 'z') + '</th><th>p</th><th>' + esc(lvl(level)) + ' interval</th>' + (link.backName ? '<th>' + esc(backWord(result.fit.family, link)) + '</th><th>its interval</th>' : '') + '</tr></thead><tbody>';
  for (const p of m.pairs) html += '<tr><td>' + esc(p.a + ' − ' + p.b) + '</td><td>' + stat(p.diff, 5) + '</td><td>' + stat(p.se, 4) + '</td><td>' + stat(p.t, 4) + '</td><td>' + pValue(p.p) + '</td><td>[' + stat(p.lo, 5) + ', ' + stat(p.hi, 5) + ']</td>' +
    (link.backName ? '<td>' + stat(p.ratio, 4) + '</td><td>[' + stat(p.ratioLo, 4) + ', ' + stat(p.ratioHi, 4) + ']</td>' : '') + '</tr>';
  html += '</tbody></table></div>';
  els.means.innerHTML = html;
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.means.appendChild(box);
  const fig = makeFigure(box, { height: 'auto', xLabel: yLabel, title: 'Marginal means of ' + m.factor });
  exportButtons(box, fig, ds.name + ' marginal means of ' + m.factor);
  fig.render(f => intervals(f, m.means.map(r => ({ label: r.level, center: r.fit, lo: r.fitLo, hi: r.fitHi })), { ref: null }));
  figs.push(fig);
  const held = Object.entries(m.grid.continuous).map(([k, v]) => esc(k) + ' = ' + num(v, 4)).join(', ');
  const others = Object.keys(m.grid.factors).filter(k => k !== m.factor);
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = 'Each mean is the model’s prediction at the level' + (held ? ', with ' + held + ' (the means over the fitted rows)' : '') + (others.length ? ', averaged over the levels of ' + esc(others.join(', ')) + ' with equal weights' : '') + ', on the link scale and then carried to the response scale. ' +
    'The pairwise p-values and intervals use the studentized range over ' + intl(m.k) + ' means' + (useT ? ' on ' + intl(m.df) + ' degrees of freedom' : ', with no finite degrees of freedom' + (result.fit.mixed ? ', as a mixed model’s Wald tests use the normal reference' : result.fit.family === 'binomial' || result.fit.family === 'poisson' ? ' because the dispersion is fixed by the family' : ', as the fitter’s Wald tests are large-sample tests')) + '.';
  els.means.appendChild(p);
  last.means = m;
  registerResult();
}

// The page's result: a table per section drawn, and the recipe of a script
// that redraws every one of them. An ordinal model's predictions are a
// probability per level, which the scripts do not carry, and so it has no
// script.
function registerResult() {
  const cf = currentFit();
  if (!cf) { state.setResult(id, null); return; }
  const { ds, spec, result } = cf;
  const level = state.settings.level, link = LINKS[result.link];
  const title = 'Predict: ' + result.formula;
  const provenance = { dataset: ds.name, formula: result.formula, family: FAMILIES[result.fit.family].label, link: link.label, level: lvl(level) };
  const tables = [];
  if (last.effect) {
    const e = last.effect;
    provenance['effect plot'] = e.x + (e.by ? ' by ' + e.by : '');
    const headers = [e.x].concat(e.by ? [e.by] : []).concat(['eta', 'std_error', 'fit', 'fit_lower', 'fit_upper']);
    const rows = [];
    for (const s of e.series) s.rows.forEach((row, i) => rows.push([row[e.x]].concat(e.by ? [s.by != null ? s.by : s.label] : []).concat([s.pred.eta[i], s.pred.se[i], s.pred.fit[i], s.pred.fitLo[i], s.pred.fitHi[i]])));
    tables.push({ name: 'Effect plot', headers, rows });
  }
  if (last.means) {
    const m = last.means, useT = Number.isFinite(m.df);
    provenance['marginal means of'] = m.factor;
    provenance.adjustment = 'Tukey';
    tables.push({ name: 'Marginal means', headers: [m.factor, 'mean_link', 'std_error', 'ci_lower', 'ci_upper', 'mean_response', 'response_lower', 'response_upper'], rows: m.means.map(r => [r.level, r.eta, r.se, r.lo, r.hi, r.fit, r.fitLo, r.fitHi]) },
      { name: 'Pairwise differences', headers: ['pair', 'difference', 'std_error', useT ? 't' : 'z', 'p_tukey', 'ci_lower', 'ci_upper'].concat(link.backName ? ['ratio', 'ratio_lower', 'ratio_upper'] : []),
        rows: m.pairs.map(p => [p.a + ' - ' + p.b, p.diff, p.se, p.t, p.p, p.lo, p.hi].concat(link.backName ? [p.ratio, p.ratioLo, p.ratioHi] : [])) });
  }
  if (last.calc) {
    const { row, pred } = last.calc;
    provenance.calculator = Object.entries(row).map(([k, v]) => k + ' = ' + v).join(', ');
    tables.push({ name: 'Calculator', headers: ['quantity', 'value'], rows: Object.entries(row).concat([['linear predictor', pred.eta[0]], ['std_error', pred.se[0]], ['ci_lower', pred.lo[0]], ['ci_upper', pred.hi[0]], ['prediction', pred.fit[0]], ['prediction_lower', pred.fitLo[0]], ['prediction_upper', pred.fitHi[0]]]) });
  }
  const regen = result.fit.family === 'ordinal' ? null : {
    spec, ds,
    tooBig: () => tooBig(ds, [spec]),
    build: () => capRecipe(predictRecipe({ ds, spec, result, level, title, provenance, effect: last.effect, means: last.means, calc: last.calc }), ds, [spec])
  };
  state.setResult(id, { title, provenance, tables, regen });
}

function buildCalcInputs(ds, result, preds) {
  const grid = {};
  for (const t of result.design.terms) for (const v of termVars(t)) grid[v] = true;
  const saved = state.getPick(id, 'calc') || {};
  els.calcInputs.innerHTML = preds.map(c => {
    const held = saved[c.name];
    if (c.type === 'continuous') {
      let s = 0;
      for (const i of result.design.keep) s += ds.rows[i][column(ds, c.name).index];
      const mean = s / result.design.keep.length;
      return '<span class="ctrl-pair"><label class="ctrl-lbl" for="pr-in-' + esc(c.name) + '">' + esc(c.name) + '</label><input type="text" class="par-inp" id="pr-in-' + esc(c.name) + '" data-name="' + esc(c.name) + '" value="' + esc(typeof held === 'number' ? String(held) : String(Number(mean.toPrecision(5)))) + '" inputmode="decimal"></span>';
    }
    return '<span class="ctrl-pair"><label class="ctrl-lbl" for="pr-in-' + esc(c.name) + '">' + esc(c.name) + '</label><select id="pr-in-' + esc(c.name) + '" data-name="' + esc(c.name) + '">' + c.levels.map(l => '<option value="' + esc(l) + '"' + (l === held ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></span>';
  }).join('');
}

function drawCalc() {
  const cf = currentFit();
  els.calc.innerHTML = '';
  last.calc = null;
  if (!cf) return;
  const { ds, result } = cf;
  const row = {};
  const saved = {};
  for (const inp of els.calcInputs.querySelectorAll('[data-name]')) {
    const name = inp.getAttribute('data-name');
    const c = column(ds, name).col;
    if (c.type === 'continuous') { const v = Number(inp.value); if (!Number.isFinite(v)) { els.calc.appendChild(notice('warn', 'Type a number for ' + esc(name) + '.')); registerResult(); return; } row[name] = v; saved[name] = v; }
    else { row[name] = inp.value; saved[name] = inp.value; }
  }
  state.setPick(id, 'calc', saved);
  if (!Object.keys(row).length && result.design.terms.length) { registerResult(); return; }
  const level = state.settings.level;
  if (result.fit.family === 'ordinal') {
    const pr = ordinalPredict(ds, result, [row])[0];
    const levels = column(ds, state.spec.response).col.levels;
    els.calc.appendChild(cardRow(levels.map((l, k) => card('P(' + esc(l) + ')', stat(pr[k], 4)))));
    registerResult();
    return;
  }
  const p = predictRows(ds, result, [row], level);
  const link = LINKS[result.link];
  const yLabel = result.event ? 'probability of ' + result.event : state.spec.response;
  els.calc.appendChild(cardRow([
    card('Linear predictor', stat(p.eta[0], 5), 'on the ' + esc(link.label) + ' scale, SE ' + stat(p.se[0], 4)),
    card(esc(lvl(level)) + ' interval, link scale', '[' + stat(p.lo[0], 5) + ', ' + stat(p.hi[0], 5) + ']'),
    card('Predicted ' + esc(yLabel), stat(p.fit[0], 5)),
    card('Its interval', '[' + stat(p.fitLo[0], 5) + ', ' + stat(p.fitHi[0], 5) + ']', 'the link-scale interval carried through the inverse link')
  ]));
  last.calc = { row, pred: p };
  registerResult();
}

export default { id, title, render, onShow, sections };
