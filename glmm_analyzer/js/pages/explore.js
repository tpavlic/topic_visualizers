// The Explore page: what the response holds and the families that can
// describe it, its descriptives overall and by a categorical predictor, its
// histogram, and the response against each predictor. A dataset with
// outcomes can show any one of them in the response's place.

import * as state from '../state.js';
import { column, support, valuesOf, SUPPORT_LABEL, predictorColumns, groupColumns, outcomeColumns } from '../data/model.js';
import { FAMILIES, familiesFor } from '../stats/families.js';
import { summary, histogram, boxStats, distinctValues, HIST_BINS_MIN, HIST_BINS_MAX } from '../stats/descriptive.js';
import { binnedMeans } from '../stats/inference.js';
import { makeFigure, histogram as drawHistogram, boxPlot, intervals, exportButtons, legend } from '../ui/plots.js';
import { dataPoints, rawPoints, curveBand } from '../ui/modelplots.js';
import { datasetSelect, card, cardRow, notice, spinner, details } from '../ui/widgets.js';
import { histChoice } from '../ui/rules.js';
import { installExportRow } from '../ui/exportrow.js';
import { esc, num, stat, intl, plural } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'explore';
/** The page's title. */
export const title = 'Explore';
/** The histogram lists the distinct values when there are at most this many. */
const DISTINCT_LIST_MAX = 30;

let rootEl = null;
let els = {};
let dsSel = null;
let figs = [];

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">What the response holds decides which families can describe it, and how it moves with each predictor is the first look at the model to build. Nothing here is a fit; the Model page fits.</p>' +
    '<div class="sec ctrl-card"><div class="ctrl-row">' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="ex-ds">Dataset</label><select id="ex-ds"></select></span>' +
      '<span class="ctrl-pair" id="ex-rs-pair" hidden><label class="ctrl-lbl" for="ex-rs">Response</label><select id="ex-rs"></select></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="ex-by">Group descriptives by</label><select id="ex-by"></select></span>' +
    '</div></div>' +
    '<div class="sec"><div class="sec-hd">The response</div><div id="ex-resp"></div></div>' +
    '<div class="sec"><div class="sec-hd">Descriptives</div><div id="ex-desc"></div></div>' +
    '<div class="sec"><div class="sec-hd">Against each predictor</div><p class="exp-note">A continuous predictor gives a scatter with the mean of the response in ten bins of equal count; a categorical one gives a box per level or, for a binary response, the proportion per level.</p><div id="ex-plots"></div></div>';
  els = { ds: root.querySelector('#ex-ds'), rs: root.querySelector('#ex-rs'), rsPair: root.querySelector('#ex-rs-pair'), by: root.querySelector('#ex-by'), resp: root.querySelector('#ex-resp'), desc: root.querySelector('#ex-desc'), plots: root.querySelector('#ex-plots') };
  dsSel = datasetSelect(els.ds, { remember: { page: id, key: 'dataset' } });
  els.ds.addEventListener('change', () => { fillResponse(); fillBy(); compute(); });
  els.rs.addEventListener('change', () => { state.setPick(id, 'response', els.rs.value || null); compute(); });
  els.by.addEventListener('change', () => { state.setPick(id, 'by', els.by.value || null); compute(); });
  installExportRow(root, id);
  state.on('datasets', () => { fillResponse(); fillBy(); if (visible()) compute(); });
  fillResponse();
  fillBy();
  compute();
}

function visible() { return !!rootEl && rootEl.classList.contains('active'); }

/** Called each time the page is shown. */
export function onShow() { compute(); }

function current() { return state.get(els.ds.value); }

// A dataset with outcomes can show any of them as the response; the picker
// is hidden for a dataset with one response.
function fillResponse() {
  const ds = current();
  const cands = ds ? outcomeColumns(ds) : [];
  const want = state.getPick(id, 'response');
  const resp = ds ? ds.columns.find(c => c.role === 'response') : null;
  const chosen = cands.some(c => c.name === want) ? want : (resp ? resp.name : '');
  els.rs.innerHTML = cands.map(c => '<option value="' + esc(c.name) + '"' + (c.name === chosen ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  els.rsPair.hidden = cands.length < 2;
}

function fillBy() {
  const ds = current();
  const cats = ds ? ds.columns.filter(c => c.role !== 'ignored' && c.role !== 'response' && c.role !== 'outcome' && c.type !== 'continuous') : [];
  const want = state.getPick(id, 'by');
  els.by.innerHTML = '<option value="">none</option>' + cats.map(c => '<option value="' + esc(c.name) + '"' + (c.name === want ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  els.by.disabled = !cats.length;
}

function compute() {
  for (const f of figs) if (f.ro) f.ro.disconnect();
  figs = [];
  const ds = current();
  if (!ds) {
    els.resp.innerHTML = '<p class="muted-line">Load a dataset on the Import page first.</p>';
    els.desc.innerHTML = ''; els.plots.innerHTML = '';
    state.setResult(id, null);
    return;
  }
  const picked = els.rsPair.hidden ? null : column(ds, els.rs.value);
  const resp = picked ? picked.col : ds.columns.find(c => c.role === 'response');
  if (!resp) {
    els.resp.innerHTML = '<p class="muted-line">The dataset has no response column; assign one on the Import page.</p>';
    els.desc.innerHTML = ''; els.plots.innerHTML = '';
    state.setResult(id, null);
    return;
  }
  const vals = valuesOf(ds, resp.name);
  const sup = support(resp, vals);
  const fams = familiesFor(sup);
  const nMissing = vals.filter(v => v == null).length;
  els.resp.innerHTML = '';
  els.resp.appendChild(cardRow([
    card('Response', esc(resp.name), esc(resp.type)),
    card('Values', esc(SUPPORT_LABEL[sup])),
    card('Rows', intl(ds.rows.length), nMissing ? intl(nMissing) + ' missing the response' : 'none missing the response'),
    card('Distinct values', intl(new Set(vals.filter(v => v != null)).size))
  ]));
  const famText = fams.length
    ? 'Families whose support holds these values: ' + fams.map(f => '<b>' + esc(FAMILIES[f].label) + '</b>').join(', ') + '. ' + familyAdvice(sup)
    : 'No family offered fits these values.';
  els.resp.appendChild(notice('info', famText));

  // Descriptives: overall and by the chosen categorical.
  const numeric = resp.type === 'continuous';
  const y = numeric ? vals.filter(v => v != null) : null;
  const levels = resp.levels || [];
  let html = '';
  const byName = els.by.value;
  const byCol = byName ? column(ds, byName) : null;
  const groups = byCol ? byCol.col.levels.map(l => ({ label: l, rows: ds.rows.filter(r => r[byCol.index] === l) })) : [{ label: 'all', rows: ds.rows }];
  const rc = column(ds, resp.name);
  const tableRows = [];
  if (numeric) {
    html += '<div class="scroll-box"><table class="ptab"><thead><tr><th>' + (byCol ? esc(byName) : 'Rows') + '</th><th>n</th><th>mean</th><th>sd</th><th>min</th><th>q1</th><th>median</th><th>q3</th><th>max</th></tr></thead><tbody>';
    for (const g of groups) {
      const v = g.rows.map(r => r[rc.index]).filter(x => x != null);
      const s = summary(v);
      html += '<tr><td>' + esc(g.label) + '</td><td>' + intl(s.n) + '</td><td>' + stat(s.mean, 5) + '</td><td>' + stat(s.sd, 4) + '</td><td>' + stat(s.min, 4) + '</td><td>' + stat(s.q1, 4) + '</td><td>' + stat(s.median, 4) + '</td><td>' + stat(s.q3, 4) + '</td><td>' + stat(s.max, 4) + '</td></tr>';
      tableRows.push([g.label, s.n, s.mean, s.sd, s.min, s.q1, s.median, s.q3, s.max]);
    }
    html += '</tbody></table></div>';
  } else {
    html += '<div class="scroll-box"><table class="ptab"><thead><tr><th>' + (byCol ? esc(byName) : 'Rows') + '</th><th>n</th>' + levels.map(l => '<th>' + esc(l) + '</th>').join('') + '</tr></thead><tbody>';
    for (const g of groups) {
      const v = g.rows.map(r => r[rc.index]).filter(x => x != null);
      const counts = levels.map(l => v.filter(x => x === l).length);
      html += '<tr><td>' + esc(g.label) + '</td><td>' + intl(v.length) + '</td>' + counts.map(c => '<td>' + intl(c) + ' (' + num(100 * c / Math.max(1, v.length), 3) + '%)</td>').join('') + '</tr>';
      tableRows.push([g.label, v.length].concat(counts));
    }
    html += '</tbody></table></div>';
  }
  els.desc.innerHTML = html;
  if (numeric) histogramBlock(ds, resp, y);

  // Against each predictor.
  els.plots.innerHTML = '';
  const preds = ds.columns.filter(c => c.role === 'predictor' || c.role === 'group');
  const yNum = Float64Array.from(vals, v => (v == null ? NaN : (numeric ? v : (levels.length === 2 ? (v === levels[1] ? 1 : 0) : levels.indexOf(v)))));
  const yLabel = numeric ? resp.name : (levels.length === 2 ? 'proportion ' + levels[1] : resp.name + ' (level index)');
  for (const pc of preds) {
    const box = document.createElement('div');
    box.className = 'fig-box';
    els.plots.appendChild(box);
    const px = column(ds, pc.name);
    if (pc.type === 'continuous') {
      const xs = ds.rows.map(r => r[px.index]);
      const idx = xs.map((x, i) => i).filter(i => x_(xs[i]) && Number.isFinite(yNum[i]));
      const X = idx.map(i => xs[i]), Y = idx.map(i => yNum[i]);
      const fig = makeFigure(box, { height: 240, xLabel: pc.name, yLabel, title: resp.name + ' against ' + pc.name });
      exportButtons(box, fig, ds.name + ' ' + resp.name + ' by ' + pc.name);
      fig.render(f => {
        rawPoints(f, X, Y);
        const b = binnedMeans(X, Y, 10);
        if (b.length > 1) curveBand(f, { x: b.map(p => p.x), y: b.map(p => p.y) }, { band: false, label: 'binned mean', width: 2 });
        dataPoints(f, b, { color: '--truth', hollow: true, r: 4, label: 'binned mean' });
      });
      legend(box.appendChild(document.createElement('div')), [{ swatch: 'dot', color: '--est', label: 'observation' }, { swatch: 'hollow', color: '--truth', label: 'mean of ' + yLabel + ' in a bin of ' + pc.name }]);
      figs.push(fig);
    } else {
      const lv = pc.levels || [];
      const fig = makeFigure(box, { height: 'auto', xLabel: yLabel, title: resp.name + ' by ' + pc.name });
      exportButtons(box, fig, ds.name + ' ' + resp.name + ' by ' + pc.name);
      fig.render(f => {
        const items = lv.map(l => {
          const v = ds.rows.filter(r => r[px.index] === l).map(r => yNum[ds.rows.indexOf(r)]).filter(Number.isFinite);
          return { label: l + ' (n = ' + v.length + ')', stats: v.length ? boxStats(v) : { q1: NaN, median: NaN, q3: NaN, whiskerLo: NaN, whiskerHi: NaN, outliers: [] }, v };
        });
        if (numeric || levels.length !== 2) boxPlot(f, items.map(it => ({ label: it.label, stats: it.stats })));
        else {
          // A binary response: the proportion per level with its Wilson interval.
          const rows = items.map(it => { const n = it.v.length, p = n ? it.v.reduce((a, c) => a + c, 0) / n : NaN; const z = 1.959963984540054; const d = 1 + z * z / n; const c = (p + z * z / (2 * n)) / d; const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return { label: it.label, center: p, lo: c - h, hi: c + h }; });
          f.x([0, 1]);
          intervals(f, rows, { ref: null });
        }
      });
      figs.push(fig);
    }
  }
  state.setResult(id, {
    title: 'Explore: ' + resp.name + ' in ' + ds.name,
    provenance: { dataset: ds.name, response: resp.name, values: SUPPORT_LABEL[sup], 'descriptives by': byName || 'none' },
    tables: [{ name: 'Descriptives', headers: numeric ? ['group', 'n', 'mean', 'sd', 'min', 'q1', 'median', 'q3', 'max'] : ['group', 'n'].concat(levels), rows: tableRows }]
  });
  registerTips(rootEl);
}

const x_ = v => typeof v === 'number' && Number.isFinite(v);

function familyAdvice(sup) {
  return {
    binary: 'The binomial family with a logit link is the usual choice; the normal family would model the 0 or 1 directly, which can predict outside the interval.',
    count: 'Start with the Poisson family; if the Pearson χ² / df on the Model page sits well above 1, the counts are overdispersed, and the negative binomial family (or a Poisson-lognormal) fits them.',
    unit: 'The beta family with a logit link models a proportion that is a measurement rather than a count of successes; the normal family can serve when the values stay well inside the interval.',
    positive: 'The gamma family with a log link models a positive, right-skewed response whose spread grows with its mean; the normal family with a log link keeps the spread constant instead.',
    real: 'The normal family with an identity link is the linear model.',
    ordinal: 'The ordinal family models the cumulative probabilities of the ordered levels.'
  }[sup] || '';
}

export default { id, title, render, onShow };

// The response's histogram with its bins: one bar per value where the values
// are few enough for that, the default when they look discrete (a count or a
// binary response, or a few exact values), or k of equal width, Sturges' rule
// unless the slider is moved. The choice is kept per dataset and response.
function histogramBlock(ds, resp, y) {
  const pickKey = 'hist:' + ds.id + ':' + resp.name;
  const pick = Object.assign({}, state.getPick(id, pickKey) || {});
  let hc = histChoice(y, pick);
  let hb = histogram(y, hc.perValue ? { perValue: true } : { bins: hc.bins });
  const autoBins = histChoice(y, null).bins;
  const autoTip = 'Sturges\u2019 rule: \u2308log\u2082 n + 1\u2309 bins: ' + plural(autoBins, 'bin') + ' with n = ' + intl(y.length) + '.';
  const remember = () => state.setPick(id, pickKey, { mode: pick.mode, bins: pick.bins });
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  row.innerHTML = (hc.canValue
    ? '<span class="ctrl-pair"><span class="ctrl-lbl" id="ex-hist-lbl"><span class="tip" tabindex="0" data-tip="One per value gives each distinct value its own bar, which is how a count or a binary response is read; it is the default when the values look discrete: whole numbers that repeat, or a few exact values. Equal width cuts the range into k bins of one width, as a histogram of a measurement is drawn.">Bins</span></span>' +
      '<span class="seg" role="group" aria-labelledby="ex-hist-lbl"><button type="button" class="seg-btn" data-hist="value">One per value</button><button type="button" class="seg-btn" data-hist="width">Equal width</button></span></span>'
    : '') +
    '<span class="ctrl-pair ex-hist-width"><label class="ctrl-lbl" for="ex-bins">' +
      (hc.canValue ? '' : '<span class="tip" tabindex="0" data-tip="The number of equal-width bins from the smallest value to the largest. Auto sets it by Sturges\u2019 rule.">Bins</span> ') + '<span class="sym">k</span></label>' +
      '<input type="range" id="ex-bins-rng" min="' + HIST_BINS_MIN + '" max="' + HIST_BINS_MAX + '" step="1" value="' + hc.bins + '" aria-label="Bins k, as a slider">' +
      '<input type="text" id="ex-bins" value="' + hc.bins + '">' +
      '<span class="ctrl-note" id="ex-bins-note"></span>' +
      '<button type="button" class="xp-btn" id="ex-bins-auto" data-tip="' + autoTip + '" data-tip-press>Auto</button></span>';
  els.desc.appendChild(row);
  const rng = row.querySelector('#ex-bins-rng'), widthPair = row.querySelector('.ex-hist-width');
  const note = row.querySelector('#ex-bins-note'), autoBtn = row.querySelector('#ex-bins-auto');

  const box = document.createElement('div');
  box.className = 'fig-box';
  els.desc.appendChild(box);
  const fig = makeFigure(box, { height: 230, xLabel: resp.name, yLabel: 'Frequency', title: 'Histogram of ' + resp.name });
  exportButtons(box, fig, ds.name + ' histogram');
  const draw = f => drawHistogram(f, hb);
  fig.render(draw);
  figs.push(fig);
  const cap = document.createElement('p');
  cap.className = 'ex-cap';
  els.desc.appendChild(cap);
  const setCap = () => {
    cap.innerHTML = hc.perValue
      ? 'Each bar counts the rows whose response equals its value, ' + intl(y.length) + ' in all over ' + plural(hc.nUnique, 'distinct value') + '. ' +
        (hc.rule === 'count' ? 'The values are whole numbers that repeat, as counts do, and so each has a bar of its own; Equal width bins them as a measurement would be.'
          : hc.rule === 'few' ? 'The values are a few exact outcomes, each seen several times, and so each has a bar of its own.'
          : 'Each distinct value has a bar of its own, as asked; these values do not look discrete, and Equal width is the usual choice for them.')
      : 'Each bar counts the rows whose response falls in its bin, ' + intl(y.length) + ' in all in ' + plural(hc.bins, 'equal-width bin') + ' from the smallest value to the largest' +
        (hc.auto ? ' (Sturges\u2019 rule).' : ' (set by the slider).') +
        (hc.discrete ? ' The values look discrete, and One per value gives each its own bar.' : '');
  };

  // Every distinct value with its count and share, when there are few enough
  // to list and the bars are one per value: what the bars show, as numbers.
  let distinct = null;
  if (hc.nUnique >= 1 && hc.nUnique <= DISTINCT_LIST_MAX) {
    const dv = distinctValues(y);
    let cum = 0;
    const rows = Array.from(dv.values, (v, i) => { cum += dv.counts[i]; return '<tr><td>' + num(v, 8) + '</td><td>' + intl(dv.counts[i]) + '</td><td>' + num(dv.counts[i] / dv.n, 4) + '</td><td>' + num(cum / dv.n, 4) + '</td></tr>'; });
    distinct = details('The ' + plural(hc.nUnique, 'distinct value') + ', with counts and proportions',
      '<div class="scroll-box"><table class="ptab"><thead><tr><th>Value</th><th>Count</th><th>Proportion</th><th>Cumulative</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>');
    els.desc.appendChild(distinct);
  }

  const sync = () => {
    hc = histChoice(y, pick);
    hb = histogram(y, hc.perValue ? { perValue: true } : { bins: hc.bins });
    if (distinct) distinct.hidden = !hc.perValue;
    row.querySelectorAll('[data-hist]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.hist === 'value') === hc.perValue)));
    widthPair.hidden = hc.perValue;
    rng.value = String(hc.bins);
    spin.set(hc.bins, false);
    note.textContent = hc.perValue ? '' : plural(hb.counts.length, 'bin') + ' of width ' + num(hb.binWidth, 3);
    autoBtn.setAttribute('aria-pressed', String(hc.auto));
    setCap();
  };
  const setBins = v => {
    v = Math.min(HIST_BINS_MAX, Math.max(HIST_BINS_MIN, Math.round(v)));
    if (!Number.isFinite(v) || v === hc.bins) { sync(); return; }
    pick.bins = v; remember(); sync(); fig.render(draw);
  };
  const spin = spinner(row.querySelector('#ex-bins'), { min: HIST_BINS_MIN, max: HIST_BINS_MAX, step: 1, onChange: setBins });
  rng.addEventListener('input', () => setBins(Number(rng.value)));
  autoBtn.addEventListener('click', () => { pick.bins = null; remember(); sync(); fig.render(draw); });
  row.querySelectorAll('[data-hist]').forEach(b => b.addEventListener('click', () => {
    if (pick.mode === b.dataset.hist) return;
    pick.mode = b.dataset.hist; remember(); sync(); fig.render(draw);
  }));
  sync();
  registerTips(row);
}
