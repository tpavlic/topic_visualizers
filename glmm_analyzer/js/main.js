// Boot: renders every page into its section, wires the page navigation and
// the URL hash, installs the tooltips, keeps the dataset strip under the
// navigation in step with the loaded datasets, and restores the last session.

import * as state from './state.js';
import { initTabs, setAvailable, currentTab, showTab } from './ui/tabs.js';
import { initTooltips, registerTips } from './ui/tooltip.js';
import { redrawVisible } from './ui/plots.js';
import { available as storeAvailable } from './ui/store.js';
import { initSession } from './ui/session.js';
import { esc, intl, plural } from './ui/format.js';
import { canModel } from './data/model.js';

import * as importPage from './pages/import.js';
import * as explorePage from './pages/explore.js';
import * as modelPage from './pages/model.js';
import * as diagnosticsPage from './pages/diagnostics.js';
import * as predictPage from './pages/predict.js';
import * as comparePage from './pages/compare.js';
import * as testsPage from './pages/tests.js';
import * as reportPage from './pages/report.js';
import * as storagePage from './pages/storage.js';
import * as referencesPage from './pages/references.js';

// A page module may export its id, title, render, and onShow by name, or as
// one default object; either shape works here. A page divided into sections
// shown one at a time also exports `sections` ([{ id, label }]) and, if it
// needs to know when one opens, `onShowSection(id)`.
function pageOf(mod) {
  const d = mod.default && typeof mod.default === 'object' ? mod.default : {};
  return {
    id: mod.id || d.id,
    title: mod.title || d.title,
    render: mod.render || d.render || (() => {}),
    onShow: mod.onShow || d.onShow || (() => {}),
    sections: mod.sections || d.sections || null,
    onShowSection: mod.onShowSection || d.onShowSection || null
  };
}

/** The page modules, in navigation order; the analysis pages join as they are built. */
export const PAGE_MODULES = [importPage, explorePage, modelPage, diagnosticsPage, predictPage, comparePage, testsPage, reportPage, storagePage, referencesPage];
const PAGES = PAGE_MODULES.map(pageOf);
const BY_ID = new Map(PAGES.map(p => [p.id, p]));

function renderDataStrip() {
  const el = document.getElementById('data-strip');
  if (!el) return;
  const list = state.datasets;
  if (!list.length) {
    el.innerHTML = '<span class="ds-empty">No data loaded yet. Open <a href="#import">Import</a> to load a file or an example.</span>';
    return;
  }
  const chips = list.map(ds => {
    const resp = ds.columns.find(c => c.role === 'response');
    return '<span class="ds-chip"><span class="ds-chip-name">' + esc(ds.name) + '</span>' +
      (resp ? '<span class="kind-badge">' + esc(resp.name) + '</span>' : '') +
      '<span class="ds-chip-r">n = ' + intl(ds.rows.length) + '</span></span>';
  }).join('');
  el.innerHTML = '<span class="ds-count">' + esc(plural(list.length, 'dataset')) + ' loaded:</span>' + chips;
}

// Every page but Import, Storage, and References works on loaded data: a
// page's link stays gray and inert until the loaded datasets meet its
// requirement, with the tooltip saying what is missing, and goes gray again
// if a removal takes the requirement away while that page is open.
const GATES = [
  { pages: ['explore', 'model', 'diagnostics', 'predict', 'compare', 'report'],
    ok: () => state.datasets.some(d => canModel(d).ok),
    tip: 'Load a file or an example on the Import page first.' }
];
function gatePages() {
  let closeCurrent = false;
  for (const g of GATES) {
    const present = g.pages.filter(id => document.getElementById('tab-' + id));
    const disabled = !g.ok();
    setAvailable(present, disabled, g.tip);
    if (disabled && present.includes(currentTab())) closeCurrent = true;
  }
  registerTips(document.querySelector('nav.pnav'));
  if (closeCurrent) showTab('import');
}

function boot() {
  for (const p of PAGES) {
    const root = document.getElementById('tab-' + p.id);
    if (!root) continue;
    try { p.render(root); } catch (err) { console.error(err); root.innerHTML = '<p class="lede">This page could not be drawn.</p>'; }
  }

  initTooltips();
  registerTips(document.body);

  renderDataStrip();
  state.on('datasets', renderDataStrip);

  // Bring back the datasets and settings of the last visit, and keep them
  // stored from here on. Every page has rendered and subscribed by now, and so
  // each sees the restored datasets arrive through its 'datasets' listener.
  try { initSession(); } catch (err) { console.error(err); }

  if (!storeAvailable()) {
    const note = document.getElementById('store-note');
    if (note) {
      note.textContent = 'Session restore is unavailable in this context; data stays in memory until the page is closed.';
      note.hidden = false;
    }
  }

  gatePages();
  state.on('datasets', gatePages);

  initTabs({
    defaultTab: 'import',
    sections: Object.fromEntries(PAGES.filter(p => Array.isArray(p.sections) && p.sections.length).map(p => [p.id, p.sections])),
    onShow: (id, section, pageChanged) => {
      const p = BY_ID.get(id);
      if (p && pageChanged !== false) { try { p.onShow(); } catch (err) { console.error(err); } }
      if (p && section && p.onShowSection) { try { p.onShowSection(section); } catch (err) { console.error(err); } }
      // A figure drawn while its page or section was hidden had no width to measure.
      const root = document.getElementById('tab-' + id);
      if (root) requestAnimationFrame(() => redrawVisible(root));
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
