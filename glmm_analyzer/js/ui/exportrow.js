// The export row at the foot of a page: one button per result table the page
// has computed (a CSV with `#` provenance lines), any files the page adds,
// and a Print button that prints the page as shown, without the navigation.
// The row follows the page's results as they change. When the page's result
// carries `regen: { build, tooBig, files }`, a second line offers the
// scripts that regenerate its results in MATLAB, Base R, Tidy R, and
// Python, each button live only where that language has a commonly used
// routine for the model (`io/capability.js`), and the recipe is built only
// when one of those buttons is pressed.

import * as state from '../state.js';
import { datasetCsv, tableCsv, provenanceLines, downloadText, slug, csvHead } from '../io/export.js';
import { details } from './widgets.js';
import { registerTips } from './tooltip.js';
import { esc, intl, plural } from './format.js';

// The regenerate line's writers and their capability table arrive with the
// scripts; until then the line stays hidden. The two are looked up lazily
// so that this module does not import the script writers at load.
let scriptsApi = null;
/**
 * Installs the script writers the regenerate line uses:
 * `{ analysisScript, scriptFileName, ANALYSIS_WRITERS, capability }`, where
 * `capability(recipeOrSpec)` returns `{ lang: { ok, why } }`.
 * @param {object} api
 */
export function installScripts(api) { scriptsApi = api; }

const REGEN_TIP = {
  m: 'A MATLAB script that fits the same model with the Statistics and Machine Learning Toolbox, recomputes every result on this page from the data embedded in it, checks each against the value shown here, and draws the figures this view shows.',
  R: 'An R script that fits the same model, recomputes every result on this page from the data embedded in it, checks each against the value shown here, and draws the figures this view shows.',
  tidy: 'The same R analysis written the tidyverse way: the data as a tibble, summaries with dplyr, the fit through broom, and the figures with ggplot2.',
  py: 'A Python script that fits the same model with statsmodels, recomputes every result on this page from the data embedded in it, checks each against the value shown here, and draws the figures this view shows.'
};
const REGEN_HELP =
  '<p>Each script holds the data this page analyzed, every choice made above, and code that recomputes every number shown here with the language’s own fitting routine. It prints the results section by section and says at the end whether every one agrees with the value on this page; setting <code>check_details</code> at the top prints each result beside the page’s value instead. It then draws the figures this view shows.</p>' +
  '<p>A button is gray where the language has no commonly used routine for this model. The tooltip on a gray button, and the line under the buttons, say what the language lacks. R has a routine for every model this page fits, and so the R buttons are always live.</p>';

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * A timestamp for provenance lines, local time to the second.
 * @param {Date} d
 * @returns {string}
 */
export function stamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/**
 * The `#` lines a dataset's data file carries: what the dataset is, its
 * size, which column is the response and which the group, and where it came
 * from.
 * @param {object} ds
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, unknown>}
 */
export function dsProvenance(ds, extra) {
  const resp = ds.columns.find(c => c.role === 'response');
  const groups = ds.columns.filter(c => c.role === 'group').map(c => c.name);
  const preds = ds.columns.filter(c => c.role === 'predictor').map(c => c.name + ' (' + c.type + ')');
  const p = { dataset: ds.name, rows: ds.rows.length, columns: ds.columns.length };
  if (resp) p.response = resp.name;
  if (preds.length) p.predictors = preds.join(', ');
  if (groups.length) p.group = groups.join(', ');
  if (ds.source && ds.source.file) p['source file'] = ds.source.file;
  Object.assign(p, extra || {});
  p.exported = stamp(new Date());
  return p;
}

/**
 * The file name a dataset's data file takes, as the Import page writes it
 * and the regenerate scripts read it.
 * @param {object} ds
 */
export function csvFileName(ds) {
  return slug(ds.name) + '.csv';
}

/**
 * The text of a dataset's data file.
 * @param {object} ds
 * @returns {string}
 */
export function dataFileText(ds) {
  return datasetCsv(ds, dsProvenance(ds));
}

/**
 * The data file of one dataset, as a button descriptor for an export row.
 * @param {object|null} ds
 * @returns {{label: string, tip?: string, disabled?: boolean, run: () => void}[]}
 */
export function datasetFiles(ds) {
  if (!ds) return [];
  return [{ label: 'Data CSV', tip: 'The table as loaded: every column under its name, one row per observation, a missing value as an empty field, and # lines naming the response and the group.',
    run: () => downloadText(csvFileName(ds), dataFileText(ds)) }];
}

/**
 * The start of a dataset's data file, as the file writes it: the `#` lines,
 * then a table of the header and the first `n` rows, under a line saying
 * how many rows the whole file holds.
 * @param {object} ds
 * @param {number} [n]
 * @returns {string} HTML
 */
export function dataPreview(ds, n = 8) {
  const h = csvHead(dataFileText(ds), n);
  const total = h.rows.length + h.more;
  const count = total === 0 ? 'no rows'
    : h.more ? 'the first ' + intl(h.rows.length) + ' of ' + intl(total) + ' rows'
      : total === 1 ? 'its one row' : 'all ' + intl(total) + ' rows';
  return '<div class="xp-peek">' +
    '<div class="ctrl-grp-lbl">Data CSV, ' + count + '</div>' +
    '<pre class="xp-peek-notes">' + h.notes.map(l => esc('# ' + l)).join('\n') + '</pre>' +
    '<div class="scroll-box"><table class="ptab"><thead><tr>' + h.header.map(c => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
    h.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div></div>';
}

// A table name follows "Download" mid-sentence, and so its first letter is
// lowered unless the first word is an acronym or a person's name.
function lowerFirst(s) {
  s = String(s);
  if (/^(Pearson|Wald|Tukey|Bonferroni|Cook|Shapiro|Welch)\b/.test(s)) return s;
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * The `#` lines of one result table: the table, the result, when it was
 * computed, and every choice the page recorded.
 * @param {string} pageId
 * @param {object} r the page's result
 * @param {object} [table]
 */
export function resultProvenance(pageId, r, table) {
  const p = {};
  if (table) p.table = table.name;
  p.result = r.title;
  if (r.computedAt instanceof Date) p.computed = stamp(r.computedAt);
  Object.assign(p, r.provenance || {});
  return p;
}

/** One result table as CSV text with its provenance lines. */
export function tableBlock(pageId, r, t) {
  return tableCsv(t.headers || [], t.rows || [], resultProvenance(pageId, r, t));
}

// The descriptors each container's buttons were last drawn from, for the
// one click listener the container carries.
const drawnItems = new WeakMap();

/**
 * Draws file descriptors (a label, an optional tip, `disabled` with a `note`
 * saying why, `print` for the Print button, and `run`) into `container` as
 * a wrapping row of buttons, with the notes in a line under them, and
 * registers the buttons' tips. Each call replaces what the last one drew in
 * the same container.
 * @param {HTMLElement} container
 * @param {{label: string, tip?: string, disabled?: boolean, note?: string, print?: boolean, run: () => void}[]} items
 */
export function fileButtons(container, items) {
  let btns = container.querySelector(':scope > .xp-btns');
  if (!btns) {
    container.innerHTML = '<div class="xp-btns"></div><p class="muted-line xp-note" aria-live="polite" hidden></p>';
    btns = container.querySelector(':scope > .xp-btns');
    btns.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-i]');
      if (!b || b.disabled) return;
      const it = (drawnItems.get(container) || [])[Number(b.getAttribute('data-i'))];
      if (it) it.run();
    });
  }
  const note = container.querySelector(':scope > .xp-note');
  drawnItems.set(container, items);
  btns.innerHTML = items.map((it, i) =>
    '<button type="button" class="' + (it.print ? 'btn-run2' : 'xp-btn') + '" data-i="' + i + '"' + (it.disabled ? ' disabled' : '') +
    (it.tip ? ' data-tip="' + esc(it.tip) + '" data-tip-press' : '') + '>' + esc(it.label) + '</button>').join('');
  const notes = items.filter(it => it.note).map(it => it.note);
  note.textContent = notes.join(' ');
  note.hidden = !notes.length;
  registerTips(container);
}

/**
 * Installs the export row at the end of a page.
 * @param {HTMLElement} root the page's section
 * @param {string} pageId the page whose results the row offers
 * @param {{ extra?: () => {label: string, tip?: string, disabled?: boolean, note?: string, run: () => void}[],
 *   tables?: (t: object) => boolean, help?: string|(() => string), printLabel?: string }} [opts]
 * @returns {{ refresh: () => void }}
 */
export function installExportRow(root, pageId, opts = {}) {
  const row = document.createElement('div');
  row.className = 'sec xp-row';
  row.innerHTML = '<div class="sec-hd">Export</div><div class="xp-files" id="xp-' + pageId + '"></div>';
  const regen = document.createElement('div');
  regen.className = 'xp-regen';
  regen.hidden = true;
  regen.innerHTML = '<span class="xp-regen-lbl">Regenerate these results in</span><div class="xp-btns xp-regen-btns"></div><p class="muted-line xp-regen-note" aria-live="polite" hidden></p>';
  regen.appendChild(details('What these scripts regenerate', REGEN_HELP));
  const helpBox = opts.help ? details('What each data file holds', typeof opts.help === 'function' ? opts.help() : opts.help) : null;
  if (helpBox) row.appendChild(helpBox);
  row.appendChild(regen);
  root.appendChild(row);
  const files = row.querySelector('.xp-files');
  const regenBtns = regen.querySelector('.xp-regen-btns'), regenNote = regen.querySelector('.xp-regen-note');
  function refresh() {
    const items = [];
    const r = state.results[pageId];
    for (const t of (r && r.tables) || []) {
      if (opts.tables && !opts.tables(t)) continue;
      items.push({ label: 'Download ' + lowerFirst(t.name), run: () => {
        const body = provenanceLines({ exported: stamp(new Date()) }).join('\n') + '\n' + tableBlock(pageId, r, t);
        downloadText(slug(pageId) + '_' + slug(t.name) + '.csv', body);
      } });
    }
    if (opts.extra) items.push(...opts.extra());
    items.push({ label: opts.printLabel || 'Print this page', print: true, run: () => window.print() });
    const rg = r && r.regen && scriptsApi;
    regen.hidden = !rg;
    if (rg) {
      const cap = scriptsApi.capability(r.regen.spec || state.spec);
      regenBtns.innerHTML = Object.entries(scriptsApi.ANALYSIS_WRITERS).map(([k, w]) => {
        const c = cap[k] || { ok: true };
        const tip = c.ok ? REGEN_TIP[k] : c.why;
        return '<button type="button" class="xp-btn" data-lang="' + k + '"' + (c.ok ? '' : ' disabled aria-describedby="xp-cap-' + pageId + '-' + k + '"') +
          ' data-tip="' + esc(tip) + '" data-tip-press>' + esc(w.label) + '</button>' +
          (c.ok ? '' : '<span class="sr-only" id="xp-cap-' + pageId + '-' + k + '">' + esc(c.why) + '</span>');
      }).join('');
      const gray = Object.entries(cap).filter(([, c]) => !c.ok).map(([k, c]) => scriptsApi.ANALYSIS_WRITERS[k].label + ': ' + c.why);
      regenNote.textContent = gray.join(' ');
      regenNote.hidden = !gray.length;
    }
    fileButtons(files, items);
    if (typeof opts.help === 'function') helpBox.querySelector('.why-body').innerHTML = opts.help();
    registerTips(regen);
  }
  regenBtns.addEventListener('click', ev => {
    const r = state.results[pageId];
    const b = ev.target.closest('button[data-lang]');
    if (!b || b.disabled || !r || !r.regen || !scriptsApi) return;
    const lang = b.getAttribute('data-lang');
    try {
      const recipe = r.regen.build();
      downloadText(scriptsApi.scriptFileName(recipe, lang), scriptsApi.analysisScript(recipe, lang), scriptsApi.ANALYSIS_WRITERS[lang].mime + ';charset=utf-8');
    } catch (err) {
      regenNote.textContent = 'The script could not be written: ' + (err && err.message ? err.message : String(err));
      regenNote.hidden = false;
    }
  });
  state.on('results', ({ pageId: p } = {}) => { if (!p || p === pageId) refresh(); });
  state.on('datasets', refresh);
  state.on('selection', refresh);
  refresh();
  return { refresh };
}

/** `plural` re-exported for pages that build export notes. */
export { plural };
