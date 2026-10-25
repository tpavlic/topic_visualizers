// Small rules the pages apply, kept apart from the pages so that they can be
// tested in Node and shared with the regenerate scripts: the ticks a
// checklist opens with and the labels the figures carry. Pure functions, no
// DOM.

import { looksDiscrete, sturgesBins, HIST_BINS_MIN, HIST_BINS_MAX, VALUE_BINS_MAX } from '../stats/descriptive.js';

/**
 * The ticks a checklist opens with. A stored list stands at any length, even
 * one or none, less any id no longer offered; every offered item is ticked
 * only before any choice (nothing stored) or when a non-empty stored list
 * has none of its items left.
 * @param {unknown} stored the list kept with the session, or anything else when there is none
 * @param {string[]} offered the ids the checklist offers
 * @returns {string[]}
 */
export function initialTicks(stored, offered) {
  if (!Array.isArray(stored)) return offered.slice();
  const kept = stored.filter(x => offered.includes(x));
  return kept.length || !stored.length ? kept : offered.slice();
}

/**
 * The names of several items as a figure labels them: the part after a
 * prefix every name shares ("file · A", "file · B" become "A", "B"), or the
 * whole names when they share none or the parts would repeat.
 * @param {string[]} names
 * @returns {string[]}
 */
export function shortNames(names) {
  if (names.length < 2) return names.slice();
  const cut = s => { const k = s.lastIndexOf(' · '); return k < 0 ? null : [s.slice(0, k), s.slice(k + 3)]; };
  const parts = names.map(cut);
  if (parts.some(p => !p) || parts.some(p => p[0] !== parts[0][0])) return names.slice();
  const tails = parts.map(p => p[1]);
  return new Set(tails).size === tails.length ? tails : names.slice();
}

/**
 * How the Explore page bins the response's histogram, given the reader's
 * stored choice `pick` ({ mode: 'value' | 'width', bins }, or nothing). A bar per
 * value is offered whenever it takes at most VALUE_BINS_MAX bars (`canValue`), and
 * is the default when the values look discrete by `looksDiscrete`; otherwise, and
 * on request, the bins are equal-width, `bins` of them, Sturges' rule unless the
 * reader set a count, kept in the slider's range.
 * @param {ArrayLike<number>} values
 * @param {{mode?: string, bins?: number}|null|undefined} pick
 * @returns {{perValue: boolean, bins: number, canValue: boolean, discrete: boolean,
 *   rule: 'count'|'few'|null, nUnique: number, auto: boolean}}
 *   `auto` says the bin count is Sturges' rather than the reader's.
 */
export function histChoice(values, pick) {
  const info = looksDiscrete(values);
  const canValue = info.nUnique >= 1 && info.bars <= VALUE_BINS_MAX;
  const mode = pick && (pick.mode === 'width' || pick.mode === 'value') ? pick.mode : info.discrete ? 'value' : 'width';
  const asked = pick && Number.isFinite(pick.bins) && pick.bins > 0 ? Math.round(pick.bins) : null;
  const bins = asked ? Math.max(HIST_BINS_MIN, Math.min(HIST_BINS_MAX, asked)) : sturgesBins(values.length);
  return { perValue: mode === 'value' && canValue, bins, canValue, discrete: info.discrete, rule: info.rule, nUnique: info.nUnique, auto: !asked };
}
