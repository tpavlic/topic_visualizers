// The Explore page: what the response holds and the families that can
// describe it, its descriptives overall and by a categorical predictor, its
// histogram, and the response against each predictor.

import * as state from '../state.js';
import { column, support, valuesOf, SUPPORT_LABEL, predictorColumns, groupColumns } from '../data/model.js';
import { FAMILIES, familiesFor } from '../stats/families.js';
import { summary, histogram, boxStats } from '../stats/descriptive.js';
import { binnedMeans } from '../stats/inference.js';
import { makeFigure, histogram as drawHistogram, boxPlot, intervals, exportButtons, legend } from '../ui/plots.js';
import { dataPoints, rawPoints, curveBand } from '../ui/modelplots.js';
import { datasetSelect, card, cardRow, notice } from '../ui/widgets.js';
import { installExportRow } from '../ui/exportrow.js';
import { esc, num, stat, intl, plural } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'explore';
/** The page's title. */
export const title = 'Explore';

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
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="ex-by">Descriptives by</label><select id="ex-by"></select></span>' +
    '</div></div>' +
    '<div class="sec"><div class="sec-hd">The response</div><div id="ex-resp"></div></div>' +
    '<div class="sec"><div class="sec-hd">Descriptives</div><div id="ex-desc"></div></div>' +
    '<div class="sec"><div class="sec-hd">Against each predictor</div><p class="exp-note">A continuous predictor gives a scatter with the mean of the response in ten bins of equal count; a categorical one gives a box per level, or the proportion per level for a binary response.</p><div id="ex-plots"></div></div>';
  els = { ds: root.querySelector('#ex-ds'), by: root.querySelector('#ex-by'), resp: root.querySelector('#ex-resp'), desc: root.querySelector('#ex-desc'), plots: root.querySelector('#ex-plots') };
  dsSel = datasetSelect(els.ds, { remember: { page: id, key: 'dataset' } });
  els.ds.addEventListener('change', () => { fillBy(); compute(); });
  els.by.addEventListener('change', () => { state.setPick(id, 'by', els.by.value || null); compute(); });
  installExportRow(root, id);
  state.on('datasets', () => { fillBy(); if (visible()) compute(); });
  fillBy();
  compute();
}

function visible() { return !!rootEl && rootEl.classList.contains('active'); }

/** Called each time the page is shown. */
export function onShow() { compute(); }

function current() { return state.get(els.ds.value); }

function fillBy() {
  const ds = current();
  const cats = ds ? ds.columns.filter(c => c.role !== 'ignored' && c.role !== 'response' && c.type !== 'continuous') : [];
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
  const resp = ds.columns.find(c => c.role === 'response');
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
  if (numeric) {
    const box = document.createElement('div');
    box.className = 'fig-box';
    els.desc.appendChild(box);
    const fig = makeFigure(box, { height: 230, xLabel: resp.name, yLabel: 'Frequency', title: 'Histogram of ' + resp.name });
    exportButtons(box, fig, ds.name + ' histogram');
    fig.render(f => { drawHistogram(f, histogram(y, { bins: sup === 'count' || sup === 'binary' ? Math.min(30, new Set(y).size) : undefined })); });
    figs.push(fig);
  }

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
    count: 'Start with the Poisson family; if the Pearson χ² / df on the Model page sits well above 1, the counts are overdispersed and the negative binomial family (or a Poisson-lognormal) fits them.',
    unit: 'The beta family with a logit link models a proportion that is a measurement rather than a count of successes; the normal family can serve when the values stay well inside the interval.',
    positive: 'The gamma family with a log link models a positive, right-skewed response whose spread grows with its mean; the normal family with a log link keeps the spread constant instead.',
    real: 'The normal family with an identity link is the linear model.',
    ordinal: 'The ordinal family models the cumulative probabilities of the ordered levels.'
  }[sup] || '';
}

export default { id, title, render, onShow };
