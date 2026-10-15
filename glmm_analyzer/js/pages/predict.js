// The Predict page: what the fitted model says. Effect: the predicted mean
// against one predictor with its band and the data overlaid, by the levels
// of a second one. Means: the marginal means of a categorical predictor and
// their pairwise comparisons. Calculator: a prediction at typed values.

import * as state from '../state.js';
import { column, support, valuesOf } from '../data/model.js';
import { FAMILIES, LINKS, backWord } from '../stats/families.js';
import { predictRows, marginalMeans, effectGrid, referenceGrid, binnedMeans, waldDf, degenerateFit, ordinalPredictRows } from '../stats/inference.js';
import { termVars } from '../stats/design.js';
import { currentFit } from './model.js';
import { makeFigure, intervals, exportButtons, legend } from '../ui/plots.js';
import { curveBand, dataPoints, rawPoints, categoricalX, levelBars, LEVEL_COLORS, LEVEL_DASHES } from '../ui/modelplots.js';
import { card, cardRow, notice, term, WALD_TIP } from '../ui/widgets.js';
import { setSectionAvailable } from '../ui/tabs.js';
import { installExportRow } from '../ui/exportrow.js';
import { predictRecipe, tooBig, capRecipe } from '../io/recipes.js';
import { esc, num, stat, pValue, intl, lvl } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

// How an average over a factor's levels weights them: equally, or by each
// combination's share of the fitted rows (emmeans's "proportional").
const WEIGHT_OPTIONS = '<option value="equal">equal weights</option><option value="proportional">their shares of the data</option>';
const weightMode = () => (state.getPick(id, 'weights') === 'proportional' ? 'proportional' : 'equal');

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
    '<p class="lede">Everything here comes from the model on the Model page. The curves and means are on the response’s scale, carried through the inverse link, with bands from the ' + term('Wald intervals', WALD_TIP) + ' on the link scale; the effect plot averages over the other predictors, a continuous one at its mean and a factor over its levels with equal weights, or holds each at a value you set, and its caption says which.</p>' +
    '<div id="pr-fit-note"></div>' +
    '<div data-subnav class="subnav"></div>' +
    '<div data-section="effect" class="sec">' +
      '<div class="sec-hd">Effect plot</div>' +
      '<div class="ctrl-row">' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="pr-x">Predictor on the x axis</label><select id="pr-x"></select></span>' +
        '<span class="ctrl-pair"><label class="ctrl-lbl" for="pr-by">Separate lines by</label><select id="pr-by"></select></span>' +
      '</div>' +
      // What the figure shows sits in its own toolbar, at the left of the
      // export buttons; each drawing moves this group into its new toolbar.
      '<span class="fig-opts" id="pr-fig-opts">' +
        '<label class="ctrl-chk"><input type="checkbox" id="pr-data" checked> show the data</label>' +
        '<label class="ctrl-chk" id="pr-groups-lbl" hidden><input type="checkbox" id="pr-groups"> show each group</label>' +
      '</span>' +
      '<p class="muted-line" id="pr-by-note" hidden></p>' +
      '<div class="ctrl-row" id="pr-hold" hidden></div>' +
      '<div class="ctrl-row" id="pr-avg-row" hidden><span class="ctrl-pair"><label class="ctrl-lbl" for="pr-weights-e">Average factor levels with</label><select id="pr-weights-e">' + WEIGHT_OPTIONS + '</select></span></div>' +
      '<div id="pr-effect"></div>' +
    '</div>' +
    '<div data-section="means" class="sec">' +
      '<div class="sec-hd">Marginal means</div>' +
      '<div class="ctrl-row"><span class="ctrl-pair"><label class="ctrl-lbl" for="pr-factor">Predictor</label><select id="pr-factor"></select></span>' +
        '<span class="ctrl-pair" id="pr-weights-m-pair" hidden><label class="ctrl-lbl" for="pr-weights-m">Average factor levels with</label><select id="pr-weights-m">' + WEIGHT_OPTIONS + '</select></span></div>' +
      '<div id="pr-means"></div>' +
    '</div>' +
    '<div data-section="calculator" class="sec">' +
      '<div class="sec-hd">Calculator</div>' +
      '<div class="ctrl-row" id="pr-calc-inputs"></div>' +
      '<div id="pr-calc"></div>' +
    '</div>';
  els = { note: root.querySelector('#pr-fit-note'), x: root.querySelector('#pr-x'), by: root.querySelector('#pr-by'), data: root.querySelector('#pr-data'), effect: root.querySelector('#pr-effect'),
    factor: root.querySelector('#pr-factor'), means: root.querySelector('#pr-means'), calcInputs: root.querySelector('#pr-calc-inputs'), calc: root.querySelector('#pr-calc') };
  els.xPair = els.x.closest('.ctrl-pair');
  els.byPair = els.by.closest('.ctrl-pair');
  els.byNote = root.querySelector('#pr-by-note');
  els.hold = root.querySelector('#pr-hold');
  els.x.addEventListener('change', () => { state.setPick(id, 'x', els.x.value); fillBy(); buildHold(); drawEffect(); });
  els.by.addEventListener('change', () => { state.setPick(id, 'by', els.by.value || null); buildHold(); drawEffect(); });
  els.hold.addEventListener('input', onHold);
  els.hold.addEventListener('change', onHold);
  els.hold.addEventListener('click', e => {
    if (!e.target.closest('#pr-hold-reset')) return;
    state.setPick(id, 'hold', {});
    holdError = '';
    buildHold();
    drawEffect();
    // The button is gone, and so the focus moves to the row's first control.
    const first = els.hold.querySelector('[data-name]');
    if (first) first.focus();
  });
  els.data.addEventListener('change', () => { state.setPick(id, 'data', els.data.checked); drawEffect(); });
  els.groups = root.querySelector('#pr-groups');
  els.groupsLbl = root.querySelector('#pr-groups-lbl');
  els.figOpts = root.querySelector('#pr-fig-opts');
  els.figOpts.remove();
  els.groups.addEventListener('change', () => { state.setPick(id, 'groups', els.groups.checked); drawEffect(); });
  els.factor.addEventListener('change', () => { state.setPick(id, 'factor', els.factor.value); drawMeans(); });
  // One averaging rule serves the effect plot and the marginal means, and so
  // its two menus move together.
  els.avgRow = root.querySelector('#pr-avg-row');
  els.weightsE = root.querySelector('#pr-weights-e');
  els.weightsM = root.querySelector('#pr-weights-m');
  els.weightsMPair = root.querySelector('#pr-weights-m-pair');
  for (const sel of [els.weightsE, els.weightsM]) {
    sel.addEventListener('change', () => {
      state.setPick(id, 'weights', sel.value);
      els.weightsE.value = els.weightsM.value = sel.value;
      drawEffect();
      drawMeans();
    });
  }
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

// The predictors of the fitted model, kept for the Separate lines by picker and the
// held values.
let curPreds = [];
// Whether the fitted model is ordinal, whose effect plot draws a line per
// level of the response and so has no Separate lines by control.
let curOrdinal = false;
// The message for a held value that is not a number, which stops the plot.
let holdError = '';

// A factor can split the lines only when each of its levels gets a line
// style of its own; past that, two levels would be drawn alike.
const MAX_LINES = Math.min(LEVEL_COLORS.length, LEVEL_DASHES.length);
const canSplit = c => c.type === 'continuous' || c.levels.length <= MAX_LINES;

// Separate lines by offers the predictors other than the one on the x axis, and is
// hidden when there is none: a model with one predictor has nothing to
// split its lines by. A factor with more levels than there are line styles
// is listed but cannot be chosen, and a line under the controls says why.
function fillBy() {
  const opt = (v, l, sel, off) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + (off ? ' disabled' : '') + '>' + esc(l) + '</option>';
  const others = curOrdinal ? [] : curPreds.filter(c => c.name !== els.x.value);
  const wantBy = state.getPick(id, 'by');
  const ok = others.some(c => c.name === wantBy && canSplit(c));
  els.by.innerHTML = opt('', 'none', !ok) + others.map(c => canSplit(c) ? opt(c.name, c.name, c.name === wantBy) : opt(c.name, c.name + ' (' + c.levels.length + ' levels)', false, true)).join('');
  els.byPair.hidden = !others.length;
  const many = others.filter(c => !canSplit(c));
  els.byNote.hidden = !many.length;
  els.byNote.innerHTML = many.length ? 'Separate lines are drawn only for a factor with at most ' + MAX_LINES + ' levels, as the plot has ' + MAX_LINES + ' line styles to tell them apart; ' +
    many.map(c => esc(c.name) + ' has ' + c.levels.length).join(', ') + '. A factor with more levels can go on the x axis instead.' : '';
}

// The predictor the lines are split by, or null.
function currentBy() {
  const x = els.x.value;
  return !curOrdinal && els.by.value && els.by.value !== x ? els.by.value : null;
}

// The predictors the effect plot holds fixed or averages over.
function heldPredictors() {
  const x = els.x.value, by = currentBy();
  return curPreds.filter(c => c.name !== x && c.name !== by);
}

// One menu per held predictor. A factor's first entry averages over its
// levels; a continuous predictor's holds it at its mean, and its second entry
// reveals a box for a value. Only a value the reader sets is stored, and so
// an untouched predictor is at its exact mean.
function buildHold() {
  const cf = currentFit();
  const held = cf ? heldPredictors() : [];
  els.hold.hidden = !held.length || !els.x.value;
  els.weightsE.value = weightMode();
  if (els.hold.hidden) { els.hold.innerHTML = ''; els.avgRow.hidden = true; return; }
  const { ds, result } = cf;
  const grid = referenceGrid(ds, result);
  const saved = state.getPick(id, 'hold') || {};
  let any = false;
  const ctrls = held.map(c => {
    const v = saved[c.name];
    const inId = 'pr-hold-' + esc(c.name);
    const lbl = '<label class="ctrl-lbl" for="' + inId + '">' + esc(c.name) + ':</label>';
    if (c.type === 'continuous') {
      // A menu like a factor's: at its mean (its average over the data for a
      // predictor that enters as a slope), or at a value typed in a box that
      // the second entry reveals.
      const set = typeof v === 'number' && Number.isFinite(v);
      if (set) any = true;
      return '<span class="ctrl-pair">' + lbl + '<select id="' + inId + '" data-name="' + esc(c.name) + '" data-kind="mode">' +
        '<option value=""' + (set ? '' : ' selected') + '>(at its mean, ' + esc(num(grid.continuous[c.name], 4)) + ')</option>' +
        '<option value="value"' + (set ? ' selected' : '') + '>at a value…</option></select>' +
        (set ? '<input type="text" class="par-inp" id="' + inId + '-v" data-name="' + esc(c.name) + '" data-kind="value" aria-label="' + esc(c.name) + ' value" value="' + esc(String(v)) + '" inputmode="decimal">' : '') + '</span>';
    }
    const levels = grid.factors[c.name];
    const set = levels.includes(v);
    if (set) any = true;
    return '<span class="ctrl-pair">' + lbl + '<select id="' + inId + '" data-name="' + esc(c.name) + '">' +
      '<option value=""' + (set ? '' : ' selected') + '>(averaged over levels)</option>' +
      levels.map(l => '<option value="' + esc(l) + '"' + (l === v ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></span>';
  });
  els.avgRow.hidden = !held.some(c => c.type !== 'continuous' && !grid.factors[c.name].includes(saved[c.name]));
  els.hold.innerHTML = '<span class="ctrl-lbl">Values to hold other predictors at:</span>' + ctrls.join('') +
    (any ? '<button type="button" class="btn-run2" id="pr-hold-reset">Reset to averages</button>' : '');
}

// A held value changed: a number or a level is stored and the plot redrawn;
// a box that does not hold a number stops the plot until it does.
function onHold(e) {
  const inp = e.target.closest('[data-name]');
  if (!inp || !inp.isConnected) return;
  const name = inp.getAttribute('data-name');
  // A value box reports a late change as it loses focus, which can come
  // after its menu has gone back to the mean; that change is stale.
  if (inp.getAttribute('data-kind') === 'value') {
    const mode = els.hold.querySelector('select[data-kind="mode"][data-name="' + CSS.escape(name) + '"]');
    if (!mode || mode.value !== 'value') return;
  }
  const saved = Object.assign({}, state.getPick(id, 'hold') || {});
  if (inp.tagName === 'SELECT') {
    if (e.type !== 'change') return;
    if (inp.getAttribute('data-kind') === 'mode') {
      // "at a value…" starts the box at the mean, rounded for typing over.
      if (inp.value) { const cf = currentFit(); saved[name] = Number(referenceGrid(cf.ds, cf.result).continuous[name].toPrecision(5)); } else delete saved[name];
    } else if (inp.value) saved[name] = inp.value; else delete saved[name];
  } else {
    const v = inp.value.trim() === '' ? NaN : Number(inp.value);
    if (!Number.isFinite(v)) {
      holdError = 'Type a number for ' + esc(name) + ' to hold it at.';
      drawEffect();
      return;
    }
    saved[name] = v;
  }
  holdError = '';
  state.setPick(id, 'hold', saved);
  const hadReset = !!els.hold.querySelector('#pr-hold-reset');
  drawEffect();
  // The reset button comes and goes with the values set. A menu's row is
  // rebuilt on every change; a box's only when the button first appears,
  // because rebuilding on every keystroke would take the focus from it.
  if (inp.tagName === 'SELECT' || !hadReset) {
    const pos = inp.selectionStart;
    const toBox = inp.getAttribute('data-kind') === 'mode' && inp.value;
    const focusId = toBox ? inp.id + '-v' : inp.id;
    buildHold();
    const again = els.hold.querySelector('#' + CSS.escape(focusId));
    if (again) {
      again.focus();
      if (toBox) again.select();
      else if (again.tagName !== 'SELECT') again.setSelectionRange(pos, pos);
    }
  }
}

// The held values for effectGrid, from the stored choices.
function holdAt() { return state.getPick(id, 'hold') || {}; }

// The caption's account of the other predictors: which are averaged, and
// the value each of the rest is held at.
function heldText(grid) {
  const chosen = holdAt();
  const parts = Object.entries(grid.held).map(([k, v]) => {
    if (Array.isArray(v)) return esc(k) + ' averaged over its ' + v.length + ' levels';
    if (typeof v === 'number') return typeof chosen[k] === 'number' && Number.isFinite(chosen[k]) ? esc(k) + ' = ' + num(v, 4) : esc(k) + ' at its mean over the fitted rows, ' + num(v, 4);
    return esc(k) + ' = ' + esc(v);
  });
  if (!parts.length) return '';
  const averaged = Object.values(grid.held).filter(Array.isArray).length;
  const atMean = Object.entries(grid.held).some(([k, v]) => typeof v === 'number' && !(typeof chosen[k] === 'number' && Number.isFinite(chosen[k])));
  const unit = averaged > 1 ? 'combination of levels' : 'level';
  return 'Other predictors: ' + parts.join(', ') + ', as set above the plot. ' +
    (atMean ? 'For a predictor that enters the model as a slope, the prediction at its mean is the prediction averaged over its observed values on the link scale. ' : '') +
    (averaged ? (weightMode() === 'proportional' ? 'The average weights each ' + unit + ' by its share of the fitted rows' : 'The average gives each ' + unit + ' equal weight') + ' and is taken on the link scale before the inverse link, as for the marginal means' + (atMean ? '; it does not move a continuous predictor’s mean' : '') + '. ' : '');
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
  const why = degenerateFit(result);
  if (why) {
    els.note.appendChild(notice('warn', esc(why) + ' Predictions need standard errors for their intervals, and so this page waits for a model that has them.'));
    els.effect.innerHTML = ''; els.means.innerHTML = ''; els.calc.innerHTML = ''; els.calcInputs.innerHTML = '';
    setSectionAvailable(id, { effect: 'The fit has no standard errors.', means: 'The fit has no standard errors.', calculator: 'The fit has no standard errors.' });
    state.setResult(id, null);
    return;
  }
  const preds = predictorsOf(ds, result);
  curPreds = preds;
  curOrdinal = result.fit.family === 'ordinal';
  const cats = preds.filter(c => c.type !== 'continuous');
  const off = {};
  if (!cats.length) off.means = 'The model has no categorical predictor.';
  if (result.fit.family === 'ordinal') off.means = 'Marginal means are not formed for the ordinal model; the effect plot shows each level’s probability.';
  setSectionAvailable(id, off);
  els.note.appendChild(notice('info', 'Model: <code>' + esc(result.formula) + '</code>, ' + esc(FAMILIES[result.fit.family].label) + ' family with the ' + esc(LINKS[result.link].label) + ' link, fitted to ' + esc(ds.name) + '.'));
  const opt = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(l) + '</option>';
  const wantX = state.getPick(id, 'x');
  els.x.innerHTML = preds.map((c, i) => opt(c.name, c.name, c.name === wantX || (!preds.some(p => p.name === wantX) && i === 0))).join('');
  // With no predictor there is nothing to put on the x axis or to split by.
  els.xPair.hidden = !preds.length;
  fillBy();
  holdError = '';
  buildHold();
  els.data.checked = state.getPick(id, 'data') !== false;
  // The ordinal effect plot draws probabilities, not the observations.
  els.data.closest('label, .ctrl-chk, .ctrl-pair').hidden = result.fit.family === 'ordinal';
  els.groupsLbl.hidden = !(result.fit.mixed && result.fit.random.terms[0].kind === 'group');
  els.groups.checked = state.getPick(id, 'groups') === true;
  const wantF = state.getPick(id, 'factor');
  els.factor.innerHTML = cats.map((c, i) => opt(c.name, c.name, c.name === wantF || (!cats.some(p => p.name === wantF) && i === 0))).join('');
  buildCalcInputs(ds, result, preds);
  if (!preds.length) els.calcInputs.innerHTML = '<span class="muted-line">The model has no predictor to set; its one prediction is the intercept.</span>';
  drawEffect();
  drawMeans();
  drawCalc();
  registerTips(rootEl);
}

// Puts the figure's display options at the left of its toolbar.
function placeFigureOptions(box) {
  const tools = box.querySelector('.fig-tools');
  if (tools) tools.insertBefore(els.figOpts, tools.firstChild);
}

// The ordinal model's predictions: a probability per level.
const ordinalPredict = ordinalPredictRows;

// The ordinal model with no predictor: one bar per level at its probability.
function drawOrdinalInterceptEffect(ds, result) {
  const levels = column(ds, state.spec.response).col.levels;
  const probs = ordinalPredict(ds, result, [{}])[0];
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.effect.appendChild(box);
  const fig = makeFigure(box, { height: 320, xLabel: state.spec.response, yLabel: 'probability', title: 'Predicted probability of each level with no predictor' });
  exportButtons(box, fig, ds.name + ' ordinal probabilities');
  placeFigureOptions(box);
  fig.render(f => {
    f.y([0, 1]);
    levelBars(f, levels, probs);
  });
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = 'The model has no predictor, and so it predicts the same probabilities for every observation: ' + levels.map((l, k) => 'P(' + esc(l) + ') = ' + num(probs[k], 4)).join(', ') + ', which sum to 1 and are the levels’ shares of the fitted rows.';
  els.effect.appendChild(p);
  figs.push(fig);
  last.effect = { x: null, by: null, ordinal: true, levels: levels.slice(), series: [{ label: 'probabilities', by: null, rows: [{}], probs: [probs] }] };
}

function drawOrdinalEffect(ds, result) {
  const x = els.x.value;
  if (!x) { drawOrdinalInterceptEffect(ds, result); return; }
  if (holdError) { els.effect.appendChild(notice('warn', holdError)); return; }
  const grid = effectGrid(ds, result, x, null, 60, holdAt());
  const xc = column(ds, x);
  const levels = column(ds, state.spec.response).col.levels;
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.effect.appendChild(box);
  const fig = makeFigure(box, { height: 320, xLabel: x, yLabel: 'probability', title: 'Predicted probability of each level against ' + x });
  exportButtons(box, fig, ds.name + ' ordinal effect of ' + x);
  placeFigureOptions(box);
  const s = grid.series[0];
  const probs = ordinalPredict(ds, result, s.rows, weightMode());
  last.effect = { x, by: null, ordinal: true, levels: levels.slice(), held: grid.held, weights: weightMode(), series: [{ label: 'probabilities', by: null, rows: s.rows, probs }] };
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
  legend(box.appendChild(document.createElement('div')), levels.map((l, k) => ({ swatch: LEVEL_DASHES[k % LEVEL_DASHES.length] ? 'dash' : 'line', dash: LEVEL_DASHES[k % LEVEL_DASHES.length], color: LEVEL_COLORS[k % LEVEL_COLORS.length], label: 'P(' + esc(l) + ')' })));
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = heldText(grid) + 'The probabilities of the levels sum to 1 at every ' + esc(x) + '.';
  els.effect.appendChild(p);
  figs.push(fig);
}

// With no predictor, the model predicts one mean for every observation:
// the observations in the order loaded, with the fitted mean and its band
// across them, and each group's own mean where the model has groups.
function drawInterceptEffect(ds, result) {
  const level = state.settings.level;
  const resp = column(ds, state.spec.response).col;
  const link = LINKS[result.link];
  const yLabel = result.event ? 'probability of ' + result.event : state.spec.response;
  const pred = predictRows(ds, result, [{}], level);
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.effect.appendChild(box);
  const fig = makeFigure(box, { height: 320, xLabel: 'observation', yLabel, title: 'Predicted ' + yLabel + ' with no predictor' });
  exportButtons(box, fig, ds.name + ' predicted mean');
  placeFigureOptions(box);
  const showData = els.data.checked;
  const yData = result.codedY || result.design.y;
  const n = result.design.keep.length;
  const idx = Array.from({ length: n }, (_, k) => k + 1);
  const binary = resp && (resp.type !== 'continuous' || support(resp, valuesOf(ds, resp.name)) === 'binary');
  const bins = showData && binary ? binnedMeans(idx, Array.from(yData), 10) : null;
  const groupLines = els.groups.checked && result.fit.mixed && result.fit.random.terms[0].kind === 'group';
  const legendItems = [];
  fig.render(f => {
    const allY = [pred.fitLo[0], pred.fitHi[0]];
    if (showData) { if (bins) for (const b of bins) allY.push(b.y); else for (let k = 0; k < n; k++) allY.push(yData[k]); }
    const lo = Math.min(...allY), hi = Math.max(...allY);
    const prob = result.fit.family === 'binomial' || result.fit.family === 'beta';
    f.x([1, Math.max(2, n)], { pad: 0.03, nice: true });
    if (prob) f.y([Math.min(0, lo), Math.max(1, hi)]); else f.y([lo, hi], { pad: 0.06, nice: true });
    f.axes({});
    if (showData) {
      if (bins) dataPoints(f, bins, { color: '--est', hollow: true, r: 4.2, label: 'binned proportion' });
      else rawPoints(f, idx, Array.from(yData), { label: 'observation' });
    }
    if (groupLines) {
      // Each group's mean, drawn across that group's own observations.
      const re = result.fit.ranef[0], ids = result.fit.random.terms[0].ids;
      re.levels.forEach((l, g) => {
        let lo = Infinity, hi = -Infinity;
        ids.forEach((gid, k) => { if (gid === g) { if (k + 1 < lo) lo = k + 1; if (k + 1 > hi) hi = k + 1; } });
        if (lo > hi) return;
        const yg = link.linkinv(pred.eta[0] + re.modes[g][0]);
        curveBand(f, { x: [lo, Math.max(hi, lo + 0.5)], y: [yg, yg] }, { band: false, color: '--pair', width: 1.5, label: 'group ' + l });
      });
    }
    curveBand(f, { x: [1, n], y: [pred.fit[0], pred.fit[0]], lo: [pred.fitLo[0], pred.fitLo[0]], hi: [pred.fitHi[0], pred.fitHi[0]] }, { color: '--truth', label: 'predicted mean' });
    legendItems.length = 0;
    legendItems.push({ swatch: 'line', color: '--truth', label: 'predicted mean with its ' + lvl(level) + ' band' });
    if (showData) legendItems.push(bins ? { swatch: 'hollow', color: '--est', label: 'observed proportion in a bin of consecutive observations (ten bins of equal count)' } : { swatch: 'dot', color: '--est', label: 'observation' });
    if (groupLines) legendItems.push({ swatch: 'thin', color: '--pair', label: 'one group’s mean, from its predicted random effect' });
  });
  legend(box.appendChild(document.createElement('div')), legendItems);
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = 'The model has no predictor, and so it predicts one mean for every observation: the intercept carried through the inverse link, with its ' + term('Wald band', WALD_TIP) + '. The observations are drawn in the order loaded. ' +
    (result.fit.mixed ? 'The population mean is the prediction at a random effect of zero: the typical group’s' + (result.link === 'identity' ? '' : ', not the average over groups, because the inverse link is not linear') + '. ' : '') +
    (groupLines ? 'Each thin line is one group’s mean, drawn across that group’s observations: the population mean shifted by the group’s predicted random effect. ' : '') +
    (bins ? 'Binned proportions are the share of ' + esc(result.event || '1') + ' among the observations in each bin.' : '');
  els.effect.appendChild(p);
  figs.push(fig);
  last.effect = { x: null, by: null, series: [{ label: 'predicted mean', by: null, rows: [{}], pred }] };
}

function drawEffect() {
  const cf = currentFit();
  els.effect.innerHTML = '';
  last.effect = null;
  if (!cf) { registerResult(); return; }
  const { ds, result } = cf;
  if (result.fit.family === 'ordinal') { drawOrdinalEffect(ds, result); registerResult(); return; }
  if (!predictorsOf(ds, result).length) { drawInterceptEffect(ds, result); registerResult(); return; }
  if (!els.x.value) { registerResult(); return; }
  if (holdError) { els.effect.appendChild(notice('warn', holdError)); registerResult(); return; }
  const x = els.x.value, by = currentBy();
  const level = state.settings.level;
  const grid = effectGrid(ds, result, x, by, 60, holdAt(), MAX_LINES);
  const resp = column(ds, result.design && state.spec.response).col;
  const xc = column(ds, x);
  const link = LINKS[result.link];
  const yLabel = result.event ? 'probability of ' + result.event : state.spec.response;
  const box = document.createElement('div');
  box.className = 'fig-box';
  els.effect.appendChild(box);
  const fig = makeFigure(box, { height: 320, xLabel: x, yLabel, title: 'Predicted ' + yLabel + ' against ' + x + (by ? ' by ' + by : '') });
  exportButtons(box, fig, ds.name + ' effect of ' + x);
  placeFigureOptions(box);
  const showData = els.data.checked;
  const yData = result.codedY || result.design.y;
  const keep = result.design.keep;
  const xs = keep.map(i => ds.rows[i][xc.index]);
  const byc = by ? column(ds, by) : null;
  const legendItems = [];
  const curves = grid.series.map(s => Object.assign({}, s, { pred: predictRows(ds, result, s.rows, level, weightMode()) }));
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
    curves.forEach((c, i) => legendItems.push({ swatch: by && LEVEL_DASHES[i % LEVEL_DASHES.length] ? 'dash' : 'line', dash: by ? LEVEL_DASHES[i % LEVEL_DASHES.length] : null, color: by ? LEVEL_COLORS[i % LEVEL_COLORS.length] : '--truth', label: esc(c.label || 'predicted mean') + ' with its ' + lvl(level) + ' band' }));
    if (showData) legendItems.push(pts.length ? { swatch: 'hollow', color: '--est', label: 'observed proportion in a bin of ' + esc(x) + ' (ten bins of equal count)' } : { swatch: 'dot', color: '--est', label: 'observation' });
    if (els.groups.checked && result.fit.mixed && !by) legendItems.push({ swatch: 'thin', color: '--pair', label: 'one group’s curve, from its predicted random effect' });
  });
  legend(box.appendChild(document.createElement('div')), legendItems);
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = heldText(grid) +
    (result.fit.mixed ? 'The population curve is the prediction at a random effect of zero: the typical group’s' + (result.link === 'identity' ? '' : ', not the average over groups, because the inverse link is not linear') + '. ' : '') +
    (els.groups.checked && result.fit.mixed && !by ? 'Each thin line is one group’s curve: the population curve shifted by the group’s predicted random effect' + (result.fit.random.terms[0].q === 2 ? ' and slope' : '') + '. ' : '') +
    (grid.byAt === 'values' ? 'The lines take ' + esc(by) + ' at each value it has in the data. ' : grid.byAt === 'quartiles' ? 'The lines take ' + esc(by) + ' at its quartiles. ' : '') +
    (result.fit.family === 'binomial' ? 'Binned proportions are the share of ' + esc(result.event || '1') + ' among the observations in each bin, at the bin’s mean ' + esc(x) + '.' : '');
  els.effect.appendChild(p);
  figs.push(fig);
  last.effect = { x, by, held: grid.held, weights: weightMode(), series: curves.map(c => ({ label: c.label, by: c.by, rows: c.rows, pred: c.pred })) };
  registerResult();
}

function drawMeans() {
  const cf = currentFit();
  els.means.innerHTML = '';
  last.means = null;
  els.weightsMPair.hidden = true;
  if (!cf || !els.factor.value) { registerResult(); return; }
  const { ds, result } = cf;
  const level = state.settings.level;
  let m;
  try { m = marginalMeans(ds, result, els.factor.value, level, weightMode()); } catch (err) { els.means.appendChild(notice('warn', esc(err.message))); registerResult(); return; }
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
  els.weightsMPair.hidden = !others.length;
  els.weightsM.value = weightMode();
  const p = document.createElement('p');
  p.className = 'muted-line';
  p.innerHTML = 'Each mean is the model’s prediction at the level' + (held ? ', with ' + held + ' (the means over the fitted rows)' : '') + (others.length ? ', averaged over the levels of ' + esc(others.join(', ')) + (m.weights === 'proportional' ? ', each ' + (others.length > 1 ? 'combination of levels' : 'level') + ' weighted by its share of the fitted rows' : ' with equal weights') : '') + ', on the link scale and then carried to the response scale. ' +
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
  if (last.effect && last.effect.ordinal) {
    const e = last.effect;
    provenance['effect plot'] = e.x ? e.x : 'the thresholds alone';
    if (e.held && Object.keys(e.held).length) provenance['other predictors'] = heldProvenance(e.held, e.weights);
    const headers = (e.x ? [e.x] : []).concat(e.levels.map(l => 'P(' + l + ')'));
    const rows = [];
    for (const s of e.series) s.rows.forEach((row, i) => rows.push((e.x ? [row[e.x]] : []).concat(s.probs[i])));
    tables.push({ name: 'Effect plot', headers, rows });
  } else if (last.effect) {
    const e = last.effect;
    provenance['effect plot'] = e.x ? e.x + (e.by ? ' by ' + e.by : '') : 'the intercept alone';
    if (e.held && Object.keys(e.held).length) provenance['other predictors'] = heldProvenance(e.held, e.weights);
    const headers = (e.x ? [e.x] : []).concat(e.by ? [e.by] : []).concat(['eta', 'std_error', 'fit', 'fit_lower', 'fit_upper']);
    const rows = [];
    for (const s of e.series) s.rows.forEach((row, i) => rows.push((e.x ? [row[e.x]] : []).concat(e.by ? [s.by != null ? s.by : s.label] : []).concat([s.pred.eta[i], s.pred.se[i], s.pred.fit[i], s.pred.fitLo[i], s.pred.fitHi[i]])));
    tables.push({ name: 'Effect plot', headers, rows });
  }
  if (last.means) {
    const m = last.means, useT = Number.isFinite(m.df);
    provenance['marginal means of'] = m.factor;
    if (Object.keys(m.grid.factors).length > 1) provenance['other factors averaged with'] = WEIGHT_WORDS[m.weights];
    provenance.adjustment = 'Tukey';
    tables.push({ name: 'Marginal means', headers: [m.factor, 'mean_link', 'std_error', 'ci_lower', 'ci_upper', 'mean_response', 'response_lower', 'response_upper'], rows: m.means.map(r => [r.level, r.eta, r.se, r.lo, r.hi, r.fit, r.fitLo, r.fitHi]) },
      { name: 'Pairwise differences', headers: ['pair', 'difference', 'std_error', useT ? 't' : 'z', 'p_tukey', 'ci_lower', 'ci_upper'].concat(link.backName ? ['ratio', 'ratio_lower', 'ratio_upper'] : []),
        rows: m.pairs.map(p => [p.a + ' - ' + p.b, p.diff, p.se, p.t, p.p, p.lo, p.hi].concat(link.backName ? [p.ratio, p.ratioLo, p.ratioHi] : [])) });
  }
  if (last.calc && last.calc.ordinal) {
    const { row, levels, probs } = last.calc;
    provenance.calculator = Object.entries(row).map(([k, v]) => k + ' = ' + v).join(', ') || 'no predictor';
    tables.push({ name: 'Calculator', headers: ['quantity', 'value'], rows: Object.entries(row).concat(levels.map((l, k) => ['P(' + l + ')', probs[k]])) });
  } else if (last.calc) {
    const { row, pred } = last.calc;
    provenance.calculator = Object.entries(row).map(([k, v]) => k + ' = ' + v).join(', ');
    tables.push({ name: 'Calculator', headers: ['quantity', 'value'], rows: Object.entries(row).concat([['linear predictor', pred.eta[0]], ['std_error', pred.se[0]], ['ci_lower', pred.lo[0]], ['ci_upper', pred.hi[0]], ['prediction', pred.fit[0]], ['prediction_lower', pred.fitLo[0]], ['prediction_upper', pred.fitHi[0]]]) });
  }
  const regen = {
    spec, ds,
    tooBig: () => tooBig(ds, [spec]),
    build: () => capRecipe(predictRecipe({ ds, spec, result, level, title, provenance, effect: last.effect, means: last.means, calc: last.calc }), ds, [spec])
  };
  state.setResult(id, { title, provenance, tables, regen });
}

const WEIGHT_WORDS = { equal: 'equal weights', proportional: 'their shares of the fitted rows' };

function heldProvenance(held, weights) {
  return Object.entries(held).map(([k, v]) => Array.isArray(v) ? k + ' averaged over its levels with ' + WEIGHT_WORDS[weights || 'equal'] : k + ' = ' + (typeof v === 'number' ? Number(v.toPrecision(6)) : v)).join(', ');
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
    last.calc = { row, ordinal: true, levels: levels.slice(), probs: pr };
    registerResult();
    return;
  }
  const p = predictRows(ds, result, [row], level);
  const link = LINKS[result.link];
  const yLabel = result.event ? 'probability of ' + result.event : state.spec.response;
  // One row per scale: the linear predictor on the link scale, and its
  // image on the response scale; with the identity link the two coincide.
  const identity = link.id === 'identity';
  const rows = [];
  if (!identity) rows.push(['Link scale (' + esc(link.label) + ')', 'linear predictor η', stat(p.eta[0], 5), stat(p.se[0], 4), '[' + stat(p.lo[0], 5) + ', ' + stat(p.hi[0], 5) + ']', 'a ' + term('Wald interval', WALD_TIP)]);
  rows.push(['Response scale', 'predicted ' + esc(yLabel), stat(p.fit[0], 5), identity ? stat(p.se[0], 4) : '–', '[' + stat(p.fitLo[0], 5) + ', ' + stat(p.fitHi[0], 5) + ']', identity ? 'a ' + term('Wald interval', WALD_TIP) : 'the link-scale interval carried through the inverse link']);
  const tbl = document.createElement('div');
  tbl.className = 'scroll-box';
  tbl.innerHTML = '<table class="ptab"><thead><tr><th>Scale</th><th>Quantity</th><th>Estimate</th><th>Standard error</th><th>' + esc(lvl(level)) + ' interval</th><th></th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td><td class="muted-line">' + r[5] + '</td></tr>').join('') + '</tbody></table>';
  els.calc.appendChild(tbl);
  last.calc = { row, pred: p };
  registerResult();
}

export default { id, title, render, onShow, sections };
