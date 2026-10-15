// The Import page: a drop zone, a file chooser, a paste box, and the bundled
// examples; the mapping dialog that assigns each column a role and a type;
// and the table of loaded datasets, where each can be renamed, exported as
// CSV, given a derived column, or removed. Every dataset enters the application through state.add,
// and so a restored session goes through the same door.

import * as state from '../state.js';
import { sniff, buildTable } from '../io/parse.js';
import { sameData, support, SUPPORT_LABEL, sortLevels, DERIVATIONS, deriveColumn, removeDerivedColumn, derivedColumns, derivationText, derivedName } from '../data/model.js';
import { orderedTerms, termVars } from '../stats/design.js';
import { EXAMPLES } from '../data/examples.js';
import { sections } from './tests.js';
import { details, issueList, notice } from '../ui/widgets.js';
import { esc, intl, plural, breakPoints } from '../ui/format.js';
import { registerTips } from '../ui/tooltip.js';
import { datasetFiles, fileButtons, dataPreview } from '../ui/exportrow.js';

/** The page's hash id. */
export const id = 'import';
/** The page's title. */
export const title = 'Import';

const ROLE_TIP = {
  response: 'The column the model explains: one value per row.',
  outcome: 'Another output measured on the same rows, which the Model page offers as the response in place of the first but never as a predictor, so that one output is not used to explain another.',
  predictor: 'A column the model uses to explain the response. A continuous predictor enters as a slope, a categorical one as a contrast against its first level, and an ordinal one through polynomial contrasts.',
  group: 'A grouping factor whose rows share something the predictors do not say: a colony, a subject, a site, a replication’s random-number seed. A random intercept per group accounts for it.',
  ignored: 'Loaded but not used by any model.'
};
const TYPE_TIP = {
  continuous: 'Numbers on a scale.',
  categorical: 'Named levels with no order; the first level in sorted order is the reference.',
  ordinal: 'Named levels in a stated order, from lowest to highest.'
};

let rootEl = null;
let els = {};
/** Files and pastes waiting for the mapping dialog, oldest first. */
const queue = [];
/** The file or paste the mapping dialog is showing or null. */
let pending = null;
/** What the last accepted import added, for the status area. */
let lastImport = null;
/** Ids of datasets whose flagged-row list is expanded in the table. */
const expanded = new Set();
/** Ids of datasets whose data file is shown in the table. */
const exportOpen = new Set();
/** A refused rename's note, shown under that dataset's name box at the next redraw only. */
let renameMsg = null;
/** Ids of datasets whose data preview is open under their data file. */
const previewOpen = new Set();
// The datasets whose Derive a column form is open, and the form's state per dataset.
const deriveOpen = new Set();
const deriveForm = new Map();
let removeAllTimer = null;

function visible() { return !!rootEl && rootEl.classList.contains('active'); }

function baseName(file) {
  const s = String(file || '').replace(/^.*[\\/]/, '');
  const k = s.lastIndexOf('.');
  return k > 0 ? s.slice(0, k) : (s || 'data');
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">Load a bundled example or your own table from a file or from pasted text. A table has one row per observation and a header row naming its columns. Before anything loads, a dialog asks which column is the response and gives every other column a role, outcome, predictor, group, or ignored, and a type, continuous, categorical, or ordinal. Every row the reader cannot use is listed with its line number and the reason, and nothing is dropped silently. A loaded dataset can also gain a derived column, the rank, natural log, square root, centered, or standardized version of one of its continuous columns, or the column centered at a value you give, from the Derive a column control on its row; the new column is data like any other, and how it was made travels with the dataset into the exported files and the regenerated scripts.</p>' +
    '<div class="sec">' +
      '<div class="sec-hd">Loaded datasets</div>' +
      '<p class="exp-note">Every loaded dataset can be saved as CSV from the Export control on its row. The file holds every column under its name, one row per observation, with a missing value as an empty field, and loads back in through this page with its roles suggested from its # lines.</p>' +
      '<div id="im-list"></div>' +
    '</div>' +
    '<div id="im-status"></div>' +
    '<div class="sec ctrl-card">' +
      '<div class="im-block">' +
        '<div class="ctrl-grp-lbl">Bundled examples</div>' +
        '<div class="ctrl-row im-row">' +
          '<span class="ctrl-pair"><label class="ctrl-lbl" for="im-ex">Load example</label><select id="im-ex"></select></span>' +
          '<button type="button" class="btn-run" id="im-ex-load">Load</button>' +
          '<button type="button" class="btn-clear" id="im-ex-map">Assign the roles myself</button>' +
        '</div>' +
        '<p class="im-ex-desc" id="im-ex-desc"></p>' +
      '</div>' +
      '<div class="im-block" id="im-formats" tabindex="-1">' +
        '<div class="ctrl-grp-lbl">Text format</div>' +
        '<p class="ctrl-note">A header row and then one row per observation. Columns may be separated by commas, tabs, semicolons, or spaces; a line starting with # is a comment; an empty cell, <code>NA</code>, or <code>NaN</code> is a missing value. A column whose cells are all numbers is read as continuous and any other as categorical, and the dialog lets you change either. Simulation output in the conventional CSV layout (<code>dataset, replication, value</code> columns) loads with the dataset as a categorical predictor and the replication as the group.</p>' +
      '</div>' +
      '<div class="im-block">' +
        '<div class="ctrl-grp-lbl">From a file</div>' +
        '<div class="im-drop" id="im-drop">' +
          '<div class="im-drop-lbl">Drop one or more files here</div>' +
          '<label class="btn-run2 im-file">or choose a file<input type="file" id="im-file" multiple accept=".csv,.txt,.tsv,.dat,.prn,text/plain,text/csv"></label>' +
          '<div class="ctrl-note im-drop-note">A plain-text file (.csv, .tsv, .txt, .dat, or .prn) with a header row and its columns separated by commas, tabs, semicolons, or spaces; save a spreadsheet as CSV first.</div>' +
        '</div>' +
      '</div>' +
      '<div class="im-block">' +
        '<label class="ctrl-grp-lbl" for="im-paste">Paste data</label>' +
        '<textarea id="im-paste" rows="5" spellcheck="false" placeholder="on_time,queue,policy,rep&#10;1,0,A,1&#10;0,4,A,1&#10;1,2,B,1"></textarea>' +
        '<div class="ctrl-row im-row"><button type="button" class="btn-run2" id="im-read">Read pasted data</button><span class="ctrl-note" id="im-paste-note"></span></div>' +
      '</div>' +
    '</div>' +
    '<div id="im-dialog"></div>' +
    '<div id="im-why"></div>';

  els = {
    drop: root.querySelector('#im-drop'),
    file: root.querySelector('#im-file'),
    paste: root.querySelector('#im-paste'),
    pasteNote: root.querySelector('#im-paste-note'),
    read: root.querySelector('#im-read'),
    ex: root.querySelector('#im-ex'),
    exLoad: root.querySelector('#im-ex-load'),
    exMap: root.querySelector('#im-ex-map'),
    exDesc: root.querySelector('#im-ex-desc'),
    dialog: root.querySelector('#im-dialog'),
    status: root.querySelector('#im-status'),
    list: root.querySelector('#im-list')
  };

  root.querySelector('#im-why').appendChild(details('Why the roles matter',
    '<p>A model explains one column, the response, by the others. The response’s values decide which families can describe it: two values call for the binomial family, counts for the Poisson or negative binomial, a proportion for the beta, positive values for the gamma or a log-normal, and anything else for the normal. The Explore page reads the response and says which families fit.</p>' +
    '<p>A group column is different from a predictor. Its levels are not of interest in themselves; they mark rows that share something, a colony, a subject, a random-number seed, and the model allows for that sharing with a random intercept rather than estimating a coefficient per level. A column with a few levels whose effects are of interest, such as a treatment, is a categorical predictor; a column with many levels that stand for sampling units is a group.</p>'));

  const drop = els.drop;
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    drop.classList.add('is-over');
  }));
  drop.addEventListener('dragleave', e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('is-over'); });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) readFiles(dt.files);
    else {
      const s = dt.getData('text/plain') || dt.getData('text');
      if (s) enqueue('dropped text', s);
    }
  });
  els.file.addEventListener('change', () => {
    if (els.file.files && els.file.files.length) readFiles(els.file.files);
    els.file.value = '';
  });

  els.read.addEventListener('click', () => {
    const s = els.paste.value;
    if (!s.trim()) { els.pasteNote.textContent = 'The box is empty; paste some data first.'; return; }
    els.pasteNote.textContent = '';
    enqueue('pasted data', s);
  });

  // Two groups, one per page that uses them: the Model page's examples in
  // the order the bundle lists them, and then the Classic tests page's small
  // datasets in that page's own section order, so a reader who came from a
  // section finds its dataset where the section sits.
  const option = ex => '<option value="' + esc(ex.id) + '">' + esc(ex.title) + '</option>';
  const tourOrder = sections.map(s => s.id);
  const tours = EXAMPLES.filter(ex => ex.tour).sort((a, b) => tourOrder.indexOf(a.tour) - tourOrder.indexOf(b.tour));
  els.ex.innerHTML = '<optgroup label="Generalized linear and mixed models">' + EXAMPLES.filter(ex => !ex.tour).map(option).join('') + '</optgroup>'
    + '<optgroup label="Classic tests, one per section">' + tours.map(option).join('') + '</optgroup>';
  const showDesc = () => {
    const ex = EXAMPLES.find(x => x.id === els.ex.value);
    els.exDesc.textContent = ex ? ex.description : '';
  };
  els.ex.addEventListener('change', showDesc);
  showDesc();
  els.exLoad.addEventListener('click', () => loadExample(els.ex.value));
  els.exMap.addEventListener('click', () => {
    const ex = EXAMPLES.find(x => x.id === els.ex.value);
    if (ex) enqueue(ex.file, ex.text, ex.mapping);
  });

  state.on('datasets', () => { if (visible()) renderList(); });
  renderList();
  renderDialog();
  renderStatus();
}

/** Called each time the page is shown. */
export function onShow() {
  renderList();
}

// ── Reading input ───────────────────────────────────────────────────────

function readFiles(fileList) {
  const files = Array.from(fileList);
  Promise.all(files.map(f => f.text().then(text => ({ name: f.name, text }), err => ({ name: f.name, error: err }))))
    .then(list => {
      for (const it of list) {
        if (it.error) {
          lastImport = { error: 'The file ' + it.name + ' could not be read: ' + (it.error.message || it.error) + '.' };
          renderStatus();
        } else {
          enqueue(it.name, it.text);
        }
      }
    });
}

// Queues one text for the mapping dialog and shows it when nothing else is
// waiting. `given` is a mapping to start from (an example's).
function enqueue(fileName, text, given) {
  queue.push({ fileName, text, given });
  if (!pending) nextPending();
  else updateWaiting();
}

function updateWaiting() {
  const w = els.dialog && els.dialog.querySelector('#im-waiting');
  if (w) w.textContent = queue.length ? '(' + plural(queue.length, 'more file') + ' waiting)' : '';
}

function nextPending() {
  const it = queue.shift();
  if (!it) { pending = null; renderDialog(); return; }
  const name = (it.given && it.given.name) || (it.fileName === 'pasted data' || it.fileName === 'dropped text' ? it.fileName : baseName(it.fileName));
  const sn = sniff(it.text, { name });
  const columns = {};
  for (const h of sn.header) {
    const g = it.given && it.given.columns && it.given.columns[h];
    const s = sn.suggested.columns[h] || { role: 'predictor', type: 'continuous' };
    columns[h] = { role: g ? g.role : s.role, type: g ? g.type : s.type, levels: g && Array.isArray(g.levels) ? g.levels.slice() : null };
  }
  pending = {
    fileName: it.fileName,
    text: it.text,
    sniffed: sn,
    mapping: { name, response: it.given && it.given.response && sn.header.includes(it.given.response) ? it.given.response : sn.suggested.response, columns }
  };
  if (pending.mapping.response) columns[pending.mapping.response].role = 'response';
  renderDialog();
  if (els.dialog.firstChild && els.dialog.scrollIntoView && visible()) {
    els.dialog.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function loadExample(exId) {
  const ex = EXAMPLES.find(x => x.id === exId);
  if (!ex) return;
  try {
    const sn = sniff(ex.text, { name: ex.mapping.name });
    const res = buildTable(sn, ex.mapping);
    res.dataset.source.file = ex.file;
    const { added, skipped } = addNew([res.dataset]);
    lastImport = { what: 'the example “' + ex.title + '”', datasets: added, skipped, issues: res.issues };
  } catch (err) {
    lastImport = { error: 'The example could not be loaded: ' + err.message };
  }
  renderStatus();
}

// Adds the datasets that are not already loaded with the same data, selects
// the first of them (or the loaded copy of the first duplicate), and returns
// what was added and what was skipped for the status box.
function addNew(list) {
  const added = [], skipped = [];
  for (const ds of list) {
    const dup = state.datasets.find(d => sameData(d, ds));
    if (dup) skipped.push({ name: ds.name, as: dup });
    else { state.add(ds); added.push(ds); }
  }
  if (added.length) state.select(added[0].id);
  else if (skipped.length) state.select(skipped[0].as.id);
  return { added, skipped };
}

// ── The mapping dialog ──────────────────────────────────────────────────

// The distinct non-missing values of a column, sorted, for the level-order box.
function columnLevels(h) {
  const sn = pending.sniffed;
  const j = sn.header.indexOf(h);
  const vals = sn.rows.filter(r => r.ok).map(r => r.cells[j].trim()).filter(c => c !== '' && !/^(na|nan|n\/a|null|none|\.|\?)$/i.test(c));
  return sortLevels(vals);
}

// What is wrong with the current mapping, as a sentence, or null.
function mappingProblem() {
  const sn = pending.sniffed, m = pending.mapping;
  if (sn.noHeader) return 'The first row holds only numbers; a table needs a header row naming its columns.';
  if (!m.response || !sn.header.includes(m.response)) return 'Choose the response column.';
  const rc = m.columns[m.response];
  if (rc.type === 'continuous' && sn.types[sn.header.indexOf(m.response)] !== 'continuous') {
    const j = sn.header.indexOf(m.response);
    const bad = sn.rows.filter(r => r.ok && r.vals[j] === null && r.cells[j].trim() !== '' && !/^(na|nan|n\/a|null|none|\.|\?)$/i.test(r.cells[j].trim()));
    if (bad.length === sn.rows.filter(r => r.ok).length) return 'The response column ' + m.response + ' holds no numbers; set its type to categorical or ordinal, or choose another column.';
  }
  for (const h of sn.header) {
    const c = m.columns[h];
    if (c.type === 'ordinal' && c.role !== 'ignored') {
      const have = columnLevels(h);
      const given = (c.levels || []).filter(l => have.includes(l));
      if (given.length !== have.length) return 'The ordinal column ' + h + ' needs every level in its order box: ' + have.filter(l => !given.includes(l)).map(l => '"' + l + '"').join(', ') + ' ' + (have.length - given.length === 1 ? 'is' : 'are') + ' missing.';
    }
  }
  return null;
}

function trialBuild() {
  const m = pending.mapping;
  const mm = { name: m.name, response: m.response, columns: {} };
  for (const [h, c] of Object.entries(m.columns)) mm.columns[h] = { role: c.role, type: c.type, levels: c.type === 'ordinal' ? c.levels : undefined };
  return buildTable(pending.sniffed, mm);
}

function renderDialog() {
  const box = els.dialog;
  if (!box) return;
  box.innerHTML = '';
  if (!pending) return;
  const sn = pending.sniffed, m = pending.mapping;
  const usable = sn.rows.filter(r => r.ok).length;
  const waiting = ' <span class="ctrl-note" id="im-waiting">' + (queue.length ? '(' + plural(queue.length, 'more file') + ' waiting)' : '') + '</span>';

  const sec = document.createElement('div');
  sec.className = 'sec im-dialog';
  sec.setAttribute('role', 'region');
  sec.setAttribute('aria-label', 'Assign roles');

  const facts = [
    ['File', esc(pending.fileName)],
    ['Delimiter', esc(sn.delimiterName)],
    ['Header', sn.noHeader ? 'none' : esc(sn.header.join(', '))],
    ['Data rows', intl(usable) + ' usable of ' + intl(sn.rows.length)],
    ['Blank lines', intl(sn.blanks)],
    ['Comment lines', intl(sn.comments)],
    ['Malformed rows', intl(sn.issues.length)]
  ];
  let html = '<div class="sec-hd">Assign roles' + waiting + '</div>' +
    '<dl class="im-facts">' + facts.map(f => '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>').join('') + '</dl>';

  const prev = sn.rows.slice(0, 8);
  const allCols = Array.from({ length: sn.nCols }, (_, j) => j);
  const heads = allCols.map(j => '<th>' + esc(sn.header[j]) + '</th>').join('');
  const body = prev.map(r => '<tr' + (r.ok ? '' : ' class="im-bad"') + '><td>' + intl(r.line) + '</td>' +
    allCols.map(j => '<td>' + esc(r.cells[j] !== undefined ? r.cells[j] : '') + '</td>').join('') +
    '<td>' + (r.ok ? 'read' : 'rejected') + '</td></tr>').join('');
  html += '<div class="ctrl-grp-lbl">First ' + plural(prev.length, 'row') + ' of ' + intl(sn.rows.length) + '</div>' +
    '<div class="scroll-box im-prev"><table class="ptab"><thead><tr><th>Line</th>' + heads + '<th>Status</th></tr></thead><tbody>' + body + '</tbody></table></div>';

  if (!sn.noHeader) {
    html += '<div class="ctrl-grp-lbl im-gap">Columns</div>' +
      '<div class="scroll-box"><table class="ptab im-roles-tab"><thead><tr><th>Column</th><th>Read as</th><th>Role</th><th>Type</th><th>Levels</th></tr></thead><tbody>' +
      sn.header.map((h, j) => {
        const c = m.columns[h];
        const roleOpts = ['response', 'outcome', 'predictor', 'group', 'ignored'].map(r => '<option value="' + r + '"' + (c.role === r ? ' selected' : '') + '>' + r + '</option>').join('');
        const typeOpts = ['continuous', 'categorical', 'ordinal'].map(t => '<option value="' + t + '"' + (c.type === t ? ' selected' : '') + '>' + t + '</option>').join('');
        return '<tr data-col="' + esc(h) + '"><td class="im-col-name">' + esc(h) + '</td><td>' + esc(sn.types[j]) + '</td>' +
          '<td><select class="im-role" aria-label="Role of ' + esc(h) + '">' + roleOpts + '</select></td>' +
          '<td><select class="im-type" aria-label="Type of ' + esc(h) + '">' + typeOpts + '</select></td>' +
          '<td class="im-levels"></td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="ctrl-note">' + ['response', 'outcome', 'predictor', 'group', 'ignored'].map(r => '<b>' + r + '</b>: ' + esc(ROLE_TIP[r])).join(' ') + '</p>' +
      '<p class="ctrl-note">' + ['continuous', 'categorical', 'ordinal'].map(t => '<b>' + t + '</b>: ' + esc(TYPE_TIP[t])).join(' ') + '</p>';
  }

  html += '<div class="ctrl-row im-gap">' +
    '<span class="ctrl-pair"><label class="ctrl-lbl" for="im-name">Display name</label><input type="text" id="im-name" class="txt-inp" autocomplete="off" spellcheck="false"></span>' +
    '</div>' +
    '<p class="im-preview" id="im-preview" aria-live="polite"></p>' +
    '<div id="im-issues"></div>' +
    '<div class="im-accept-row"><button type="button" class="btn-run" id="im-accept">Accept</button>' +
    '<button type="button" class="btn-clear" id="im-cancel">Cancel</button>' +
    '<span class="im-need" id="im-need" aria-live="polite"></span></div>';

  sec.innerHTML = html;
  box.appendChild(sec);

  const q = s => sec.querySelector(s);
  sec.querySelectorAll('tr[data-col]').forEach(tr => {
    const h = tr.getAttribute('data-col');
    const c = m.columns[h];
    const role = tr.querySelector('.im-role'), type = tr.querySelector('.im-type'), lv = tr.querySelector('.im-levels');
    const drawLevels = () => {
      lv.innerHTML = '';
      if (c.type === 'continuous') { lv.innerHTML = '<span class="muted-line">–</span>'; return; }
      const have = columnLevels(h);
      if (c.type === 'categorical') { lv.innerHTML = '<span class="ctrl-note">' + esc(have.slice(0, 6).join(', ') + (have.length > 6 ? ', and ' + intl(have.length - 6) + ' more' : '')) + ' (' + plural(have.length, 'level') + ', reference ' + esc(have[0] || '') + ')</span>'; return; }
      if (!c.levels || !c.levels.length) c.levels = have.slice();
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'txt-inp im-level-order'; inp.value = c.levels.join(', ');
      inp.setAttribute('aria-label', 'Level order of ' + h + ', lowest first, separated by commas');
      inp.addEventListener('input', () => { c.levels = inp.value.split(',').map(s => s.trim()).filter(Boolean); updateDialog(); });
      lv.appendChild(inp);
      const note = document.createElement('span');
      note.className = 'ctrl-note';
      note.textContent = ' lowest first';
      lv.appendChild(note);
    };
    role.addEventListener('change', () => {
      if (role.value === 'response') {
        // The old response steps back to an outcome where the table has others, and to a predictor where it has none.
        if (m.response && m.response !== h) m.columns[m.response].role = Object.entries(m.columns).some(([k, x]) => k !== h && x.role === 'outcome') ? 'outcome' : 'predictor';
        m.response = h;
      } else if (m.response === h) m.response = null;
      c.role = role.value;
      renderDialog();
    });
    type.addEventListener('change', () => { c.type = type.value; drawLevels(); updateDialog(); });
    drawLevels();
  });
  const nm = q('#im-name');
  nm.value = m.name;
  nm.addEventListener('input', () => { m.name = nm.value; updateDialog(); });
  q('#im-accept').addEventListener('click', accept);
  q('#im-cancel').addEventListener('click', () => { nextPending(); });
  updateDialog();
  registerTips(sec);
}

function updateDialog() {
  const sec = els.dialog.querySelector('.im-dialog');
  if (!sec || !pending) return;
  const sn = pending.sniffed, m = pending.mapping;
  const problem = mappingProblem();
  const accept = sec.querySelector('#im-accept');
  const need = sec.querySelector('#im-need');
  const prevEl = sec.querySelector('#im-preview');
  const issuesEl = sec.querySelector('#im-issues');
  issuesEl.innerHTML = '';
  let issues = sn.issues;
  let ok = !problem;
  if (ok) {
    try {
      const res = trialBuild();
      issues = res.issues;
      const ds = res.dataset;
      if (!ds.rows.length) { ok = false; need.textContent = 'No usable rows remain.'; prevEl.textContent = ''; }
      else {
        need.textContent = '';
        const resp = ds.columns.find(c => c.role === 'response');
        const sup = support(resp, ds.rows.map(r => r[ds.columns.indexOf(resp)]));
        const preds = ds.columns.filter(c => c.role === 'predictor').map(c => c.name);
        const groups = ds.columns.filter(c => c.role === 'group').map(c => c.name);
        const outs = ds.columns.filter(c => c.role === 'outcome').map(c => c.name);
        prevEl.textContent = 'Accepting adds ' + ds.name + ': ' + plural(ds.rows.length, 'row') + ', the response ' + resp.name + ' (' + SUPPORT_LABEL[sup] + ')' +
          (outs.length ? ', ' + plural(outs.length, 'other outcome') + ' (' + outs.join(', ') + ')' : '') +
          (preds.length ? ', ' + plural(preds.length, 'predictor') + ' (' + preds.join(', ') + ')' : ', no predictors') +
          (groups.length ? ', and the group ' + groups.join(' nested in ') : '') + '.';
      }
    } catch (err) { ok = false; need.textContent = err.message; prevEl.textContent = ''; }
  } else { need.textContent = problem; prevEl.textContent = ''; }
  accept.disabled = !ok;
  if (issues.length) {
    const n = notice('warn', '<p>Under this mapping, ' + esc(plural(issues.length, 'row is', 'rows are')) + ' flagged. Open the list for each one’s line number and the reason.</p>');
    n.querySelector('.notice-body').appendChild(issueList(issues));
    issuesEl.appendChild(n);
  } else issuesEl.appendChild(issueList([]));
}

function accept() {
  if (!pending || mappingProblem()) return;
  let res;
  try { res = trialBuild(); } catch (err) { els.dialog.querySelector('#im-need').textContent = err.message; return; }
  if (!res.dataset.rows.length) return;
  res.dataset.source.file = pending.fileName;
  const { added, skipped } = addNew([res.dataset]);
  lastImport = {
    what: pending.fileName === 'pasted data' || pending.fileName === 'dropped text' ? 'the ' + pending.fileName : pending.fileName,
    datasets: added, skipped, issues: res.issues
  };
  renderStatus();
  nextPending();
}

// ── Status of the last import ───────────────────────────────────────────

function renderStatus() {
  const box = els.status;
  if (!box) return;
  box.innerHTML = '';
  if (!lastImport) return;
  if (lastImport.error) { box.appendChild(notice('warn', esc(lastImport.error))); return; }
  const skipped = lastImport.skipped || [];
  const names = lastImport.datasets.map(ds => '<b>' + esc(ds.name) + '</b> (n = ' + intl(ds.rows.length) + ')').join(', ');
  let html = lastImport.datasets.length
    ? '<p>Added ' + plural(lastImport.datasets.length, 'dataset') + ' from ' + esc(lastImport.what) + ': ' + names + '. Open <a href="#explore">Explore</a> to look at ' + (lastImport.datasets.length === 1 ? 'it' : 'them') + ', or <a href="#model">Model</a> to fit one.</p>'
    : '<p>Nothing was added from ' + esc(lastImport.what) + '.</p>';
  for (const sk of skipped) {
    html += '<p><b>' + esc(sk.name) + '</b> is already loaded' + (sk.as.name === sk.name ? '' : ' as <b>' + esc(sk.as.name) + '</b>') + ', with the same data, and was not added again.</p>';
  }
  box.appendChild(notice('info', html));
  if (lastImport.issues.length) {
    const n = notice('warn', '<p>' + esc(plural(lastImport.issues.length, 'row was', 'rows were')) + ' flagged in ' + esc(lastImport.what) + '. Open the list for each one’s line number and the reason.</p>');
    n.querySelector('.notice-body').appendChild(issueList(lastImport.issues));
    box.appendChild(n);
  }
}

// ── The loaded datasets ─────────────────────────────────────────────────

// Whether a model specification names a column.
function specUses(s, name) {
  if (!s) return false;
  if (s.response === name || s.group === name || s.nested === name || s.slope === name) return true;
  return orderedTerms(s).some(t => termVars(t).includes(name));
}

// The Derive a column form under a dataset's row: the source column, the
// transform, the new column's name and role, and the derived columns the
// dataset already has, each removable.
function deriveBox(ds) {
  const box = document.createElement('div');
  box.className = 'im-dv-box';
  const sources = ds.columns.filter(c => c.type === 'continuous');
  const f = deriveForm.get(ds.id) || { of: sources[0] ? sources[0].name : '', transform: 'rank', name: '', edited: false, role: 'predictor', atText: '', message: null };
  deriveForm.set(ds.id, f);
  if (!sources.some(c => c.name === f.of)) { f.of = sources[0] ? sources[0].name : ''; f.edited = false; }
  if (!f.edited) f.name = f.of ? derivedName(f.of, f.transform) : '';
  const opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
  box.innerHTML =
    '<div class="ctrl-grp-lbl">Derived column</div>' +
    (sources.length ? '<div class="ctrl-row im-dv-form">' +
      '<label>From <select class="im-dv-of" aria-label="Source column">' + sources.map(c => opt(c.name, c.name, c.name === f.of)).join('') + '</select></label>' +
      '<label>Transform <select class="im-dv-tr" aria-label="Transform">' + Object.keys(DERIVATIONS).map(k => opt(k, DERIVATIONS[k].label, k === f.transform)).join('') + '</select></label>' +
      '<label class="im-dv-at"' + (DERIVATIONS[f.transform].takesValue ? '' : ' hidden') + '>At <input type="text" class="txt-inp im-dv-atv" inputmode="decimal" autocomplete="off" spellcheck="false" aria-label="The value to center at"></label>' +
      '<label>Name <input type="text" class="txt-inp im-dv-name" aria-label="Name of the derived column"></label>' +
      '<label>Role <select class="im-dv-role" aria-label="Role of the derived column">' + opt('predictor', 'predictor', f.role === 'predictor') + opt('response', 'response', f.role === 'response') + opt('outcome', 'outcome', f.role === 'outcome') + '</select></label>' +
      '<button type="button" class="btn-run2 im-dv-add">Add the column</button>' +
    '</div>' : '<p class="exp-note">This dataset has no continuous column to derive from.</p>') +
    '<div class="im-dv-msg"></div>' +
    '<div class="im-dv-list"></div>';
  const q = sel => box.querySelector(sel);
  if (sources.length) {
    q('.im-dv-name').value = f.name;
    q('.im-dv-of').addEventListener('change', e => { f.of = e.target.value; if (!f.edited) { f.name = derivedName(f.of, f.transform); q('.im-dv-name').value = f.name; } });
    q('.im-dv-tr').addEventListener('change', e => {
      f.transform = e.target.value;
      if (!f.edited) { f.name = derivedName(f.of, f.transform); q('.im-dv-name').value = f.name; }
      q('.im-dv-at').hidden = !DERIVATIONS[f.transform].takesValue;
    });
    q('.im-dv-atv').value = f.atText;
    q('.im-dv-atv').addEventListener('input', e => { f.atText = e.target.value; });
    q('.im-dv-name').addEventListener('input', e => { f.name = e.target.value; f.edited = e.target.value.trim() !== '' && e.target.value !== derivedName(f.of, f.transform); });
    q('.im-dv-role').addEventListener('change', e => { f.role = e.target.value; });
    q('.im-dv-add').dataset.focus = 'dvadd:' + ds.id;
    q('.im-dv-add').addEventListener('click', () => {
      // A blank box is no value at all, never 0.
      const at = f.atText.trim() === '' ? NaN : Number(f.atText);
      const r = deriveColumn(ds, { of: f.of, transform: f.transform, name: f.name, role: f.role, at });
      if (!r.ok) { f.message = r.reason; renderList('dvadd:' + ds.id); return; }
      f.message = null; f.edited = false; f.name = '';
      state.emit('datasets', { type: 'change', id: ds.id });
      renderList('dvadd:' + ds.id);
    });
  }
  if (f.message) q('.im-dv-msg').appendChild(notice('warn', esc(f.message)));
  const list = q('.im-dv-list');
  const der = derivedColumns(ds);
  if (der.length) {
    const ul = document.createElement('ul');
    ul.className = 'im-dv-items';
    for (const c of der) {
      const li = document.createElement('li');
      li.innerHTML = '<code>' + esc(derivationText(c)) + '</code> <span class="kind-badge">' + esc(c.role) + '</span> ';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'im-link';
      b.textContent = 'Remove';
      b.setAttribute('aria-label', 'Remove the derived column ' + c.name);
      b.addEventListener('click', () => {
        if (!removeDerivedColumn(ds, c.name)) return;
        // A kept model or the current specification naming the column no longer fits the data.
        for (const m of state.models.filter(x => x.spec.dataset === ds.id && specUses(x.spec, c.name))) state.dropModel(m.id);
        if (state.spec.dataset === ds.id && specUses(state.spec, c.name)) state.setSpec(state.emptySpec());
        state.emit('datasets', { type: 'change', id: ds.id });
        renderList('dv:' + ds.id);
      });
      li.appendChild(b);
      ul.appendChild(li);
    }
    list.appendChild(ul);
  }
  return box;
}

function renderList() {
  const box = els.list;
  if (!box) return;
  const active = document.activeElement;
  const focusKey = active && box.contains(active) && active.dataset ? active.dataset.focus || null : null;
  box.innerHTML = '';
  const list = state.datasets;
  for (const set of [expanded, exportOpen, previewOpen]) {
    for (const idx of Array.from(set)) if (!list.some(d => d.id === idx)) set.delete(idx);
  }
  if (!list.length) {
    box.innerHTML = '<p class="muted-line">No datasets loaded yet. Load a file, paste data, or load an example below.</p>';
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'tab-wrap im-ds-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'ptab im-ds-tab';
  tbl.innerHTML = '<thead><tr><th>Name</th><th>Rows</th><th>Response</th><th>Predictors</th><th>Group</th><th>Source</th><th>Flagged rows</th><th class="no-print"><span class="sr-only">Export, derive, or remove</span></th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const ds of list) {
    const tr = document.createElement('tr');
    const nIss = ds.issues.length;
    const resp = ds.columns.find(c => c.role === 'response');
    const preds = ds.columns.filter(c => c.role === 'predictor').map(c => c.name + ' <span class="kind-badge">' + c.type + '</span>');
    const groups = ds.columns.filter(c => c.role === 'group').map(c => c.name);
    const outs = ds.columns.filter(c => c.role === 'outcome').map(c => c.name);
    tr.innerHTML =
      '<td><input type="text" class="txt-inp im-name" aria-label="Display name of ' + esc(ds.name) + '"></td>' +
      '<td>' + intl(ds.rows.length) + '</td>' +
      '<td>' + (resp ? esc(resp.name) : '–') + (outs.length ? ' <span class="im-outcomes">(other outcomes: ' + esc(outs.join(', ')) + ')</span>' : '') + '</td>' +
      '<td class="im-src">' + (preds.length ? preds.map(p => p.replace(/^([^ ]+)/, (s) => esc(s))).join(', ') : '–') + '</td>' +
      '<td>' + (groups.length ? esc(groups.join(' / ')) : '–') + '</td>' +
      '<td class="im-src">' + breakPoints(esc(ds.source.file || '–')) + derivedColumns(ds).map(c => '<span class="im-derived">' + esc(derivationText(c)) + '</span>').join('') + '</td>' +
      '<td class="im-rej"></td>' +
      '<td class="no-print im-acts"><button type="button" class="im-link im-xp"></button><button type="button" class="im-link im-dv">Derive a column</button>' +
      '<button type="button" class="btn-clear im-rm">Remove</button></td>';
    const inp = tr.querySelector('.im-name');
    inp.value = ds.name;
    inp.dataset.focus = 'name:' + ds.id;
    if (renameMsg && renameMsg.id === ds.id) {
      const n = document.createElement('span');
      n.className = 'im-name-note';
      n.setAttribute('role', 'status');
      n.textContent = renameMsg.text;
      inp.after(n);
    }
    const commit = () => {
      const v = inp.value.trim();
      if (!v) { inp.value = ds.name; return; }
      if (v !== ds.name && !state.rename(ds.id, v)) {
        inp.value = ds.name;
        renameMsg = { id: ds.id, text: 'Another dataset is named ' + v + '; dataset names must differ.' };
        renderList();
      }
    };
    inp.addEventListener('change', () => setTimeout(commit, 0));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
    const rej = tr.querySelector('.im-rej');
    if (nIss) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'im-link';
      b.textContent = 'Rows flagged: ' + intl(nIss);
      b.setAttribute('aria-expanded', String(expanded.has(ds.id)));
      b.dataset.focus = 'rej:' + ds.id;
      b.addEventListener('click', () => { if (expanded.has(ds.id)) expanded.delete(ds.id); else expanded.add(ds.id); renderList(); });
      rej.appendChild(b);
    } else rej.textContent = 'none';
    const xp = tr.querySelector('.im-xp');
    xp.textContent = 'Export';
    xp.setAttribute('aria-label', 'Export ' + ds.name);
    xp.setAttribute('aria-expanded', String(exportOpen.has(ds.id)));
    xp.dataset.focus = 'xp:' + ds.id;
    xp.addEventListener('click', () => { if (exportOpen.has(ds.id)) exportOpen.delete(ds.id); else exportOpen.add(ds.id); renderList(); });
    const dv = tr.querySelector('.im-dv');
    dv.setAttribute('aria-label', 'Derive a column of ' + ds.name);
    dv.setAttribute('aria-expanded', String(deriveOpen.has(ds.id)));
    dv.dataset.focus = 'dv:' + ds.id;
    dv.addEventListener('click', () => { if (deriveOpen.has(ds.id)) deriveOpen.delete(ds.id); else deriveOpen.add(ds.id); renderList(); });
    const rm = tr.querySelector('.im-rm');
    rm.dataset.focus = 'rm:' + ds.id;
    rm.addEventListener('click', () => { expanded.delete(ds.id); exportOpen.delete(ds.id); previewOpen.delete(ds.id); deriveOpen.delete(ds.id); deriveForm.delete(ds.id); state.remove(ds.id); });
    tb.appendChild(tr);
    if (expanded.has(ds.id) && nIss) {
      const er = document.createElement('tr');
      er.className = 'im-exp-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      const il = issueList(ds.issues);
      if (il.tagName === 'DETAILS') il.open = true;
      td.appendChild(il);
      er.appendChild(td);
      tb.appendChild(er);
    }
    if (exportOpen.has(ds.id)) {
      const er = document.createElement('tr');
      er.className = 'im-exp-row no-print';
      const td = document.createElement('td');
      td.colSpan = 8;
      const inner = document.createElement('div');
      inner.className = 'im-xp-box';
      const files = document.createElement('div');
      files.setAttribute('role', 'group');
      files.setAttribute('aria-label', 'Data file of ' + ds.name);
      inner.appendChild(files);
      const peek = details('Preview the data', '');
      peek.classList.add('xp-peek-box');
      peek.querySelector('summary').dataset.focus = 'peek:' + ds.id;
      const fill = () => { peek.querySelector('.why-body').innerHTML = peek.open ? dataPreview(ds) : ''; };
      peek.open = previewOpen.has(ds.id);
      fill();
      peek.addEventListener('toggle', () => { if (peek.open) previewOpen.add(ds.id); else previewOpen.delete(ds.id); fill(); });
      inner.appendChild(peek);
      td.appendChild(inner);
      er.appendChild(td);
      tb.appendChild(er);
      fileButtons(files, datasetFiles(ds));
    }
    if (deriveOpen.has(ds.id)) {
      const er = document.createElement('tr');
      er.className = 'im-exp-row no-print';
      const td = document.createElement('td');
      td.colSpan = 8;
      td.appendChild(deriveBox(ds));
      er.appendChild(td);
      tb.appendChild(er);
    }
  }
  tbl.appendChild(tb);
  wrap.appendChild(tbl);
  box.appendChild(wrap);
  renameMsg = null;

  const row = document.createElement('div');
  row.className = 'ctrl-row im-rm-all no-print';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'btn-clear';
  all.textContent = 'Remove all';
  all.addEventListener('click', () => {
    if (all.dataset.armed === '1') {
      clearTimeout(removeAllTimer);
      expanded.clear();
      for (const ds of state.datasets.slice()) state.remove(ds.id);
      return;
    }
    all.dataset.armed = '1';
    all.textContent = 'Click again to remove all ' + plural(state.datasets.length, 'dataset');
    clearTimeout(removeAllTimer);
    removeAllTimer = setTimeout(() => { if (!all.isConnected) return; all.dataset.armed = ''; all.textContent = 'Remove all'; }, 3000);
  });
  row.appendChild(all);
  box.appendChild(row);

  if (focusKey) {
    const again = Array.from(box.querySelectorAll('[data-focus]')).find(e => e.dataset.focus === focusKey);
    if (again) again.focus();
  }
}

export default { id, title, render, onShow };
