// Mark helpers for the model pages, built on ui/plots.js: a fitted curve
// with its band, binned or raw data points, a bar of proportions per level,
// and a curve over a categorical x. Each records what it drew in
// fig.series, as the helpers in plots.js do, so that the figure's scripts
// can redraw it.

import { svgEl, tok, extent, scatter } from './plots.js';
import { num } from './format.js';

const r1 = v => Math.round(v * 10) / 10;
const col = (c, fallback) => (c ? (c.startsWith('--') ? tok(c) : c) : tok(fallback));

/** The level palette: Okabe–Ito without blue, each level also told apart by a dash pattern. */
export const LEVEL_COLORS = ['#C2570A', '#009E73', '#CC79A7', '#8b6914', '#56B4E9', '#000000'];
export const LEVEL_DASHES = [null, '6,4', '2,3', '8,3,2,3', '4,4', '1,3'];

/**
 * A fitted curve with its interval band. Sets the x and y scales from the
 * data unless the caller already set them; `yExtra` widens the y range to
 * hold the data points drawn afterwards.
 * @param {import('./plots.js').Figure} fig
 * @param {{ x: ArrayLike<number>, y: ArrayLike<number>, lo?: ArrayLike<number>, hi?: ArrayLike<number> }} c
 * @param {{ color?: string, dash?: string|null, label?: string, band?: boolean, axes?: boolean, width?: number }} [o]
 */
export function curveBand(fig, c, o = {}) {
  const n = c.x.length;
  if (!fig.sx) fig.x(extent(c.x), { pad: 0.03, nice: true });
  if (!fig.sy) fig.y(extent(c.y, c.lo || [], c.hi || []), { pad: 0.05, nice: true });
  if (o.axes !== false && !fig.axesDrawn) fig.axes({});
  const sx = fig.sx, sy = fig.sy;
  const color = col(o.color, '--truth');
  if (o.band !== false && c.lo && c.hi) {
    let d = '';
    for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + r1(sx(c.x[i])) + ',' + r1(sy(c.hi[i]));
    for (let i = n - 1; i >= 0; i--) d += 'L' + r1(sx(c.x[i])) + ',' + r1(sy(c.lo[i]));
    svgEl('path', { d: d + 'Z', fill: color, 'fill-opacity': 0.14, stroke: 'none', class: 'm-band' }, fig.inner);
    fig.series.push({ kind: 'band', x: Array.from(c.x), lo: Array.from(c.lo), hi: Array.from(c.hi), color, label: (o.label || 'fit') + ' interval' });
  }
  let d = '';
  for (let i = 0; i < n; i++) d += (i ? 'L' : 'M') + r1(sx(c.x[i])) + ',' + r1(sy(c.y[i]));
  svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': o.width || 2.2, 'stroke-dasharray': o.dash || null, class: 'm-curve' }, fig.inner);
  fig.series.push({ kind: 'line', x: Array.from(c.x), y: Array.from(c.y), color, dash: o.dash ? true : false, width: o.width || 2.2, label: o.label || 'fit' });
}

/**
 * Data points, raw or binned, in the data color: a filled dot per point, with
 * the readout naming the bin's count when the points carry one.
 * @param {import('./plots.js').Figure} fig
 * @param {{ x: number, y: number, n?: number }[]} pts
 * @param {{ color?: string, r?: number, label?: string, hollow?: boolean }} [o]
 */
export function dataPoints(fig, pts, o = {}) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  if (!fig.sx) fig.x(extent(xs), { pad: 0.05, nice: true });
  if (!fig.sy) fig.y(extent(ys), { pad: 0.05, nice: true });
  if (!fig.axesDrawn) fig.axes({});
  const color = col(o.color, '--est'), r = o.r || 3.6;
  const g = svgEl('g', { class: 'm-data' }, fig.inner);
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (o.hollow) svgEl('circle', { cx: r1(fig.sx(p.x)), cy: r1(fig.sy(p.y)), r, fill: tok('--card'), stroke: color, 'stroke-width': 1.8 }, g);
    else svgEl('circle', { cx: r1(fig.sx(p.x)), cy: r1(fig.sy(p.y)), r, fill: color, 'fill-opacity': o.opacity || 0.75 }, g);
  }
  fig.series.push({ kind: 'points', x: xs, y: ys, color, hollow: !!o.hollow, label: o.label || 'data' });
  if (!fig.readoutFn) fig.readout((dx, dy, px, py) => {
    let best = -1, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.hypot(fig.sx(p.x) - px, fig.sy(p.y) - py); if (d < bd) { bd = d; best = i; } });
    if (best < 0 || bd > 16) return null;
    const p = pts[best];
    return ['(' + num(p.x) + ', ' + num(p.y) + ')' + (p.n ? '  n = ' + p.n : '')];
  });
}

/**
 * A jittered strip of raw points, for a scatter of many observations with
 * few distinct y values (a binary response).
 * @param {import('./plots.js').Figure} fig
 * @param {ArrayLike<number>} xs
 * @param {ArrayLike<number>} ys
 * @param {{ color?: string, label?: string }} [o]
 */
export function rawPoints(fig, xs, ys, o = {}) {
  scatter(fig, xs, ys, { color: col(o.color, '--est'), r: 2.4, label: o.label || 'observations' });
}

/**
 * Sets a categorical x scale: the levels at 1..k with the labels drawn as
 * ticks. Returns the position of each level.
 * @param {import('./plots.js').Figure} fig
 * @param {string[]} levels
 */
export function categoricalX(fig, levels) {
  const k = levels.length;
  fig.x([0.5, k + 0.5]);
  fig.cats = { axis: 'x', labels: levels.slice() };
  fig.axes({ xTicks: k, xFormat: v => (Number.isInteger(v) && v >= 1 && v <= k ? levels[v - 1] : ''), grid: false });
  return levels.map((_, i) => i + 1);
}

/**
 * One bar per level, for the ordinal model with no predictor: the level
 * names along x, the probabilities up y from 0, recorded as rects for the
 * script exports.
 * @param {object} fig
 * @param {string[]} labels the levels, in order
 * @param {ArrayLike<number>} values a probability per level
 * @param {{ color?: string, label?: string }} [o]
 * @returns {number[]} the bars' x positions
 */
export function levelBars(fig, labels, values, o = {}) {
  const pos = categoricalX(fig, labels);
  const sy = fig.sy || fig.y([0, 1]);
  const c = o.color ? tok(o.color) : tok('--est');
  const rec = { kind: 'rects', x0: [], y0: [], x1: [], y1: [], color: c, label: o.label || 'probability' };
  const g = svgEl('g', { class: 'm-bars' }, fig.inner);
  const r1 = v => Math.round(v * 10) / 10;
  pos.forEach((x, i) => {
    const v = values[i];
    rec.x0.push(x - 0.35); rec.x1.push(x + 0.35); rec.y0.push(0); rec.y1.push(v);
    if (!(v > 0)) return;
    const x0 = fig.sx(x - 0.35), x1 = fig.sx(x + 0.35), y = sy(v);
    svgEl('rect', { x: r1(x0), y: r1(y), width: r1(Math.max(1, x1 - x0)), height: r1(sy(0) - y), fill: c, 'fill-opacity': 0.32, stroke: c, 'stroke-width': 1 }, g);
  });
  fig.series.push(rec);
  return pos;
}
