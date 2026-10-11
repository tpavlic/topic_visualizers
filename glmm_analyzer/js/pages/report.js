// The Report page: the loaded datasets and the latest result of every
// analysis page on one page, each result preceded by the choices that
// produced it, with buttons to print it (the print stylesheet drops the
// navigation), copy it as text, or download every result table as one CSV.

import * as state from '../state.js';
import { datasetSummary } from '../data/model.js';
import { provenanceLines, downloadText } from '../io/export.js';
import { esc, stat, intl } from '../ui/format.js';
import { stamp, tableBlock } from '../ui/exportrow.js';

/** The page's hash id. */
export const id = 'report';
/** The page's title. */
export const title = 'Report';

// Results are listed in the order the pages appear in the navigation; a page
// not named here follows, in the order its result arrived.
const PAGE_ORDER = ['import', 'explore', 'model', 'diagnostics', 'predict', 'variance', 'compare', 'tests'];

let el = null;

function currentResults() {
  const keys = Object.keys(state.results).filter(k => state.results[k]);
  keys.sort((x, y) => {
    const ix = PAGE_ORDER.indexOf(x), iy = PAGE_ORDER.indexOf(y);
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
  });
  return keys.map(k => ({ pageId: k, r: state.results[k] }));
}

function datasetRows() {
  return state.datasets.map(ds => {
    const s = datasetSummary(ds);
    return [ds.name, s.nRows, s.nCols, s.response || '–', s.predictors.join(', ') || '–', s.groups.join(', ') || '–'];
  });
}
const DATASET_HEADERS = ['Dataset', 'Rows', 'Columns', 'Response', 'Predictors', 'Group'];

function htmlTable(headers, rows) {
  return '<div class="scroll-box"><table class="ptab"><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(c => '<td>' + esc(typeof c === 'number' ? stat(c, 6) : (c == null ? '' : c)) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';
}

function provEntries(r) {
  const p = r.computedAt instanceof Date ? { computed: stamp(r.computedAt) } : {};
  Object.assign(p, r.provenance || {});
  return Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);
}

function provList(r) {
  const rows = provEntries(r);
  if (!rows.length) return '';
  return '<dl class="rp-prov">' + rows.map(([k, v]) => '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>';
}

function summaryHtml(now) {
  let h = '<div class="sec rp-sec"><div class="sec-hd">Loaded datasets</div><p class="muted-line">' + esc(stamp(now)) + '</p>';
  h += state.datasets.length ? htmlTable(DATASET_HEADERS, datasetRows()) : '<p class="muted-line">No data loaded.</p>';
  h += '</div>';
  const items = currentResults();
  for (const it of items) {
    h += '<div class="sec rp-sec"><div class="sec-hd">' + esc(it.r.title) + '</div>';
    h += provList(it.r);
    if (it.r.summaryHtml) h += '<div class="rp-sum">' + it.r.summaryHtml + '</div>';
    for (const t of it.r.tables || []) h += '<div class="ctrl-grp-lbl rp-tbl">' + esc(t.name) + '</div>' + htmlTable(t.headers || [], t.rows || []);
    h += '</div>';
  }
  if (!items.length) h += '<div class="sec rp-sec"><p class="muted-line">No analysis results yet. Each analysis page adds its result here as soon as it computes one.</p></div>';
  return h;
}

// Plain text from summary markup: one line per block, table rows as
// tab-separated cells, and so a pasted table lands in spreadsheet columns.
function htmlToText(html) {
  const doc = new DOMParser().parseFromString('<!DOCTYPE html><body>' + html + '</body>', 'text/html');
  const lines = [];
  let cur = '';
  const BLOCK = /^(P|DIV|SECTION|H[1-6]|LI|UL|OL|TABLE|THEAD|TBODY|DL|DT|DD|CAPTION|FIGURE|FIGCAPTION|BLOCKQUOTE|PRE)$/;
  const flush = () => { const t = cur.replace(/[ \t \r\n]+/g, ' ').trim(); if (t) lines.push(t); cur = ''; };
  const walk = n => {
    if (n.nodeType === 3) { cur += n.nodeValue; return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'svg' || tag === 'SVG') return;
    if (tag === 'BR') { flush(); return; }
    if (tag === 'TR') {
      flush();
      lines.push(Array.from(n.children).map(c => c.textContent.replace(/\s+/g, ' ').trim()).join('\t'));
      return;
    }
    const block = BLOCK.test(tag);
    if (block) flush();
    for (const c of n.childNodes) walk(c);
    if (block) flush();
  };
  walk(doc.body);
  flush();
  return lines.join('\n');
}

function textTable(headers, rows) {
  const cell = c => (typeof c === 'number' ? stat(c, 6) : (c == null ? '' : String(c)));
  return [headers.map(cell).join('\t')].concat(rows.map(r => r.map(cell).join('\t'))).join('\n');
}

function summaryText(now) {
  const out = ['GLMM Analyzer report', stamp(now), '', 'Loaded datasets'];
  out.push(state.datasets.length ? textTable(DATASET_HEADERS, datasetRows()) : 'No data loaded.');
  for (const it of currentResults()) {
    out.push('', it.r.title);
    for (const [k, v] of provEntries(it.r)) out.push(k + ': ' + v);
    if (it.r.summaryHtml) out.push(htmlToText(it.r.summaryHtml));
    for (const t of it.r.tables || []) { out.push('', t.name); out.push(textTable(t.headers || [], t.rows || [])); }
  }
  return out.join('\n') + '\n';
}

function allCsv(now) {
  const parts = [provenanceLines({ report: 'GLMM Analyzer', exported: stamp(now), datasets: intl(state.datasets.length) }).join('\n')];
  for (const it of currentResults()) for (const t of it.r.tables || []) parts.push(tableBlock(it.pageId, it.r, t));
  return parts.join('\n\n') + '\n';
}

function refresh() {
  if (!el) return;
  const now = new Date();
  el.body.innerHTML = summaryHtml(now);
  const any = currentResults().some(it => (it.r.tables || []).length);
  el.csv.disabled = !any;
}

async function copyText() {
  const text = summaryText(new Date());
  try {
    await navigator.clipboard.writeText(text);
    el.note.textContent = 'Copied the report as text.';
  } catch (err) {
    el.note.textContent = 'The browser refused the clipboard; the text is shown below instead.';
    el.fallback.hidden = false;
    el.fallback.value = text;
    el.fallback.select();
  }
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Every analysis page’s latest result on one page, each under the choices that produced it. Print it, copy it as text that pastes into a document or a spreadsheet, or save every result table as one CSV file.</p>' +
    '<div class="xp-btns rp-btns no-print"><button type="button" class="btn-run2" id="rp-print">Print</button>' +
    '<button type="button" class="btn-run2" id="rp-copy">Copy as text</button>' +
    '<button type="button" class="btn-run2" id="rp-csv">Download every table as one CSV</button>' +
    '<span class="ctrl-note" id="rp-note" aria-live="polite"></span></div>' +
    '<textarea id="rp-fallback" class="no-print" rows="12" hidden aria-label="The report as text"></textarea>' +
    '<div id="rp-body"></div>';
  const q = s => root.querySelector(s);
  el = { body: q('#rp-body'), csv: q('#rp-csv'), note: q('#rp-note'), fallback: q('#rp-fallback') };
  q('#rp-print').addEventListener('click', () => window.print());
  q('#rp-copy').addEventListener('click', copyText);
  el.csv.addEventListener('click', () => downloadText('glmm_analyzer_report.csv', allCsv(new Date())));
  state.on('results', () => { if (root.classList.contains('active')) refresh(); });
  state.on('datasets', () => { if (root.classList.contains('active')) refresh(); });
  refresh();
}

/** Called each time the page is shown. */
export function onShow() { refresh(); }

export default { id, title, render, onShow };
