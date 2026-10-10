// The figures of the regenerate scripts: every figure the page shows in
// the view the reader had open when the script was written, each drawn by
// one call to a helper the script carries (figure_lib_r.js,
// figure_lib_tidy.js, figure_lib_py.js, figure_lib_m.js). The calls name the
// variables the page bodies in analysis_scripts.js compute. Pure functions,
// no DOM.
//
// FIGURES[page](r, L) returns { notes, calls, fig, need }: comments saying
// what is drawn, the lines that draw the figures, the helper keys they call,
// and any statistical snippets they need beyond the body's. The helpers'
// contract, the same in every dialect (R and Python take the options by
// name; MATLAB takes the required arguments and then one struct o):
//   fig_intervals(mid, lo, hi, labels, xlab, title; ref): a forest plot.
//   fig_qq(x, ylab, title; xlab): a normal quantile-quantile plot.
//   fig_effect(x, y, lo, hi, xlab, ylab, title; px, py, labels): the fitted
//     curve with its band (several, as lists) and data points.
//   fig_resid(x, r, xlab, ylab, title): residuals against a variable with
//     the mean in ten bins of equal count.

import { FIG_R } from './figure_lib_r.js';
import { FIG_TIDY } from './figure_lib_tidy.js';
import { FIG_PY } from './figure_lib_py.js';
import { FIG_M } from './figure_lib_m.js';

/** The figure helpers by dialect key: 'R', 'tidy', 'py', 'm'. */
export const FIG = { R: FIG_R, tidy: FIG_TIDY, py: FIG_PY, m: FIG_M };

/** A vector of expressions. */
export const vecOf = (L, exprs) => (L.lang === 'R' ? 'c(' + exprs.join(', ') + ')' : '[' + exprs.join(', ') + ']');
/** A list of vectors: an R list, a Python list, a MATLAB cell array. */
export const listOf = (L, exprs) => (L.lang === 'R' ? 'list(' + exprs.join(', ') + ')' : L.lang === 'py' ? '[' + exprs.join(', ') + ']' : '{' + exprs.join(', ') + '}');
/** A vector of strings. */
export const strsOf = (L, a) => (L.lang === 'R' ? 'c(' + a.map(L.str).join(', ') + ')' : L.lang === 'py' ? '[' + a.map(L.str).join(', ') + ']' : '{' + a.map(L.str).join(', ') + '}');

/**
 * The lines of one helper call: positional arguments, then named options.
 * R and Python pass the options by name; MATLAB gathers them in a struct o.
 */
export function call(L, name, pos, opts = {}) {
  const entries = Object.entries(opts).filter(([, v]) => v !== undefined && v !== null);
  if (L.lang === 'm') {
    if (!entries.length) return [name + '(' + pos.join(', ') + ');'];
    return ['o = struct();', ...entries.map(([k, v]) => 'o.' + k + ' = ' + v + ';'), name + '(' + pos.join(', ') + ', o);'];
  }
  const eq = L.lang === 'R' ? ' = ' : '=';
  const args = pos.concat(entries.map(([k, v]) => k + eq + v));
  const one = name + '(' + args.join(', ') + ')';
  if (one.length <= 96) return [one];
  const pad = ' '.repeat(name.length + 1), out = [];
  let line = name + '(';
  args.forEach((a, i) => {
    const piece = a + (i < args.length - 1 ? ',' : ')');
    if (line.length + piece.length + 1 > 96 && line.trim() !== name + '(') { out.push(line.replace(/ +$/, '')); line = pad; }
    line += piece + (i < args.length - 1 ? ' ' : '');
  });
  out.push(line);
  return out;
}

function modelFigures(r, L) {
  const names = r.names;
  const labels = strsOf(L, names.filter(n => n !== '(Intercept)'));
  const sel = L.lang === 'R' ? 'coef_names != "(Intercept)"' : L.lang === 'py' ? '[nm != "(Intercept)" for nm in coef_names]' : "~strcmp(coef_names, '(Intercept)')";
  const calls = [];
  if (L.lang === 'R') calls.push('keep <- ' + sel, ...call(L, 'fig_intervals', ['b[keep]', 'b[keep] - q_wald * se[keep]', 'b[keep] + q_wald * se[keep]', labels, L.str('Coefficient on the ' + r.spec.link + ' scale'), L.str('Coefficients with their Wald intervals')], { ref: '0' }));
  else if (L.lang === 'py') calls.push('keep = np.array(' + sel + ')', ...call(L, 'fig_intervals', ['b[keep]', 'b[keep] - q_wald * se[keep]', 'b[keep] + q_wald * se[keep]', labels, L.str('Coefficient on the ' + r.spec.link + ' scale'), L.str('Coefficients with their Wald intervals')], { ref: '0' }));
  else calls.push('keep = ' + sel + ';', ...call(L, 'fig_intervals', ['b(keep)', 'b(keep) - q_wald * se(keep)', 'b(keep) + q_wald * se(keep)', labels, L.str('Coefficient on the ' + r.spec.link + ' scale'), L.str('Coefficients with their Wald intervals')], { ref: '0' }));
  return { notes: ['The coefficients other than the intercept with their Wald intervals, on the link scale.'], calls, fig: ['intervals'], need: [] };
}

function diagnosticsFigures(r, L) {
  if (r.spec.family === 'ordinal') return { calls: [] };
  const calls = [
    ...call(L, 'fig_qq', ['qr', L.str('Quantile residuals'), L.str('Normal quantile plot of the quantile residuals')]),
    ...call(L, 'fig_resid', [L.lang === 'R' ? 'mu[keep]' : L.lang === 'py' ? 'mu[keep]' : 'mu(keep)', 'qr', L.str('Fitted value'), L.str('Quantile residual'), L.str('Residuals against fitted values')])
  ];
  return { notes: ['The quantile residuals against the normal, and against the fitted values with their mean in ten bins of equal count.'], calls, fig: ['qq', 'resid'], need: [] };
}

function predictFigures(r, L) {
  const calls = [], fig = [];
  if (r.effect) {
    const n = r.effect.series.length;
    const xs = r.effect.series.map((s, k) => (L.lang === 'R' ? 'nd' + (k + 1) + '$' + r.effect.x : L.lang === 'py' ? 'nd' + (k + 1) + '[' + L.str(r.effect.x) + ']' : 'nd' + (k + 1) + '.' + r.effect.x));
    const cont = r.data.columns.find(c => c.name === r.effect.x).type === 'continuous';
    if (cont) {
      const ys = r.effect.series.map((s, k) => 'linkinv_of(m, eta' + (k + 1) + ')');
      const los = r.effect.series.map((s, k) => 'linkinv_of(m, eta' + (k + 1) + ' - q_wald * se' + (k + 1) + ')');
      const his = r.effect.series.map((s, k) => 'linkinv_of(m, eta' + (k + 1) + ' + q_wald * se' + (k + 1) + ')');
      const labels = strsOf(L, r.effect.series.map(s => s.label || 'predicted mean'));
      const yData = L.lang === 'R' ? (r.response.event != null && r.spec.family === 'binomial' ? 'as.numeric(d$' + r.spec.response + ' == ' + L.str(r.response.event) + ')' : 'd$' + r.spec.response)
        : L.lang === 'py' ? 'np.asarray(d[' + L.str(r.spec.response) + '], float)' : 'tbl.' + r.spec.response;
      const xData = L.lang === 'R' ? 'd$' + r.effect.x : L.lang === 'py' ? 'np.asarray(d[' + L.str(r.effect.x) + '], float)' : 'tbl.' + r.effect.x;
      calls.push(...call(L, 'fig_effect', [listOf(L, xs), listOf(L, ys), listOf(L, los), listOf(L, his), L.str(r.effect.x), L.str(r.response.event ? 'probability of ' + r.response.event : r.spec.response), L.str('Predicted ' + (r.response.event ? 'probability of ' + r.response.event : r.spec.response) + ' against ' + r.effect.x)], { px: xData, py: yData, labels: n > 1 ? labels : undefined }));
      fig.push('effect');
    }
  }
  if (r.means) {
    const m = r.means;
    const labels = strsOf(L, m.levels);
    if (L.lang === 'R') calls.push(...call(L, 'fig_intervals', ['er[, 2]', 'er[, 5]', 'er[, 6]', labels, L.str('Marginal mean of ' + r.spec.response), L.str('Marginal means of ' + m.factor)]));
    else {
      const mids = m.levels.map((_, i) => 'linkinv_of(m, e' + (i + 1) + ')'), los = m.levels.map((_, i) => 'linkinv_of(m, e' + (i + 1) + ' - q_emm * s' + (i + 1) + ')'), his = m.levels.map((_, i) => 'linkinv_of(m, e' + (i + 1) + ' + q_emm * s' + (i + 1) + ')');
      calls.push(...call(L, 'fig_intervals', [vecOf(L, mids), vecOf(L, los), vecOf(L, his), labels, L.str('Marginal mean of ' + r.spec.response), L.str('Marginal means of ' + m.factor)]));
    }
    fig.push('intervals');
  }
  if (!calls.length) return { calls: [] };
  return { notes: ['The effect plot and the marginal means as the page drew them.'], calls, fig, need: [] };
}

/** The figure emitters by page. */
export const FIGURES = { model: modelFigures, diagnostics: diagnosticsFigures, predict: predictFigures };

/**
 * The Figures section of a script, or nothing when the page's view shows no figure.
 * @param {object} r the recipe
 * @param {object} L the language
 * @returns {{ lines: string[], fig: string[], need: string[] }}
 */
export function figureBlock(r, L) {
  const make = Object.prototype.hasOwnProperty.call(FIGURES, r.page) ? FIGURES[r.page] : null;
  const got = make ? make(r, L) : null;
  if (!got || !got.calls.length) return { lines: [], fig: [], need: [] };
  const c = L.comment, lines = [L.sect('Figures')];
  for (const n of got.notes || []) lines.push(c + n);
  if (L.lang === 'R' && !L.tidy) lines.push(c + 'Each figure replaces the last on screen; in RStudio, the arrows of the Plots pane step back through them.');
  if (L.lang === 'py') {
    lines.push('try:', '    import matplotlib', 'except ImportError:', '    matplotlib = None',
      'if matplotlib is None:', '    print("Matplotlib is not installed, and so the figures are skipped.")', 'else:',
      ...got.calls.map(x => '    ' + x), '    show_figures()');
  } else lines.push(...got.calls);
  return { lines, fig: Array.from(new Set(['common', ...got.fig])), need: got.need || [] };
}
