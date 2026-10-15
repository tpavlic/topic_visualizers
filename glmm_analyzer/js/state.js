// The application's shared state: the loaded datasets, the one a page last
// selected, the settings every page reads (the confidence level), the model
// specification the analysis pages work on, and the candidate models kept
// for comparison. Pages read `datasets`, `settings`, and `spec` directly and
// subscribe to changes with `on`. The arrays and objects are mutated in place
// and never replaced, and so a reference taken at import time stays current.

/** @typedef {import('./data/model.js').Dataset} Dataset */

import { uniqueName } from './data/model.js';

/**
 * A model specification. `terms` lists the fixed terms: a predictor's name, a
 * polynomial `{ name, degree }`, or an interaction `{ of: [name, name] }`.
 * `group` names the grouping factor of the random intercept or is null;
 * `nested` a second group column nested in it or null; `slope` the
 * predictor whose effect varies by group or null; `olre` adds an
 * observation-level random intercept (the Poisson-lognormal); `reml` applies
 * to the normal family only.
 * @typedef {{ dataset: string|null, response: string|null, family: string, link: string|null,
 *   terms: (string|{name: string, degree: number}|{of: string[]})[], group: string|null,
 *   nested: string|null, slope: string|null, olre: boolean, reml: boolean }} Spec
 */

/** Every loaded dataset, in the order it was added. */
export const datasets = [];

/** Settings shared by every page. `level` is 0.90, 0.95, or 0.99. */
// `level` is the per-interval level every page reads. `base` is the level
// the reader stated and `bonfC` the Bonferroni count it is divided by:
// level = 1 − (1 − base)/bonfC, so that C hand-made statements hold jointly
// at `base`.
export const settings = { level: 0.95, base: 0.95, bonfC: 1, custom: false };

/** The confidence levels the page offers. */
export const LEVELS = [0.90, 0.95, 0.99];

/** A fresh, empty specification. */
export function emptySpec() {
  return { dataset: null, response: null, family: 'normal', link: null, terms: [], group: null, nested: null, slope: null, olre: false, reml: false };
}

/** The model specification the analysis pages work on. */
export const spec = emptySpec();

/**
 * The candidate models kept for the Compare page: each a name and a copy of
 * the spec it was kept with. Fits are not kept; a page refits on demand.
 * @type {{ id: string, name: string, spec: Spec }[]}
 */
export const models = [];

let selectedId = null;
let counter = 0;
const listeners = {};

/**
 * Subscribes to an event: 'datasets' (added, removed, renamed), 'selection'
 * (the selected dataset changed), 'settings' (the level changed), 'results'
 * (a page stored a new result), 'picks', 'spec' (the model specification
 * changed), or 'models' (the candidate list changed).
 * @param {'datasets'|'selection'|'settings'|'results'|'picks'|'spec'|'models'|'session'} event
 * @param {(payload: *) => void} fn
 * @returns {() => void} a function that unsubscribes
 */
export function on(event, fn) {
  if (!listeners[event]) listeners[event] = new Set();
  listeners[event].add(fn);
  return () => listeners[event].delete(fn);
}

/**
 * Calls every listener of `event` with `payload`. One failing listener does
 * not stop the others; its error is reported on the console.
 * @param {string} event
 * @param {*} [payload]
 */
export function emit(event, payload) {
  const set = listeners[event];
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(payload); } catch (err) { console.error(err); }
  }
}

/**
 * Adds a dataset (or replaces the one with the same id) and emits 'datasets'.
 * A dataset without an id is given one, and one whose name another dataset
 * already has is given the next free numbered name (see uniqueName).
 * @param {Dataset} ds
 * @returns {Dataset}
 */
export function add(ds) {
  if (!ds.id) ds.id = 'ds-' + Date.now().toString(36) + '-' + (++counter);
  ds.name = uniqueName(ds.name, datasets.filter(d => d.id !== ds.id).map(d => d.name));
  const i = datasets.findIndex(d => d.id === ds.id);
  if (i >= 0) datasets[i] = ds; else datasets.push(ds);
  emit('datasets', { type: 'add', id: ds.id });
  return ds;
}

/**
 * Removes a dataset by id and emits 'datasets'; clears the selection, with a
 * 'selection' event, when it was the selected one; drops the candidate
 * models fitted to it; and empties the spec when it named it.
 * @param {string} id
 * @returns {boolean} whether a dataset was removed
 */
export function remove(id) {
  const i = datasets.findIndex(d => d.id === id);
  if (i < 0) return false;
  datasets.splice(i, 1);
  emit('datasets', { type: 'remove', id });
  if (selectedId === id) { selectedId = null; emit('selection', null); }
  for (const g of models.filter(m => m.spec.dataset === id).map(m => m.id)) dropModel(g);
  if (spec.dataset === id) setSpec(emptySpec());
  return true;
}

/**
 * Renames a dataset's display name and emits 'datasets'. A name another
 * dataset already has is refused, and nothing changes.
 * @param {string} id
 * @param {string} name
 * @returns {boolean} whether the dataset was renamed
 */
export function rename(id, name) {
  const ds = get(id);
  if (!ds) return false;
  if (datasets.some(d => d.id !== id && d.name === String(name))) return false;
  ds.name = String(name);
  emit('datasets', { type: 'rename', id });
  return true;
}

/**
 * The dataset with this id or null.
 * @param {string} id
 * @returns {Dataset|null}
 */
export function get(id) {
  return datasets.find(d => d.id === id) || null;
}

/**
 * Marks a dataset as the selected one (null clears) and emits 'selection'.
 * @param {string|null} id
 */
export function select(id) {
  const next = id && get(id) ? id : null;
  if (next === selectedId) return;
  selectedId = next;
  emit('selection', selectedId);
}

/**
 * The selected dataset's id or null.
 * @returns {string|null}
 */
export function selected() { return selectedId; }

/**
 * Sets the confidence level shared by every page and emits 'settings'.
 * Values other than 0.90, 0.95, and 0.99 are ignored.
 * @param {number} level
 * @returns {boolean} whether the level was accepted
 */
export function setLevel(level) {
  const v = Number(level);
  const hit = LEVELS.find(l => Math.abs(l - v) < 1e-9);
  if (hit === undefined) return false;
  if (settings.level !== hit || settings.custom) {
    settings.level = hit;
    settings.base = hit;
    settings.bonfC = 1;
    settings.custom = false;
    emit('settings', { level: hit });
  }
  return true;
}

/**
 * Sets a custom confidence level: the stated level `base` (between 0.5 and
 * 0.9999) divided among `bonfC` Bonferroni statements, so that every page
 * reads 1 − (1 − base)/bonfC. Emits 'settings'.
 * @param {number} base
 * @param {number} [bonfC]
 * @returns {boolean} whether the values were accepted
 */
export function setCustomLevel(base, bonfC = 1) {
  const b = Number(base), C = Math.round(Number(bonfC));
  if (!(b >= 0.5 && b <= 0.9999) || !(C >= 1 && C <= 10000)) return false;
  const level = 1 - (1 - b) / C;
  if (settings.level !== level || settings.base !== b || settings.bonfC !== C || !settings.custom) {
    settings.level = level;
    settings.base = b;
    settings.bonfC = C;
    settings.custom = true;
    emit('settings', { level });
  }
  return true;
}

/** A deep copy of a spec. */
export function copySpec(s) { return JSON.parse(JSON.stringify(s)); }

/**
 * Sets the fields of the model specification named in `fields` (a partial
 * spec) and emits 'spec' when any changed. Fields not named keep their
 * values.
 * @param {Partial<Spec>} fields
 * @returns {boolean} whether anything changed
 */
export function setSpec(fields) {
  let changed = false;
  for (const k of Object.keys(emptySpec())) {
    if (!(k in fields)) continue;
    const v = fields[k] === undefined ? null : JSON.parse(JSON.stringify(fields[k]));
    if (JSON.stringify(spec[k]) !== JSON.stringify(v)) { spec[k] = v; changed = true; }
  }
  if (changed) emit('spec', { spec });
  return changed;
}

/**
 * Keeps a spec (the current one by default) as a candidate model under
 * `name` and emits 'models'. A candidate with the same spec is renamed
 * rather than repeated.
 * @param {string} name
 * @param {Spec} [s]
 * @returns {{ id: string, name: string, spec: Spec }}
 */
export function keepModel(name, s = spec) {
  const copy = copySpec(s);
  const key = JSON.stringify(copy);
  let m = models.find(x => JSON.stringify(x.spec) === key);
  if (m) m.name = String(name);
  else { m = { id: 'm-' + Date.now().toString(36) + '-' + (++counter), name: String(name), spec: copy }; models.push(m); }
  emit('models', { type: 'keep', id: m.id });
  return m;
}

/**
 * Removes a candidate model by id and emits 'models'.
 * @param {string} id
 * @returns {boolean} whether a model was removed
 */
export function dropModel(id) {
  const i = models.findIndex(m => m.id === id);
  if (i < 0) return false;
  models.splice(i, 1);
  emit('models', { type: 'drop', id });
  return true;
}

/**
 * The latest result of every analysis page, keyed by page id, and so the Report
 * page can write out what the reader has computed. A page stores its result
 * whenever it recomputes and stores null when its inputs no longer allow one.
 * A result's `regen`, where the page offers scripts that regenerate its
 * results, builds the recipe on demand; it holds a function, and so it lives
 * only in memory, never in the saved session.
 * @typedef {{ title: string, provenance: Object<string, string|number>,
 *   tables: {name: string, headers: string[], rows: (string|number)[][]}[],
 *   summaryHtml?: string, regen?: { build: () => object, tooBig: boolean } }} PageResult
 * @type {Object<string, PageResult|null>}
 */
export const results = {};

/**
 * What each page's pickers hold, keyed by page id and then by the picker's
 * own key, and so a reload brings a page back on the choices it was looking
 * at. Saved with the session.
 * @type {Object<string, Object<string, *>>}
 */
export const picks = {};

/**
 * Records a picker's choice for a page and emits 'picks'. A null value
 * removes the entry.
 * @param {string} pageId
 * @param {string} key
 * @param {*} value a string, number, boolean, or array of strings
 */
export function setPick(pageId, key, value) {
  const bag = picks[pageId] || (picks[pageId] = {});
  if (value === null || value === undefined) delete bag[key]; else bag[key] = value;
  emit('picks', { pageId, key });
}

/**
 * A page's recorded choice, or `undefined` when none is stored.
 * @param {string} pageId
 * @param {string} key
 */
export function getPick(pageId, key) {
  const bag = picks[pageId];
  return bag ? bag[key] : undefined;
}

/**
 * Stores a page's latest result (or null) and emits 'results'.
 * @param {string} pageId
 * @param {PageResult|null} result
 */
export function setResult(pageId, result) {
  if (result && typeof result === 'object' && !(result.computedAt instanceof Date)) result.computedAt = new Date();
  results[pageId] = result;
  emit('results', { pageId });
}

/** The same API as one object, for `import state from './state.js'`. */
const state = { datasets, settings, LEVELS, spec, models, results, picks, on, emit, add, remove, rename, get, select, selected,
  setLevel, setCustomLevel, setSpec, copySpec, emptySpec, keepModel, dropModel, setResult, setPick, getPick };
export default state;
