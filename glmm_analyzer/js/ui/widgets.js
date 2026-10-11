// Small UI building blocks shared by the pages: numeric spinners, result
// cards, dataset pickers, collapsible notes, the rejected-row list, the
// confidence-level picker, and callouts.

import * as state from '../state.js';
import { esc, intl, plural, pct, lvl } from './format.js';

function decimalsOf(step) {
  for (let d = 0; d <= 8; d++) if (Math.abs(step - Number(step.toFixed(d))) < 1e-9) return d;
  return 8;
}

/**
 * Turns a text field into a spinner: an up/down pair that shows on hover or
 * focus (and sits beside the field at full size on a touch screen, where a
 * hidden control is no control), ArrowUp/ArrowDown on the field (Shift for
 * ten steps), and clamping to [min, max] at the step's decimals whenever the
 * value is stepped or typed. `onChange(value)` runs after every accepted
 * change.
 * @param {HTMLInputElement} input
 * @param {{ min?: number, max?: number, step?: number, shiftStep?: number, decimals?: number,
 *   onChange?: (v: number) => void }} [opts]
 * @returns {{ get: () => number, set: (v: number, notify?: boolean) => number, wrap: HTMLElement }}
 */
export function spinner(input, opts = {}) {
  const min = opts.min === undefined ? -Infinity : opts.min;
  const max = opts.max === undefined ? Infinity : opts.max;
  const step = opts.step || 1;
  const shiftStep = opts.shiftStep || step * 10;
  const decimals = opts.decimals !== undefined ? opts.decimals : decimalsOf(step);
  if (!input.className) input.className = 'par-inp';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  if (!input.getAttribute('inputmode')) input.setAttribute('inputmode', decimals ? 'decimal' : 'numeric');

  const clampRound = v => {
    if (!Number.isFinite(v)) v = Number.isFinite(min) ? min : 0;
    return Math.min(max, Math.max(min, Number(v.toFixed(decimals))));
  };
  let last = clampRound(Number(input.value));
  const set = (v, notify = true) => {
    const next = clampRound(v);
    input.value = String(next);
    const changed = next !== last;
    last = next;
    if (notify && changed && opts.onChange) opts.onChange(next);
    return next;
  };
  const stepBy = (dir, shift) => { if (!input.disabled) set(clampRound(Number(input.value)) + dir * (shift ? shiftStep : step)); };

  let wrap = input.parentElement;
  if (!wrap || !wrap.classList.contains('spin')) {
    wrap = document.createElement('span');
    wrap.className = 'spin';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btns = document.createElement('span');
    btns.className = 'spin-btns';
    const lbl = input.id ? document.querySelector('label[for="' + input.id + '"]') : null;
    const fieldName = lbl ? lbl.textContent.trim() : (input.getAttribute('aria-label') || 'value');
    [['▲', 1, 'Increase'], ['▼', -1, 'Decrease']].forEach(([glyph, dir, name]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'spin-btn'; b.textContent = glyph; b.tabIndex = -1;
      b.setAttribute('aria-label', name + ' ' + fieldName);
      b.addEventListener('click', ev => { stepBy(dir, ev.shiftKey); input.focus(); });
      btns.appendChild(b);
    });
    wrap.appendChild(btns);
  }
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      ev.preventDefault();
      stepBy(ev.key === 'ArrowUp' ? 1 : -1, ev.shiftKey);
    } else if (ev.key === 'Enter') {
      set(Number(input.value));
    }
  });
  input.addEventListener('change', () => set(Number(input.value)));
  input.value = String(last);
  return { get: () => last, set, wrap };
}

/**
 * A result card: a small uppercase label on top, the value below in the
 * monospace face, and an optional note under it.
 * @param {string} label HTML
 * @param {string} valueHtml HTML
 * @param {string} [noteHtml] HTML
 * @returns {HTMLDivElement}
 */
export function card(label, valueHtml, noteHtml) {
  const el = document.createElement('div');
  el.className = 'sc';
  el.innerHTML = '<div class="sc-lbl">' + label + '</div><div class="sc-val">' + valueHtml + '</div>' +
    (noteHtml ? '<div class="sc-note">' + noteHtml + '</div>' : '');
  // A long value (an interval in brackets) takes the full row on a phone
  // rather than being cut short with an ellipsis.
  if (el.querySelector('.sc-val').textContent.length > 14) el.classList.add('sc-wide');
  return el;
}

/**
 * A responsive grid of cards.
 * @param {HTMLElement[]} cards
 * @returns {HTMLDivElement}
 */
export function cardRow(cards) {
  const el = document.createElement('div');
  el.className = 'sg';
  for (const c of cards) el.appendChild(c);
  return el;
}

/** How a dataset is named in a picker: its name and its row count. */
export function optionLabel(ds) {
  return ds.name + ' (n = ' + intl(ds.rows.length) + ')';
}

/**
 * Fills a <select> with the loaded datasets that pass `filter` and keeps it
 * in sync on every 'datasets' event, preserving the chosen dataset while it
 * still exists. When the chosen dataset disappears, the select moves to the
 * placeholder (or the first dataset) and fires its own 'change' event, and
 * so the page's change handler sees it. With `remember: { page, key }`,
 * every change is recorded with `state.setPick(page, key, id)` and the
 * recorded dataset is chosen whenever it is loaded.
 * @param {HTMLSelectElement} selectEl
 * @param {{ filter?: (ds: Object) => boolean, placeholder?: string, value?: string,
 *   remember?: { page: string, key: string } }} [opts]
 * @returns {{ refresh: () => void, value: () => string, destroy: () => void }}
 */
export function datasetSelect(selectEl, opts = {}) {
  const filter = opts.filter || (() => true);
  const mem = opts.remember || null;
  const remembered = () => (mem ? state.getPick(mem.page, mem.key) : undefined);
  let chosen = opts.value || selectEl.value || '';
  function refresh() {
    const list = state.datasets.filter(filter);
    const before = selectEl.value;
    const want = remembered();
    if (typeof want === 'string' && list.some(d => d.id === want)) chosen = want;
    selectEl.innerHTML = '';
    if (opts.placeholder !== undefined || !list.length) {
      const o = document.createElement('option');
      o.value = ''; o.textContent = list.length ? (opts.placeholder || 'Choose a dataset') : 'No datasets loaded';
      selectEl.appendChild(o);
    }
    for (const ds of list) {
      const o = document.createElement('option');
      o.value = ds.id; o.textContent = optionLabel(ds);
      selectEl.appendChild(o);
    }
    if (chosen && list.some(d => d.id === chosen)) selectEl.value = chosen;
    else selectEl.value = opts.placeholder !== undefined || !list.length ? '' : list[0].id;
    chosen = selectEl.value;
    selectEl.disabled = !list.length;
    if (selectEl.value !== before) selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const onChange = () => {
    chosen = selectEl.value;
    if (mem) state.setPick(mem.page, mem.key, chosen || null);
  };
  selectEl.addEventListener('change', onChange);
  const off = state.on('datasets', refresh);
  refresh();
  return {
    refresh,
    value: () => selectEl.value,
    destroy: () => { off(); selectEl.removeEventListener('change', onChange); }
  };
}

/**
 * A collapsible note, closed by default.
 * @param {string} summaryText plain text for the summary line
 * @param {string} bodyHtml HTML for the body
 * @returns {HTMLDetailsElement}
 */
export function details(summaryText, bodyHtml) {
  const d = document.createElement('details');
  d.className = 'why';
  d.innerHTML = '<summary>' + esc(summaryText) + '</summary><div class="why-body">' + bodyHtml + '</div>';
  return d;
}

/**
 * The rows an import rejected, each with its line number, its text, and the
 * reason, in a collapsed <details>; a single muted line when there are none.
 * @param {{ line: number, text: string, reason: string }[]} issues
 * @returns {HTMLElement}
 */
export function issueList(issues) {
  if (!issues || !issues.length) {
    const p = document.createElement('p');
    p.className = 'muted-line';
    p.textContent = 'No rows were rejected.';
    return p;
  }
  const d = document.createElement('details');
  d.className = 'why issues';
  const rows = issues.map(it => '<tr><td>' + intl(it.line) + '</td><td class="iss-text">' + esc(it.text === undefined ? '' : it.text) + '</td><td>' + esc(it.reason) + '</td></tr>').join('');
  d.innerHTML = '<summary>' + esc(plural(issues.length, 'row was', 'rows were') + ' flagged') + '</summary>' +
    '<div class="why-body"><div class="scroll-box"><table class="ptab iss-tab"><thead><tr><th>Line</th><th>Text</th><th>Reason</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  return d;
}

/**
 * Binds a <select> to the shared confidence level (90%, 95%, or 99%): it
 * shows the current level, sets it on change, and follows changes made by
 * any other level picker on the page.
 * @param {HTMLSelectElement} selectEl
 * @returns {() => void} a function that unbinds it
 */
export function levelSelect(selectEl) {
  selectEl.innerHTML = state.LEVELS.map(l => '<option value="' + l + '"' + (!state.settings.custom && Math.abs(l - state.settings.level) < 1e-9 ? ' selected' : '') + '>' + pct(l, 0) + '</option>').join('') +
    '<option value="custom"' + (state.settings.custom ? ' selected' : '') + '>Custom…</option>';
  const box = document.createElement('span');
  box.className = 'lvl-custom';
  box.innerHTML = '<label class="lvl-lbl">level <input type="number" class="par-inp lvl-base" min="50" max="99.99" step="0.1" inputmode="decimal" aria-label="Stated confidence level, percent">%</label>' +
    '<label class="lvl-lbl"><span class="tip" tabindex="0" data-tip="The number of statements to hold jointly at the stated level. Each interval is then formed at 1 − α/C, the Bonferroni inequality done by hand. Set 1 for a single interval.">C</span> <input type="number" class="par-inp lvl-c" min="1" max="10000" step="1" inputmode="numeric" aria-label="Bonferroni count"></label>' +
    '<span class="ctrl-note lvl-note"></span>';
  selectEl.insertAdjacentElement('afterend', box);
  const base = box.querySelector('.lvl-base'), cnt = box.querySelector('.lvl-c'), note = box.querySelector('.lvl-note');
  const sync = () => {
    const st = state.settings;
    const want = st.custom ? 'custom' : String(st.level);
    selectEl.value = want;
    if (selectEl.value !== want) {
      const opts = Array.from(selectEl.options);
      const hit = opts.findIndex(o => o.value !== 'custom' && Math.abs(Number(o.value) - st.level) < 1e-9);
      selectEl.selectedIndex = hit >= 0 ? hit : opts.findIndex(o => o.value === 'custom');
    }
    box.style.display = st.custom ? '' : 'none';
    if (st.custom) {
      if (document.activeElement !== base) base.value = String(Math.round(st.base * 10000) / 100);
      if (document.activeElement !== cnt) cnt.value = String(st.bonfC);
      note.textContent = st.bonfC > 1
        ? 'α = ' + trimNum(1 - st.base) + ' over C = ' + st.bonfC + ' gives ' + lvl(st.level) + ' per interval'
        : 'every interval at ' + lvl(st.level);
    }
  };
  const apply = () => {
    const b = Number(base.value) / 100, C = Number(cnt.value);
    if (!state.setCustomLevel(b, C)) sync();
  };
  selectEl.addEventListener('change', () => {
    if (selectEl.value === 'custom') {
      const st = state.settings;
      state.setCustomLevel(st.custom ? st.base : st.level, st.custom ? st.bonfC : 1);
    } else {
      state.setLevel(Number(selectEl.value));
    }
  });
  base.addEventListener('change', apply);
  cnt.addEventListener('change', apply);
  sync();
  return state.on('settings', sync);
}

function trimNum(v) { return String(Number(v.toFixed(4))); }

/**
 * A callout block: 'warn' for a caution (an ochre rule and a "!" badge),
 * 'ok' for a pass, or 'info' for a note (an accent wash and an "i" badge).
 * The badge's shape carries the kind as well as its color.
 * @param {'warn'|'info'|'ok'} kind
 * @param {string} html
 * @returns {HTMLDivElement}
 */
export function notice(kind, html) {
  const el = document.createElement('div');
  const k = kind === 'warn' ? 'warn' : kind === 'ok' ? 'ok' : 'info';
  el.className = 'notice notice-' + k;
  el.setAttribute('role', 'note');
  const badge = k === 'warn' ? '!' : k === 'ok' ? '✓' : 'i';
  const said = k === 'warn' ? 'Warning: ' : k === 'ok' ? 'Passed: ' : 'Note: ';
  el.innerHTML = '<span class="notice-badge" aria-hidden="true">' + badge + '</span><div class="notice-body">' +
    '<span class="sr-only">' + said + '</span>' + html + '</div>';
  return el;
}

/**
 * A list as English prose: "a", "a and b", "a, b, and c".
 * @param {string[]} a
 */
export function listWords(a) {
  return a.length <= 2 ? a.join(' and ') : a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1];
}

/** The card label for degrees of freedom: "df", expanded by its tooltip. */
export const DF_LABEL = '<span class="tip" tabindex="0" data-tip="Degrees of freedom">df</span>';

/** What a Wald interval or test is, for the term wherever a page uses it. */
export const WALD_TIP = 'The familiar recipe, estimate ± quantile × standard error, applied to a coefficient. The standard error comes from the curvature of the log-likelihood at the fit; the quantile comes from the t distribution where the dispersion is estimated (a normal or gamma model with no random part) and from the normal otherwise; and the matching Wald test is the estimate over its standard error, a t or z statistic. The t interval for a mean is the Wald interval of the simplest linear model.';

/**
 * A term with a tooltip, in page text.
 * @param {string} text the term as shown
 * @param {string} tip what it means
 */
export function term(text, tip) {
  return '<span class="tip" tabindex="0" data-tip="' + esc(tip) + '">' + text + '</span>';
}
