// Session restore: the loaded datasets, the shared settings, the model
// specification, and the candidate models are written to localStorage
// (through ui/store.js) after every change and read back at boot, and so a
// reload or an accidental close does not lose the data. The stored value is
// validated field by field on the way back in: anything that does not have
// the shape a dataset needs is dropped rather than trusted. Correctness
// never depends on storage; when it is unavailable, or the data are too
// large to keep, the page works on what it holds in memory.

import * as state from '../state.js';
import { makeDataset, ROLES, TYPES } from '../data/model.js';
import { save, load, removeKey, available } from './store.js';

/** The store key; ui/store.js prefixes it, giving "glmm-analyzer:session". */
export const SESSION_KEY = 'session';

/** The largest serialized session, in characters, that is written to storage. */
export const MAX_CHARS = 4 * 1024 * 1024;

/**
 * @typedef {{ available: boolean, saved: boolean, chars: number,
 *   skipped: null | 'too-large' | 'write-failed', restored: number, dropped: number }} SessionStatus
 */

/** @type {SessionStatus} */
const status = { available: false, saved: false, chars: 0, skipped: null, restored: 0, dropped: 0 };
let warned = false;
let suspended = false;
let scheduled = false;
let installed = false;

function announce() {
  state.emit('session', sessionStatus());
}

function serializeDataset(ds) {
  return {
    id: ds.id,
    name: ds.name,
    columns: ds.columns.map(c => ({ name: c.name, role: c.role, type: c.type, levels: c.levels })),
    // JSON writes NaN as null, which restores as a missing value.
    rows: ds.rows,
    source: ds.source,
    issues: ds.issues
  };
}

/**
 * The current status of session storage: whether it is available, whether
 * the last save succeeded, the size of the stored session in characters, why
 * a save was skipped, and how many datasets the last restore brought back or
 * dropped. The 'session' state event carries the same object.
 * @returns {SessionStatus}
 */
export function sessionStatus() {
  status.available = available();
  return Object.assign({}, status);
}

/**
 * Writes the loaded datasets, the settings, the spec, and the candidate
 * models to storage. A session larger than MAX_CHARS is not written, and
 * any older stored session is removed so that a reload never brings back a
 * set of data that no longer matches the page; a one-time console warning
 * says so.
 * @returns {SessionStatus}
 */
export function saveSession() {
  if (!available()) {
    status.saved = false;
    status.skipped = null;
    status.chars = 0;
    announce();
    return sessionStatus();
  }
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    settings: { level: state.settings.level, base: state.settings.base, bonfC: state.settings.bonfC, custom: state.settings.custom },
    selected: state.selected(),
    picks: state.picks,
    spec: state.copySpec(state.spec),
    models: state.models.map(m => ({ id: m.id, name: m.name, spec: m.spec })),
    datasets: state.datasets.map(serializeDataset)
  };
  let text;
  try {
    text = JSON.stringify(payload);
  } catch (err) {
    text = null;
  }
  if (text === null || text.length > MAX_CHARS) {
    removeKey(SESSION_KEY);
    status.saved = false;
    status.skipped = 'too-large';
    status.chars = text === null ? 0 : text.length;
    if (!warned) {
      warned = true;
      console.warn('The loaded data are too large to keep for session restore (' +
        Math.round(status.chars / 1024) + ' KB, over the ' + Math.round(MAX_CHARS / 1024) +
        ' KB limit); they stay in memory until the page is closed.');
    }
    announce();
    return sessionStatus();
  }
  const ok = save(SESSION_KEY, payload);
  if (!ok) removeKey(SESSION_KEY);
  status.saved = ok;
  status.skipped = ok ? null : 'write-failed';
  status.chars = text.length;
  announce();
  return sessionStatus();
}

// Coalesces a burst of events into a single write at the end of the task.
function scheduleSave() {
  if (suspended || scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    if (!suspended) saveSession();
  });
}

const isStr = x => typeof x === 'string';
const isFiniteNum = x => typeof x === 'number' && Number.isFinite(x);

function restoreDataset(o) {
  if (!o || typeof o !== 'object') return null;
  if (!isStr(o.id) || !o.id || !Array.isArray(o.columns) || !o.columns.length || !Array.isArray(o.rows)) return null;
  const columns = [];
  for (const c of o.columns) {
    if (!c || typeof c !== 'object' || !isStr(c.name) || !ROLES.includes(c.role) || !TYPES.includes(c.type)) return null;
    columns.push({ name: c.name, role: c.role, type: c.type, levels: Array.isArray(c.levels) ? c.levels.filter(isStr) : null });
  }
  const rows = [];
  for (const r of o.rows) {
    if (!Array.isArray(r) || r.length !== columns.length) return null;
    const row = [];
    for (let j = 0; j < r.length; j++) {
      const v = r[j];
      if (v === null) row.push(null);
      else if (columns[j].type === 'continuous') { if (!isFiniteNum(v)) return null; row.push(v); }
      else { if (!isStr(v)) return null; row.push(v); }
    }
    rows.push(row);
  }
  const src = o.source && typeof o.source === 'object' ? o.source : {};
  const issues = Array.isArray(o.issues)
    ? o.issues.filter(it => it && typeof it === 'object' && isFiniteNum(it.line) && isStr(it.reason))
      .map(it => ({ line: it.line, text: isStr(it.text) ? it.text : '', reason: it.reason }))
    : [];
  return makeDataset({
    id: o.id,
    name: isStr(o.name) && o.name ? o.name : 'data',
    columns, rows,
    source: { file: isStr(src.file) ? src.file : '', notes: Array.isArray(src.notes) ? src.notes.filter(isStr) : [] },
    issues
  });
}

// A stored spec, with every field checked for its shape; null when it is not one.
function restoreSpec(s) {
  if (!s || typeof s !== 'object') return null;
  const e = state.emptySpec();
  const out = {};
  for (const k of Object.keys(e)) {
    const v = s[k];
    if (k === 'terms') {
      if (!Array.isArray(v)) return null;
      const terms = [];
      for (const t of v) {
        if (isStr(t)) terms.push(t);
        else if (t && typeof t === 'object' && isStr(t.name) && isFiniteNum(t.degree)) terms.push({ name: t.name, degree: t.degree });
        else if (t && typeof t === 'object' && Array.isArray(t.of) && t.of.every(isStr)) terms.push({ of: t.of.slice() });
        else return null;
      }
      out.terms = terms;
    } else if (typeof e[k] === 'boolean') out[k] = v === true;
    else if (k === 'family') { if (!isStr(v)) return null; out[k] = v; }
    else out[k] = v === null || v === undefined ? null : (isStr(v) ? v : null);
  }
  return out;
}

/**
 * Reads the stored session and adds every dataset that passes validation
 * through `state.add`, with its id, and restores the confidence level,
 * every page's remembered settings (`state.picks`), the spec, and the
 * candidate models, followed by one more 'datasets' event of type
 * 'restore'. Datasets whose id is already loaded are skipped. Never throws:
 * a missing, unreadable, or malformed stored value restores nothing, and a
 * malformed dataset inside an otherwise good one is dropped on its own.
 * @returns {{ restored: number, dropped: number }}
 */
export function restoreSession() {
  let restored = 0, dropped = 0;
  const restoredPicks = [];
  suspended = true;
  try {
    const stored = available() ? load(SESSION_KEY) : null;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      // Picks come back before the datasets, and so a picker rebuilding itself on
      // the 'datasets' events below finds its remembered choice waiting.
      if (stored.picks && typeof stored.picks === 'object' && !Array.isArray(stored.picks)) {
        for (const page of Object.keys(stored.picks)) {
          const bag = stored.picks[page];
          if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
          for (const key of Object.keys(bag)) {
            const v = bag[key];
            const okScalar = isStr(v) || typeof v === 'number' || typeof v === 'boolean';
            const okList = Array.isArray(v) && v.every(isStr);
            if (okScalar || okList) { state.setPick(page, key, v); restoredPicks.push([page, key, v]); }
          }
        }
      }
      if (Array.isArray(stored.datasets)) {
        const seen = new Set(state.datasets.map(d => d.id));
        for (const o of stored.datasets) {
          let ds = null;
          try { ds = restoreDataset(o); } catch (err) { ds = null; }
          if (!ds || seen.has(ds.id)) { dropped++; continue; }
          seen.add(ds.id);
          state.add(ds);
          restored++;
        }
      }
      if (stored.settings && typeof stored.settings === 'object') {
        const st = stored.settings;
        if (st.custom && Number.isFinite(st.base)) state.setCustomLevel(st.base, Number.isFinite(st.bonfC) ? st.bonfC : 1);
        else state.setLevel(st.level);
      }
      if (isStr(stored.selected)) state.select(stored.selected);
      if (Array.isArray(stored.models)) {
        for (const m of stored.models) {
          const s = m && typeof m === 'object' && isStr(m.name) ? restoreSpec(m.spec) : null;
          if (s && s.dataset && state.get(s.dataset)) state.keepModel(m.name, s);
        }
      }
      const s = restoreSpec(stored.spec);
      if (s && (!s.dataset || state.get(s.dataset))) state.setSpec(s);
      // The datasets arrive one at a time, and a page answering the first
      // ones can overwrite a pick that names a dataset still to come. Once
      // all of them are back, the stored picks are set again and every page
      // is told once more, and so each settles on what was stored.
      if (restored > 0) {
        for (const [page, key, v] of restoredPicks) state.setPick(page, key, v);
        state.emit('datasets', { type: 'restore' });
      }
    }
  } catch (err) {
    // A failure part way leaves whatever was restored in place; the page
    // works on it, and the next save writes it back consistently.
  } finally {
    suspended = false;
  }
  status.restored = restored;
  status.dropped = dropped;
  return { restored, dropped };
}

/**
 * Restores the stored session and then saves after every change. Called
 * once at boot; later calls do nothing.
 * @returns {{ restored: number, dropped: number }}
 */
export function initSession() {
  if (installed) return { restored: status.restored, dropped: status.dropped };
  installed = true;
  const r = restoreSession();
  for (const ev of ['datasets', 'settings', 'picks', 'spec', 'models']) state.on(ev, scheduleSave);
  // Writing once now drops anything the restore rejected from storage and
  // records the stored size for the Storage page.
  saveSession();
  return r;
}

/**
 * Forgets the session: removes every loaded dataset, every candidate model,
 * every stored result, and every page's remembered settings, and then
 * removes the stored session. Saving resumes with the next dataset loaded.
 */
export function forgetSession() {
  suspended = true;
  try {
    for (const id of state.models.map(m => m.id)) state.dropModel(id);
    for (const id of state.datasets.map(d => d.id)) state.remove(id);
    state.setSpec(state.emptySpec());
    for (const k of Object.keys(state.results)) if (state.results[k]) state.setResult(k, null);
    // Emptied in place, after the removals, because a picker answering a
    // removal records its new (empty) value.
    for (const page of Object.keys(state.picks)) delete state.picks[page];
    state.emit('picks', { pageId: null, key: null });
  } finally {
    suspended = false;
  }
  removeKey(SESSION_KEY);
  status.saved = false;
  status.skipped = null;
  status.chars = 0;
  status.restored = 0;
  status.dropped = 0;
  announce();
}
