// The "Regenerate these results in" scripts: a recipe (see recipes.js)
// becomes a MATLAB, R, or Python script holding the data the page modeled,
// the choices it made, and code that fits the same model with the language's
// own routine, recomputes every number the page shows, checks each against
// the analyzer's own value, and draws the figures of the page's view
// (figure_scripts.js). Pure functions, no DOM.
//
// A script is assembled from: a header comment (title, stamp, choices,
// requirements), the report helper, the helpers the body needs (MATLAB puts
// these after the body as local functions), a Settings block, a Data block,
// and the page's body. BODIES[page][lang] builds the body and names the
// helpers it needs from script_lib.js.
//
// Every script is 7-bit ASCII: each string that reaches one (a title, a
// dataset name, a provenance value, a report name) goes through ascii().

import { plain, joinNums, sanitizeName, kebabName } from './scripts.js';
import { MAX_NUMBERS } from './datafiles.js';
import { LIB } from './script_lib.js';
import { FIG, figureBlock } from './figure_scripts.js';
import { polyNames } from '../stats/design.js';

const BY = 'the GLMM Analyzer';

// ── ASCII folding ────────────────────────────────────────────────────────

const GREEK = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ϵ': 'epsilon', 'ζ': 'zeta',
  'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi',
  'ο': 'omicron', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'ς': 'sigma', 'τ': 'tau', 'υ': 'upsilon',
  'φ': 'phi', 'ϕ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega'
};
for (const [k, v] of Object.entries(GREEK)) {
  const K = k.toUpperCase();
  if (K !== k && !GREEK[K]) GREEK[K] = v[0].toUpperCase() + v.slice(1);
}
const SYMBOL = {
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '±': '+/-', '×': 'x', '÷': '/', '⁄': '/', '√': 'sqrt',
  '∞': 'infinity', '→': '->', '←': '<-', '°': ' deg', '•': '-', '′': "'", '″': '"',
  'µ': 'u', '¹': '^1', '²': '^2', '³': '^3',
  'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ø': 'o', 'Ø': 'O', 'ł': 'l', 'Ł': 'L',
  'đ': 'd', 'Đ': 'D', 'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th'
};

/**
 * A string as 7-bit ASCII for a script: plain() first (dashes, curly quotes,
 * the minus sign, line breaks), then the symbols above to their ASCII
 * spellings, accents dropped by canonical decomposition, Greek letters to
 * their names, control characters to spaces, and anything else to "?".
 * @param {*} s
 * @returns {string}
 */
export function ascii(s) {
  return plain(s)
    .replace(/[^\x00-\x7f]/gu, c => (Object.prototype.hasOwnProperty.call(SYMBOL, c) ? SYMBOL[c] : c))
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[Ͱ-Ͽ]/g, c => GREEK[c] || c)
    .replace(/[^\x00-\x7f]/gu, '?')
    .replace(/[\x00-\x1f\x7f]/g, ' ');
}

// The R packages a recipe's models call, from what they fit rather than from
// the helpers' text, which names every package it may call.
function rPackages(recipe) {
  const specs = recipe.candidates ? recipe.candidates : [recipe.spec];
  const pk = new Set();
  for (const s of specs) {
    if (s.family === 'ordinal' || (s.family === 'negbin' && !s.mixed)) pk.add('MASS');
    if (s.family === 'beta') pk.add(s.mixed ? 'glmmTMB' : 'betareg');
    if (s.mixed && s.family !== 'beta') pk.add('lme4');
  }
  if (recipe.means) pk.add('emmeans');
  return ['MASS', 'betareg', 'lme4', 'glmmTMB', 'emmeans'].filter(p => pk.has(p));
}

// ── Per-language syntax ──────────────────────────────────────────────────

function dq(s) { return '"' + ascii(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function sq(s) { return "'" + ascii(s).replace(/'/g, "''") + "'"; }

const LANG = {
  R: {
    lang: 'R', comment: '# ', sect: s => '\n## ' + s + ' ----',
    str: dq,
    vec: a => (a.length ? 'c(' + joinNums(a, 'NA', '  ', '') + ')' : 'numeric(0)'),
    strs: a => (a.length ? 'c(' + a.map(v => (v == null ? 'NA' : dq(v))).join(', ') + ')' : 'character(0)'),
    assign: (n, e) => n + ' <- ' + e,
    bool: b => (b ? 'TRUE' : 'FALSE'), nan: 'NaN', inf: 'Inf',
    prelude: () => ['options(digits = 10)'],
    requires: (code, recipe) => {
      const pk = rPackages(recipe);
      return 'R with its stats package' + (pk.length ? ' and the ' + pk.join(', ') + ' package' + (pk.length > 1 ? 's' : '') : '') + '.';
    }
  },
  py: {
    lang: 'py', comment: '# ', sect: s => '\n# ---- ' + s + ' ----',
    str: dq,
    vec: a => 'np.array([' + joinNums(a, 'np.nan', '    ', '') + '])',
    strs: a => '[' + a.map(v => (v == null ? 'None' : dq(v))).join(', ') + ']',
    assign: (n, e) => n + ' = ' + e,
    bool: b => (b ? 'True' : 'False'), nan: 'np.nan', inf: 'np.inf',
    prelude: () => ['import numpy as np', 'import pandas as pd', 'from scipy import stats', 'np.set_printoptions(precision=10)'],
    requires: code => 'Python 3 with NumPy, SciPy, pandas, and statsmodels 0.14 or later' + (/import matplotlib/.test(code) ? ' (Matplotlib, if installed, draws the figures).' : '.')
  },
  m: {
    lang: 'm', comment: '% ', sect: s => '\n%% ' + s,
    str: sq,
    vec: a => (a.length ? '[' + joinNums(a, 'NaN', '    ', ' ...') + ']' : '[]'),
    strs: a => '{' + a.map(v => (v == null ? "''" : sq(v))).join(', ') + '}',
    assign: (n, e) => n + ' = ' + e + ';',
    bool: b => (b ? 'true' : 'false'), nan: 'NaN', inf: 'Inf',
    prelude: () => ['format long g'],
    requires: 'MATLAB with the Statistics and Machine Learning Toolbox. A Shapiro-Wilk check, where the page makes one, runs only when a swtest function is on the path (the toolbox has one from R2026b; for earlier releases, one is on the File Exchange).'
  }
};
LANG.tidy = Object.assign({}, LANG.R, {
  tidy: true,
  prelude: () => ['options(digits = 10)', 'suppressPackageStartupMessages({ library(tibble); library(dplyr); library(ggplot2); library(broom) })'],
  requires: (code, recipe) => LANG.R.requires(code, recipe).replace(/\.$/, '') + ', plus tibble, dplyr, broom, and ggplot2.'
});

/**
 * The line that opens a section of a script, as the writers emit it.
 * @param {'m'|'R'|'tidy'|'py'} lang
 * @param {string} title
 */
export function sectionLine(lang, title) {
  if (!Object.prototype.hasOwnProperty.call(LANG, lang)) throw new RangeError('sectionLine: unknown language ' + lang);
  return LANG[lang].sect(title).trim();
}

/** The writers by language key, with the button label and the file-name rule. */
export const ANALYSIS_WRITERS = {
  m: { label: 'MATLAB', name: 'MATLAB', ext: 'm', mime: 'text/x-matlab' },
  R: { label: 'Base R', name: 'base R', ext: 'R', mime: 'text/x-r' },
  tidy: { label: 'Tidy R', name: 'R with the tidyverse', ext: 'R', mime: 'text/x-r', suffix: '-tidy' },
  py: { label: 'Python', name: 'Python', ext: 'py', mime: 'text/x-python' }
};

/**
 * The file name of a recipe's script in one language.
 * @param {object} recipe
 * @param {'m'|'R'|'tidy'|'py'} lang
 */
export function scriptFileName(recipe, lang) {
  const w = ANALYSIS_WRITERS[lang];
  if (!w) throw new RangeError('scriptFileName: unknown language ' + lang);
  const base = ascii(recipe.title || recipe.page || 'analysis');
  if (lang === 'm') return sanitizeName(base).slice(0, 50).replace(/_+$/, '') + '_analysis.m';
  return kebabName(base).slice(0, 50).replace(/-+$/, '') + '-analysis' + (w.suffix || '') + '.' + w.ext;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function stamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** A value as a literal of the language: a string, a boolean, NaN for a missing number, or the number. */
export function lit(L, v) {
  if (typeof v === 'string') return L.str(v);
  if (typeof v === 'boolean') return L.bool(v);
  if (v == null || Number.isNaN(v)) return L.nan;
  if (v === Infinity) return L.inf;
  if (v === -Infinity) return '-' + L.inf;
  return String(v);
}

// R's parser is quadratic in a long expression, and so a long vector is
// written as short complete statements, the later parts appended.
const R_LINE = 92;
function rChunks(target, tokens, empty) {
  if (!tokens.length) return [target + ' <- ' + empty];
  const out = [];
  let line = target + ' <- c(', n = 0;
  for (const tok of tokens) {
    if (n && line.length + tok.length + 3 > R_LINE) { out.push(line + ')'); line = target + ' <- c(' + target + ', '; n = 0; }
    line += (n ? ', ' : '') + tok;
    n++;
  }
  out.push(line + ')');
  return out;
}
const numTok = (L, v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : (L.lang === 'R' ? 'NA' : L.nan));

/** Lines assigning a vector of numbers (null for a missing value) to `target`. */
export function vecAssign(L, target, values) {
  return L.lang === 'R' ? rChunks(target, Array.from(values, v => numTok(L, v)), 'numeric(0)') : [L.assign(target, L.vec(Array.from(values, v => (v == null ? NaN : v))))];
}

/** Lines assigning a vector of strings (null for a missing value) to `target`. */
export function strsAssign(L, target, values) {
  return L.lang === 'R' ? rChunks(target, values.map(v => (v == null ? 'NA' : L.str(v))), 'character(0)') : [L.assign(target, L.strs(values))];
}

/**
 * Tolerances: a relative 1e-6 on max(1, |expected|) by default; what a
 * language's own optimizer or quadrature only approximates is looser. The
 * scripts check their own results with these, and
 * test/analysis_scripts.test.mjs holds them to the same.
 */
export function tolFor(key, lang, recipe) {
  const mixed = recipe && ((recipe.spec && recipe.spec.mixed) || (recipe.candidates || []).some(c => c.mixed));
  const nb = recipe && recipe.spec && recipe.spec.family === 'negbin';
  if (mixed) {
    // The mixed fits land where each optimizer stops: lme4, glmmTMB, and
    // fitglme agree with the page to about four digits.
    if (/^(variance|correlation|residual variance)/.test(key)) return { rel: 2e-2 };
    if (/^(se |emm se |pair se |effect .* se$|calc se|lower |upper |emm lower|emm upper|pair lower|pair upper|calc lower|calc upper)/.test(key)) return { rel: 2e-2 };
    if (/^(random LRT|random p|LRT)/.test(key)) return { rel: 5e-3 };
    if (/^(log-likelihood|AIC|BIC|deviance|loglik )/.test(key)) return { rel: 1e-5 };
    return { rel: 5e-3 };
  }
  if (/^(pair p |pair lower |pair upper )/.test(key)) return { rel: 1e-5 };
  if (/^shapiro /.test(key)) return { rel: 1e-4 };
  if (nb && /^(theta|coef|se |lower|upper|log-likelihood|AIC|BIC|deviance|LRT|emm|pair|effect|calc|cooks|quantile|dispersion|null)/.test(key)) return { rel: 1e-5 };
  if (/^(coef|se |lower|upper|threshold|phi)/.test(key) && recipe && recipe.spec && (recipe.spec.family === 'beta' || recipe.spec.family === 'ordinal')) return { rel: 1e-5 };
  if (/^(parameters|k )/.test(key)) return { abs: 1e-9 };
  return { rel: 1e-6 };
}

let current = null;

function tolArg(L, key, want) {
  const t = tolFor(key, L.lang, current);
  if (t.abs != null) return ', ' + (typeof want === 'number' && Number.isFinite(want) ? t.abs / Math.max(1, Math.abs(want)) : 1e-6);
  return t.rel === 1e-6 ? '' : ', ' + t.rel;
}

/**
 * A report call for `name` with expression `expr`, carrying the analyzer's
 * value from the recipe's expect map (under `name` or `name [optional]`).
 */
export function rep(L, recipe, name, expr) {
  const key = ascii(name);
  const has = k => Object.prototype.hasOwnProperty.call(recipe.expect, k);
  const want = has(key) ? recipe.expect[key] : has(key + ' [optional]') ? recipe.expect[key + ' [optional]'] : undefined;
  const a = want !== undefined && want !== null ? ', ' + lit(L, want) + tolArg(L, key, want) : '';
  const call = 'report(' + L.str(key) + ', ' + expr + a + ')';
  return L.lang === 'm' ? call + ';' : call;
}

// ── Header, settings, data ───────────────────────────────────────────────

function commentLines(first, text, cont, width = 92) {
  const out = [];
  let line = first, fresh = true;
  for (const w of String(text).split(/ +/)) {
    if (!w) continue;
    if (!fresh && line.length + 1 + w.length > width) { out.push(line); line = cont; fresh = true; }
    line += (fresh ? '' : ' ') + w;
    fresh = false;
  }
  out.push(line);
  return out;
}

function header(recipe, L, code) {
  const c = L.comment;
  const out = [c + ascii(recipe.title)];
  out.push(c + 'Written by ' + BY + ' on ' + stamp(new Date()) + '. It regenerates the page\'s results from the');
  out.push(c + (recipe.csvOnly ? 'data files beside it' : 'data below') + ' with this language\'s own fitting routine. Edit the settings and rerun.');
  out.push(c.trim());
  out.push(c + 'Choices on the page:');
  for (const [k, v] of Object.entries(recipe.provenance || {})) {
    if (v === undefined || v === null || v === '') continue;
    out.push(...commentLines(c + '  ', ascii(k) + ': ' + ascii(Array.isArray(v) ? v.join(', ') : String(v)), c + '    '));
  }
  out.push(...commentLines(c, 'Requires: ' + (typeof L.requires === 'function' ? L.requires(code, recipe) : L.requires), c + '  '));
  return out;
}

// The page's coefficient names as each language's fitter names them.
// A column name as a Python formula writes it: Q("name") where the name is a
// keyword or not an identifier, and otherwise itself.
export const PY_KEYWORDS = /^(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|I|C|Q|Poly)$/;
export function pyName(name) {
  return PY_KEYWORDS.test(name) || !/^[A-Za-z_]\w*$/.test(name) ? 'Q("' + name.replace(/"/g, '\\"') + '")' : name;
}

export function nameIn(L, name, recipe) {
  const ds = recipe.data.columns;
  const isFactor = n => ds.some(c => c.name === n && c.type !== 'continuous');
  const isOrd = n => ds.some(c => c.name === n && c.type === 'ordinal');
  const pieceIn = p => {
    if (p === '(Intercept)') return L.lang === 'py' ? 'Intercept' : '(Intercept)';
    const pow = /^I\((.+)\^(\d+)\)$/.exec(p);
    if (pow) return L.lang === 'py' ? 'I(' + pyName(pow[1]) + ' ** ' + pow[2] + ')' : L.lang === 'm' ? pow[1] + '_pow' + pow[2] : p;
    // A factor's column: the variable name that prefixes it with a level or a contrast suffix.
    const vars = ds.map(c => c.name).filter(n => p.startsWith(n) && p !== n && isFactor(n)).sort((a, b) => b.length - a.length);
    if (vars.length) {
      const v = vars[0], rest = p.slice(v.length);
      if (isOrd(v)) {
        const k = ds.find(c => c.name === v).levels.length;
        const idx = polyNames(k).indexOf(rest);
        if (L.lang === 'py') return 'C(' + pyName(v) + ', Poly)' + ['.Linear', '.Quadratic', '.Cubic'].concat(Array.from({ length: Math.max(0, k - 4) }, (_, i) => '^' + (i + 4)))[idx];
        if (L.lang === 'm') return v + rest.replace('.', '_').replace('^', '_');
        return p;
      }
      if (L.lang === 'py') return pyName(v) + '[T.' + rest + ']';
      if (L.lang === 'm') return v + '_' + rest;
      return p;
    }
    return L.lang === 'py' ? pyName(p) : p;
  };
  return name.split(':').map(pieceIn).join(':');
}

function settingsBlock(recipe, L) {
  const c = L.comment;
  const s = recipe.spec;
  const out = [L.sect('Settings')];
  out.push(c + 'Every choice the page made. check_details prints each result beside the page\'s value.');
  out.push(L.assign('check_details', L.bool(false)));
  out.push(L.assign('level', String(recipe.level)));
  out.push(L.assign('alpha', '1 - level'));
  if (recipe.page === 'compare') {
    out.push(c + 'Each candidate\'s family, link, and formula are set in its own fit_model call below.');
    return out;
  }
  out.push(c + 'The family, the link, and the model, as the page fitted it. family is one of normal, binomial,');
  out.push(c + 'poisson, negbin, gamma, beta, ordinal.');
  out.push(L.assign('family', L.str(s.family)));
  out.push(L.assign('link', L.str(s.link)));
  out.push(L.assign('formula', L.str(recipe.formula[L.lang])));
  out.push(L.assign('reml', L.bool(!!s.reml)));
  out.push(c + 'The degrees of freedom of the Wald intervals: the residual degrees of freedom for a normal or');
  out.push(c + 'gamma model without random effects, whose dispersion is estimated, and none (a normal');
  out.push(c + 'quantile) otherwise, as the fitters report them.');
  out.push(L.assign('df_wald', lit(L, recipe.dfWald)));
  if (L.lang === 'py' && s.mixed) {
    out.push(L.assign('group', L.str(s.olre && !s.group ? 'obs' : s.group)));
    out.push(L.assign('re_formula', L.str(s.slope ? '~' + s.slope : '1')));
  }
  return out;
}

function dataBlock(recipe, L) {
  const c = L.comment;
  const d = recipe.data;
  const out = [L.sect('Data')];
  out.push(...commentLines(c, 'The columns of ' + ascii(recipe.dataset) + ' the model reads, ' + d.n + ' rows, in the order loaded; a missing value is ' +
    (L.lang === 'R' ? 'NA' : L.lang === 'py' ? 'nan or None' : 'NaN or an empty name') + ', and the fitter drops the rows with one, as the page did.', c));
  if (recipe.csvOnly) {
    out.push(...csvReadLines(recipe, L));
    out.push(c + 'The coefficient names as the page prints them (R\'s).');
    out.push(...strsAssign(L, 'coef_names', recipe.names));
    return out;
  }
  for (const col of d.columns) {
    const vals = d.rows.map((r, i) => r[d.columns.indexOf(col)]);
    const v = col.type === 'continuous' ? vals : vals.map(x => (x == null ? null : String(x)));
    out.push(...(col.type === 'continuous' ? vecAssign(L, varName(L, col.name), v) : strsAssign(L, varName(L, col.name), v)));
  }
  const resp = recipe.response;
  const coded = col => {
    // A binomial model of a two-level response takes the event as 1; an ordinal response is its level codes in MATLAB.
    if (col.name === recipe.spec.response && resp.type !== 'continuous') {
      if (recipe.spec.family === 'binomial' && resp.event != null) {
        if (L.lang === 'R') return 'factor(' + varName(L, col.name) + ', levels = ' + L.strs(resp.levels) + ')';
        if (L.lang === 'py') return null;
        return 'double(strcmp(' + varName(L, col.name) + ', ' + L.str(resp.event) + '))';
      }
      if (recipe.spec.family === 'ordinal') {
        if (L.lang === 'R') return 'factor(' + varName(L, col.name) + ', levels = ' + L.strs(resp.levels) + ', ordered = TRUE)';
        if (L.lang === 'py') return null;
        return 'ordinal_codes(' + varName(L, col.name) + ', ' + L.strs(resp.levels) + ')';
      }
    }
    return undefined;
  };
  if (L.lang === 'R') {
    const parts = d.columns.map(col => {
      const v = varName(L, col.name), cd = coded(col);
      if (cd) return col.name + ' = ' + cd;
      if (col.type === 'categorical') return col.name + ' = factor(' + v + ', levels = ' + L.strs(col.levels) + ')';
      if (col.type === 'ordinal') return col.name + ' = factor(' + v + ', levels = ' + L.strs(col.levels) + ', ordered = TRUE)';
      return col.name + ' = ' + v;
    });
    out.push('d <- data.frame(' + parts.join(', ') + ', stringsAsFactors = FALSE)');
    if (recipe.spec.olre || (recipe.candidates || []).some(x => x.olre)) out.push('d$obs <- factor(seq_len(nrow(d)))');
    if (L.tidy) out.push('d <- as_tibble(d)');
  } else if (L.lang === 'py') {
    out.push('d = pd.DataFrame({' + d.columns.map(col => L.str(col.name) + ': ' + varName(L, col.name)).join(', ') + '})');
    for (const col of d.columns) {
      if (col.name === recipe.spec.response && resp.type !== 'continuous') {
        if (recipe.spec.family === 'binomial' && resp.event != null) { out.push('d[' + L.str(col.name) + '] = (d[' + L.str(col.name) + '] == ' + L.str(resp.event) + ').astype(float)'); continue; }
        if (recipe.spec.family === 'ordinal') { out.push('d[' + L.str(col.name) + '] = pd.Categorical(d[' + L.str(col.name) + '], categories=' + L.strs(resp.levels) + ', ordered=True)'); continue; }
      }
      if (col.type !== 'continuous') out.push('d[' + L.str(col.name) + '] = pd.Categorical(d[' + L.str(col.name) + '], categories=' + L.strs(col.levels) + (col.type === 'ordinal' ? ', ordered=True' : '') + ')');
    }
    if (recipe.spec.olre || (recipe.candidates || []).some(x => x.olre)) out.push('d["obs"] = pd.Categorical([str(i + 1) for i in range(len(d))])');
  } else {
    const parts = d.columns.map(col => {
      const v = varName(L, col.name), cd = coded(col);
      if (cd) return cd;
      if (col.type !== 'continuous') return 'categorical(' + v + '(:), ' + L.strs(col.levels) + (col.type === 'ordinal' ? ", 'Ordinal', true" : '') + ')';
      return v + '(:)';
    });
    out.push('tbl = table(' + parts.join(', ') + ", 'VariableNames', " + L.strs(d.columns.map(c => c.name)) + ');');
    if (recipe.spec.olre || (recipe.candidates || []).some(x => x.olre)) out.push("tbl.obs = categorical(string((1:height(tbl))'));");
    const extras = [].concat(recipe.extraCols ? recipe.extraCols.m : [], ...(recipe.candidates || []).map(x => x.extraCols.m));
    const seen = new Set();
    for (const e of extras) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      if (e.kind === 'power') out.push('tbl.' + e.name + ' = tbl.' + e.of + '.^' + e.degree + ';');
      else { out.push(c + 'The polynomial contrasts of the ordinal predictor ' + e.name + ', as R\'s contr.poly forms them.'); out.push('P = poly_columns(tbl.' + e.name + ');'); e.cols.forEach((nm, k) => out.push('tbl.' + nm + ' = P(:, ' + (k + 1) + ');')); }
    }
  }
  out.push(c + 'The coefficient names as the page prints them (R\'s).');
  out.push(...strsAssign(L, 'coef_names', recipe.names));
  return out;
}

// The data block of a CSV-mode script: the data file read from the script's
// folder, then the same factor coding the embedded block applies, and the
// computed columns MATLAB needs.
function csvReadLines(recipe, L) {
  const c = L.comment;
  const d = recipe.data, resp = recipe.response, s = recipe.spec;
  const out = [];
  out.push(...commentLines(c, 'The data run past the ' + MAX_NUMBERS.toLocaleString('en-US') + ' numbers a script carries, and so this script reads them from ' + recipe.csvFile + ', which the Data button beside the script buttons saves. Keep the file in this script\'s folder; its # lines are skipped.', c));
  const cats = d.columns.filter(col => col.type !== 'continuous');
  const nums = d.columns.filter(col => col.type === 'continuous');
  const isResp = col => col.name === s.response && resp.type !== 'continuous';
  const olre = recipe.spec.olre || (recipe.candidates || []).some(x => x.olre);
  if (L.lang === 'R') {
    out.push('d <- read.csv(' + L.str(recipe.csvFile) + ', comment.char = "#", check.names = FALSE, stringsAsFactors = FALSE' + (cats.length ? ', colClasses = c(' + cats.map(col => L.str(col.name) + ' = "character"').join(', ') + ')' : '') + ')');
    for (const col of d.columns) {
      const v = 'd[[' + L.str(col.name) + ']]';
      if (isResp(col) && s.family === 'binomial' && resp.event != null) out.push(v + ' <- factor(' + v + ', levels = ' + L.strs(resp.levels) + ')');
      else if (isResp(col) && s.family === 'ordinal') out.push(v + ' <- factor(' + v + ', levels = ' + L.strs(resp.levels) + ', ordered = TRUE)');
      else if (col.type === 'categorical') out.push(v + ' <- factor(' + v + ', levels = ' + L.strs(col.levels) + ')');
      else if (col.type === 'ordinal') out.push(v + ' <- factor(' + v + ', levels = ' + L.strs(col.levels) + ', ordered = TRUE)');
    }
    if (olre) out.push('d$obs <- factor(seq_len(nrow(d)))');
    if (L.tidy) out.push('d <- as_tibble(d)');
  } else if (L.lang === 'py') {
    out.push('d = pd.read_csv(' + L.str(recipe.csvFile) + ', comment="#"' + (cats.length ? ', dtype={' + cats.map(col => L.str(col.name) + ': str').join(', ') + '}' : '') + ')');
    for (const col of d.columns) {
      if (isResp(col) && s.family === 'binomial' && resp.event != null) { out.push('d[' + L.str(col.name) + '] = (d[' + L.str(col.name) + '] == ' + L.str(resp.event) + ').astype(float)'); continue; }
      if (isResp(col) && s.family === 'ordinal') { out.push('d[' + L.str(col.name) + '] = pd.Categorical(d[' + L.str(col.name) + '], categories=' + L.strs(resp.levels) + ', ordered=True)'); continue; }
      if (col.type !== 'continuous') out.push('d[' + L.str(col.name) + '] = pd.Categorical(d[' + L.str(col.name) + '], categories=' + L.strs(col.levels) + (col.type === 'ordinal' ? ', ordered=True' : '') + ')');
    }
    if (olre) out.push('d["obs"] = pd.Categorical([str(i + 1) for i in range(len(d))])');
  } else {
    out.push('opts = detectImportOptions(' + L.str(recipe.csvFile) + ", 'CommentStyle', '#');");
    out.push("opts.VariableNamingRule = 'preserve';");
    if (cats.length) out.push('opts = setvartype(opts, ' + L.strs(cats.map(col => col.name)) + ", 'char');");
    if (nums.length) out.push('opts = setvartype(opts, ' + L.strs(nums.map(col => col.name)) + ", 'double');");
    out.push('tbl = readtable(' + L.str(recipe.csvFile) + ', opts);');
    for (const col of d.columns) {
      const v = 'tbl.' + col.name;
      if (isResp(col) && s.family === 'binomial' && resp.event != null) out.push(v + ' = double(strcmp(' + v + ', ' + L.str(resp.event) + '));');
      else if (isResp(col) && s.family === 'ordinal') out.push(v + ' = ordinal_codes(' + v + ', ' + L.strs(resp.levels) + ');');
      else if (col.type !== 'continuous') out.push(v + ' = categorical(' + v + ', ' + L.strs(col.levels) + (col.type === 'ordinal' ? ", 'Ordinal', true" : '') + ');');
    }
    if (olre) out.push("tbl.obs = categorical(string((1:height(tbl))'));");
    const extras = [].concat(recipe.extraCols ? recipe.extraCols.m : [], ...(recipe.candidates || []).map(x => x.extraCols.m));
    const seen = new Set();
    for (const e of extras) {
      if (seen.has(e.name)) continue;
      seen.add(e.name);
      if (e.kind === 'power') out.push('tbl.' + e.name + ' = tbl.' + e.of + '.^' + e.degree + ';');
      else { out.push(c + 'The polynomial contrasts of the ordinal predictor ' + e.name + ', as R\'s contr.poly forms them.'); out.push('P = poly_columns(tbl.' + e.name + ');'); e.cols.forEach((nm, k) => out.push('tbl.' + nm + ' = P(:, ' + (k + 1) + ');')); }
    }
  }
  return out;
}

// A column's vector variable: its name, with a suffix where the language reserves it.
function varName(L, name) {
  const reserved = L.lang === 'R' ? /^(if|else|for|in|while|function|repeat|break|next|TRUE|FALSE|NULL|NA|Inf|NaN|T|F|c|d|t|level|family|link|formula|reml|alpha|m)$/
    : L.lang === 'py' ? /^(if|else|for|in|while|def|return|class|lambda|None|True|False|import|from|as|with|pass|and|or|not|is|d|m|np|pd|stats|level|family|link|formula|reml|alpha)$/
      : /^(if|else|for|in|while|function|end|return|tbl|m|level|family|link|formula|reml|alpha|i|j|P)$/;
  return reserved.test(name) ? name + '_col' : name;
}

// ── Page bodies ──────────────────────────────────────────────────────────

// The boundary-corrected p-value of a random part's likelihood ratio, as
// stats/inference.js's boundaryP forms it, and the comment that says which
// mixture the line uses.
function boundaryExpr(L, k, withSlope) {
  const upper = d => (d <= 0 ? (L.lang === 'R' ? 'as.numeric(s <= 0)' : L.lang === 'py' ? 'float(s <= 0)' : 'double(s <= 0)') : chisqUpper(L, 's', String(d)));
  if (k === 1) return '0.5 * ' + upper(0) + ' + 0.5 * ' + upper(1);
  if (k === 2 && !withSlope) return '0.25 * ' + upper(0) + ' + 0.5 * ' + upper(1) + ' + 0.25 * ' + upper(2);
  return upper(k);
}
function boundaryNote(k, withSlope) {
  if (k === 1) return 'One variance at the edge of its range: half the chi-square tail on one degree of freedom.';
  if (k === 2 && !withSlope) return 'Two independent variances at their edges: the 1/4 : 1/2 : 1/4 mixture of the tails on 0, 1, and 2 degrees of freedom.';
  return 'The random slope brings a covariance in, whose boundary mixture has no simple form: the plain tail on ' + k + ' degrees of freedom, which is conservative.';
}

export const BODIES = {};

// The Wald quantile, the fit, and the coefficient lines every page starts from.
function fitLines(r, L) {
  const s = r.spec;
  const out = [L.lang === 'm' ? 'report_start(check_details);' : 'report_start(check_details)', L.sect('Fit')];
  if (L.lang === 'R') {
    out.push('m <- fit_model(d, family, link, formula, reml)');
    if (L.tidy) out.push('if (fit_class(m) %in% c("glm", "negbin", "polr", "betareg")) print(tidy(m))');
    out.push('q_wald <- if (is.finite(df_wald)) qt(1 - alpha / 2, df_wald) else qnorm(1 - alpha / 2)');
    out.push('b <- fit_coef(m)', 'se <- fit_se(m)');
  } else if (L.lang === 'py') {
    out.push('m = fit_model(d, family, link, formula, reml' + (s.mixed ? ', group=group, re_formula=re_formula' : '') + ')');
    out.push('q_wald = stats.t.ppf(1 - alpha / 2, df_wald) if np.isfinite(df_wald) else stats.norm.ppf(1 - alpha / 2)');
    out.push('names_here = ' + '[' + r.names.map(n => L.str(nameIn(L, n, r))).join(', ') + ']');
    out.push('b = np.array([coef_at(m, nm) for nm in names_here])', 'se = np.array([se_at(m, nm) for nm in names_here])');
  } else {
    out.push('m = fit_model(tbl, family, link, formula, reml);');
    out.push('if isfinite(df_wald), q_wald = tinv(1 - alpha / 2, df_wald); else, q_wald = norminv(1 - alpha / 2); end');
    out.push('names_here = ' + L.strs(r.names.map(n => nameIn(L, n, r))) + ';');
    out.push('b = zeros(numel(names_here), 1); se = b;');
    out.push('for j = 1:numel(names_here), b(j) = coef_at(m, names_here{j}); se(j) = se_at(m, names_here{j}); end');
  }
  return out;
}

const idx = (L, j) => (L.lang === 'py' ? '[' + j + ']' : '[' + (j + 1) + ']') + (L.lang === 'm' ? '' : '');
const at = (L, v, j) => (L.lang === 'py' ? v + '[' + j + ']' : L.lang === 'm' ? v + '(' + (j + 1) + ')' : v + '[' + (j + 1) + ']');

function coefLines(r, L) {
  const out = [L.sect('Coefficients')];
  r.names.forEach((n, j) => {
    out.push(rep(L, r, 'coef ' + n, at(L, 'b', j)));
    out.push(rep(L, r, 'se ' + n, at(L, 'se', j)));
    out.push(rep(L, r, 'lower ' + n, at(L, 'b', j) + ' - q_wald * ' + at(L, 'se', j)));
    out.push(rep(L, r, 'upper ' + n, at(L, 'b', j) + ' + q_wald * ' + at(L, 'se', j)));
  });
  if (r.zetaNames && r.zetaNames.length) {
    out.push(L.assign('zeta', L.lang === 'R' ? 'fit_thresholds(m)' : 'fit_thresholds(m)'));
    r.zetaNames.forEach((n, k) => out.push(rep(L, r, 'threshold ' + n, at(L, 'zeta', k))));
  }
  return out;
}

function statsLines(r, L) {
  const s = r.spec;
  const e = r.expect;
  const out = [L.sect('Fit statistics')];
  const has = k => Object.prototype.hasOwnProperty.call(e, k);
  out.push(rep(L, r, 'log-likelihood', 'fit_loglik(m)'));
  out.push(rep(L, r, 'parameters', 'fit_k(m)'));
  out.push(rep(L, r, 'AIC', '-2 * fit_loglik(m) + 2 * fit_k(m)'));
  out.push(rep(L, r, 'BIC', '-2 * fit_loglik(m) + fit_k(m) * ' + (L.lang === 'py' ? 'np.log(len(d))' : L.lang === 'm' ? 'log(height(tbl))' : 'log(nrow(d))')));
  if (has('deviance')) out.push(rep(L, r, 'deviance', 'fit_deviance(m)'));
  if (has('null deviance')) out.push(rep(L, r, 'null deviance', 'fit_nulldev(m)'));
  if (has('dispersion')) out.push(rep(L, r, 'dispersion', 'fit_dispersion(m)'));
  if (has('theta')) out.push(rep(L, r, 'theta', 'fit_aux(m)'));
  if (has('phi')) out.push(rep(L, r, 'phi', 'fit_aux(m)'));
  if (s.mixed) {
    out.push(L.lang === 'm' ? 'vc = fit_varcomp(m);' : L.assign('vc', 'fit_varcomp(m)'));
    for (const k of Object.keys(e)) {
      const mv = /^variance (.+) (\(Intercept\)|slope)$/.exec(k);
      if (mv) out.push(rep(L, r, k, 'varcomp_at(vc, ' + L.str(mv[1]) + ', ' + L.str(mv[2]) + ')'));
      const mc = /^correlation (.+)$/.exec(k);
      if (mc) out.push(rep(L, r, k, 'varcomp_corr(vc, ' + L.str(mc[1]) + ')'));
    }
    if (has('residual variance')) out.push(rep(L, r, 'residual variance', 'fit_dispersion(m)'));
  }
  return out;
}

function termLines(r, L) {
  if (!r.termTests || !r.termTests.length) return [];
  const out = [L.sect('Term tests')];
  const c = L.comment;
  out.push(c + 'Each term dropped and the model refitted by maximum likelihood; the statistic as drop1(test = "Chisq") forms it.');
  out.push(L.lang === 'R' ? 'm_ml <- fit_ml(m, d, family, link, formula)' : L.lang === 'py' ? 'm_ml = fit_ml(m, d, family, link, formula' + (r.spec.mixed ? ', group=group, re_formula=re_formula' : '') + ')' : 'm_ml = fit_ml(m, tbl, family, link, formula);');
  r.termTests.forEach(t => {
    const f = t.reduced[L.lang];
    const fitCall = L.lang === 'R' ? 'fit_reduced(m_ml, d, family, link, ' + L.str(f) + ')'
      : L.lang === 'py' ? 'fit_reduced(m_ml, d, family, link, ' + L.str(f) + (r.spec.mixed ? ', group=group, re_formula=re_formula' : '') + ')'
        : 'fit_reduced(m_ml, tbl, family, link, ' + L.str(f) + ');'.replace(');', ')');
    out.push(L.assign('red', fitCall));
    out.push(L.assign('s', 'lrt_stat(m_ml, red, family)'));
    out.push(rep(L, r, 'LRT ' + t.term, 's'));
    out.push(rep(L, r, 'LRT p ' + t.term, chisqUpper(L, 's', String(t.df))));
  });
  return out;
}

const chisqUpper = (L, s, df) => (L.lang === 'R' ? 'pchisq(' + s + ', ' + df + ', lower.tail = FALSE)' : L.lang === 'py' ? 'stats.chi2.sf(' + s + ', ' + df + ')' : 'chi2cdf(' + s + ', ' + df + ", 'upper')");

function randomLines(r, L) {
  if (!r.randomTest) return [];
  const out = [L.sect('The random part')];
  const c = L.comment;
  out.push(c + 'The mixed model against the same fixed part without random effects, with the boundary correction.');
  const f = r.randomTest.fixed[L.lang];
  out.push(L.assign('m0', L.lang === 'R' ? 'fit_model(d, family, link, ' + L.str(f) + ', FALSE)' : L.lang === 'py' ? 'fit_model(d, family, link, ' + L.str(f) + ', False)' : 'fit_model(tbl, family, link, ' + L.str(f) + ', false)'));
  if (!r.termTests || !r.termTests.length) out.push(L.lang === 'R' ? 'm_ml <- fit_ml(m, d, family, link, formula)' : L.lang === 'py' ? 'm_ml = fit_ml(m, d, family, link, formula' + (r.spec.mixed ? ', group=group, re_formula=re_formula' : '') + ')' : 'm_ml = fit_ml(m, tbl, family, link, formula);');
  out.push(L.assign('s', '2 * (fit_loglik(m_ml) - fit_loglik(m0))'));
  out.push(rep(L, r, 'random LRT', 's'));
  out.push(c + boundaryNote(r.randomTest.k, !!r.spec.slope));
  out.push(rep(L, r, 'random p', boundaryExpr(L, r.randomTest.k, !!r.spec.slope)));
  return out;
}

BODIES.model = {};
for (const lang of ['R', 'py', 'm']) {
  BODIES.model[lang] = (r, L) => ({ body: [...fitLines(r, L), ...coefLines(r, L), ...statsLines(r, L), ...termLines(r, L), ...randomLines(r, L)], need: ['fit'] });
}

// ── Diagnostics ──────────────────────────────────────────────────────────

function diagnosticsBody(r, L) {
  const out = [...fitLines(r, L)];
  const s = r.spec;
  const c = L.comment;
  const e = r.expect;
  const has = k => Object.prototype.hasOwnProperty.call(e, k) || Object.prototype.hasOwnProperty.call(e, k + ' [optional]');
  out.push(L.sect('Residuals'));
  if (s.family !== 'ordinal') {
    out.push(c + 'The randomized quantile residuals, with the page\'s own uniforms for a discrete family.');
    const yExpr = L.lang === 'R' ? (r.response.event != null && s.family === 'binomial' ? 'as.numeric(d$' + s.response + ' == ' + L.str(r.response.event) + ')' : 'd$' + s.response)
      : L.lang === 'py' ? 'np.asarray(d[' + L.str(s.response) + '], float)' : 'tbl.' + s.response;
    out.push(L.assign('y_num', yExpr));
    out.push(L.assign('mu', 'fit_fitted(m)'));
    const aux = r.auxKind === 'dispersion' ? 'fit_dispersion(m)' : r.auxKind === 'one' ? '1' : 'fit_aux(m)';
    out.push(L.assign('aux_val', aux));
    if (r.csvOnly && r.uniformsFile) {
      out.push(c + 'The uniforms behind the page\'s randomized residuals, from the file the Data buttons save.');
      // MATLAB's import-options detector takes a one-column file's first # line as its header, and so the file is read as lines.
      if (L.lang === 'm') out.push('u_lines = splitlines(strtrim(fileread(' + L.str(r.uniformsFile) + ')));', "u_lines = u_lines(~startsWith(u_lines, '#'));", 'u = str2double(u_lines(2:end));');
      else out.push(L.assign('u', L.lang === 'R' ? 'read.csv(' + L.str(r.uniformsFile) + ', comment.char = "#")$u' : 'np.asarray(pd.read_csv(' + L.str(r.uniformsFile) + ', comment="#")["u"], float)'));
    } else if (r.uniforms) out.push(...vecAssign(L, 'u', r.uniforms)); else out.push(L.assign('u', L.lang === 'R' ? 'rep(0.5, length(y_num))' : L.lang === 'py' ? 'np.full(len(y_num), 0.5)' : 'repmat(0.5, numel(y_num), 1)'));
    if (L.lang === 'R') out.push('keep <- !is.na(y_num) & is.finite(mu)', 'qr <- quantile_residuals(y_num[keep], mu, family, aux_val, u[keep])');
    else if (L.lang === 'py') out.push('keep = ~np.isnan(y_num)', 'qr = quantile_residuals(y_num[keep], mu, family, aux_val, u[keep])');
    else out.push('keep = ~isnan(y_num);', 'qr = quantile_residuals(y_num(keep), mu, family, aux_val, u(keep));');
    out.push(rep(L, r, 'quantile residual mean', L.lang === 'R' ? 'mean(qr)' : L.lang === 'py' ? 'float(np.mean(qr))' : 'mean(qr)'));
    out.push(rep(L, r, 'quantile residual sd', L.lang === 'R' ? 'sd(qr)' : L.lang === 'py' ? 'float(np.std(qr, ddof=1))' : 'std(qr)'));
    if (has('shapiro W')) {
      const W = e['shapiro W'] != null ? e['shapiro W'] : e['shapiro W [optional]'], P = e['shapiro p'] != null ? e['shapiro p'] : e['shapiro p [optional]'];
      // The check carries its tolerance, as every report line does; a mixed fit's residuals follow its optimizer.
      const st = ', ' + tolFor('shapiro p', L.lang, r).rel;
      out.push(L.lang === 'R' ? 'shapiro_check("shapiro", qr, ' + lit(L, W) + ', ' + lit(L, P) + st + ')' : L.lang === 'py' ? 'shapiro_check("shapiro", qr, ' + lit(L, W) + ', ' + lit(L, P) + st + ')' : "shapiro_check('shapiro', qr, alpha, " + lit(L, W) + ', ' + lit(L, P) + st + ');');
    }
  }
  if (has('dispersion chi-square')) {
    out.push(L.sect('Dispersion'));
    out.push(L.assign('pr', L.lang === 'R' ? 'residuals(m, type = "pearson")' : L.lang === 'py' ? 'pearson_residuals(m)' : 'pearson_residuals(m)'));
    out.push(L.assign('df_res', L.lang === 'R' ? 'nobs(m) - fit_k(m)' : L.lang === 'py' ? 'int(m.nobs) - fit_k(m)' : 'numel(pr) - fit_k(m)'));
    out.push(L.assign('x2', L.lang === 'R' ? 'sum(pr^2)' : L.lang === 'py' ? 'float(np.sum(pr ** 2))' : 'sum(pr.^2)'));
    out.push(rep(L, r, 'dispersion chi-square', 'x2'));
    out.push(rep(L, r, 'dispersion ratio', 'x2 / df_res'));
    out.push(rep(L, r, 'dispersion p', chisqUpper(L, 'x2', 'df_res')));
  }
  if (has('cooks max')) {
    out.push(L.sect('Influence'));
    out.push(rep(L, r, 'cooks max', L.lang === 'R' ? 'max(cooks.distance(m))' : L.lang === 'py' ? 'cooks_max(m, d, family, link, formula)' : 'max(m.Diagnostics.CooksDistance)'));
  }
  return { body: out, need: ['fit', 'qresid', 'shapiro'] };
}
BODIES.diagnostics = { R: diagnosticsBody, py: diagnosticsBody, m: diagnosticsBody };

// ── Predict ──────────────────────────────────────────────────────────────

// Lines building a data frame of new rows (objects) in the language.
function newRows(r, L, name, rows) {
  const cols = r.data.columns.filter(c => c.name !== r.spec.response && rows.length && rows[0][c.name] !== undefined);
  const col = c => rows.map(o => o[c.name]);
  if (L.lang === 'R') {
    return [name + ' <- data.frame(' + cols.map(c => c.name + ' = ' + (c.type === 'continuous' ? L.vec(col(c)) : 'factor(' + L.strs(col(c)) + ', levels = ' + L.strs(c.levels) + (c.type === 'ordinal' ? ', ordered = TRUE' : '') + ')')).join(', ') + ', stringsAsFactors = FALSE)'];
  }
  if (L.lang === 'py') {
    const out = [name + ' = pd.DataFrame({' + cols.map(c => L.str(c.name) + ': ' + (c.type === 'continuous' ? L.vec(col(c)) : L.strs(col(c)))).join(', ') + '})'];
    for (const c of cols) if (c.type !== 'continuous') out.push(name + '[' + L.str(c.name) + '] = pd.Categorical(' + name + '[' + L.str(c.name) + '], categories=' + L.strs(c.levels) + (c.type === 'ordinal' ? ', ordered=True' : '') + ')');
    return out;
  }
  const out = [name + ' = table(' + cols.map(c => (c.type === 'continuous' ? L.vec(col(c)) + "'" : 'categorical(' + L.strs(col(c)) + "', " + L.strs(c.levels) + ')')).join(', ') + ", 'VariableNames', " + L.strs(cols.map(c => c.name)) + ');'];
  const extras = r.extraCols ? r.extraCols.m : [];
  for (const e of extras) {
    if (e.kind === 'power') out.push(name + '.' + e.name + ' = ' + name + '.' + e.of + '.^' + e.degree + ';');
    else { out.push('P = poly_columns_at(' + name + '.' + e.name + ', tbl.' + e.name + ');'); e.cols.forEach((nm, k) => out.push(name + '.' + nm + ' = P(:, ' + (k + 1) + ');')); }
  }
  return out;
}

const matvec = (L, X, b) => (L.lang === 'R' ? 'as.numeric(' + X + ' %*% ' + b + ')' : L.lang === 'py' ? X + ' @ ' + b : X + ' * ' + b);
const rowSe = (L, X, V) => (L.lang === 'R' ? 'sqrt(rowSums((' + X + ' %*% ' + V + ') * ' + X + '))' : L.lang === 'py' ? 'np.sqrt(np.sum((' + X + ' @ ' + V + ') * ' + X + ', axis=1))' : 'sqrt(sum((' + X + ' * ' + V + ') .* ' + X + ', 2))');
const linkinv = (L, eta) => (L.lang === 'R' ? 'linkinv_of(m, ' + eta + ')' : L.lang === 'py' ? 'linkinv_of(m, ' + eta + ')' : 'linkinv_of(m, ' + eta + ')');

function predictBody(r, L) {
  const out = [...fitLines(r, L)];
  const c = L.comment;
  out.push(L.lang === 'm' ? 'V = vcov_at(m, names_here);' : L.lang === 'py' ? 'V = vcov_at(m, names_here)' : 'V <- vcov_at(m, coef_names)');
  if (r.effect) {
    out.push(L.sect('Effect plot'));
    out.push(c + 'The predicted mean along ' + ascii(r.effect.x) + (r.effect.by ? ' by ' + ascii(r.effect.by) : '') + ', the other predictors held as the page held them; three points of each curve are checked.');
    r.effect.series.forEach((s, k) => {
      const nm = 'nd' + (k + 1);
      out.push(...newRows(r, L, nm, s.rows));
      out.push(L.assign('X' + (k + 1), 'grid_rows(m, ' + (L.lang === 'm' ? 'tbl' : 'd') + ', ' + nm + ', ' + (L.lang === 'R' ? 'coef_names' : 'names_here') + ')'));
      out.push(L.assign('eta' + (k + 1), matvec(L, 'X' + (k + 1), 'b')));
      out.push(L.assign('se' + (k + 1), rowSe(L, 'X' + (k + 1), 'V')));
      for (const i of s.report) {
        const key = 'effect ' + (s.label || 'curve') + ' point ' + (i + 1);
        out.push(rep(L, r, key + ' eta', at(L, 'eta' + (k + 1), i)));
        out.push(rep(L, r, key + ' se', at(L, 'se' + (k + 1), i)));
        out.push(rep(L, r, key + ' fit', linkinv(L, at(L, 'eta' + (k + 1), i))));
      }
    });
  }
  if (r.means) {
    const m = r.means;
    out.push(L.sect('Marginal means'));
    if (L.lang === 'R') {
      out.push(c + 'emmeans forms the reference grid as the page does: a continuous predictor at its mean, the other factors averaged with equal weights.');
      out.push('em <- emmeans::emmeans(m, ' + L.str(m.factor) + ', level = level, lmer.df = "asymptotic")');
      out.push('es <- as.data.frame(summary(em, type = "link"))', 'er <- as.data.frame(summary(em, type = "response"))');
      out.push('ep <- as.data.frame(summary(emmeans::contrast(em, "pairwise", adjust = "tukey"), infer = c(TRUE, TRUE), level = level))');
      m.levels.forEach((l, i) => {
        out.push(rep(L, r, 'emm ' + l, 'es[' + (i + 1) + ', 2]'), rep(L, r, 'emm se ' + l, 'es[' + (i + 1) + ', 3]'), rep(L, r, 'emm lower ' + l, 'es[' + (i + 1) + ', 5]'), rep(L, r, 'emm upper ' + l, 'es[' + (i + 1) + ', 6]'), rep(L, r, 'emm response ' + l, 'er[' + (i + 1) + ', 2]'));
      });
      let p = 0;
      for (let i = 0; i < m.levels.length; i++) for (let j = i + 1; j < m.levels.length; j++) {
        p++;
        const k = m.levels[i] + ' - ' + m.levels[j];
        out.push(rep(L, r, 'pair ' + k, 'ep[' + p + ', 2]'), rep(L, r, 'pair se ' + k, 'ep[' + p + ', 3]'), rep(L, r, 'pair t ' + k, 'ep[' + p + ', 7]'), rep(L, r, 'pair p ' + k, 'ep[' + p + ', 8]'), rep(L, r, 'pair lower ' + k, 'ep[' + p + ', 5]'), rep(L, r, 'pair upper ' + k, 'ep[' + p + ', 6]'));
      }
    } else {
      out.push(c + 'The reference grid by hand: each level with the other factors\' levels in every combination (equal weights) and the continuous predictors at their means over the fitted rows.');
      const others = Object.keys(m.grid.factors).filter(f => f !== m.factor);
      const combos = others.reduce((acc, f) => acc.flatMap(o => m.grid.factors[f].map(l => Object.assign({}, o, { [f]: l }))), [{}]);
      m.levels.forEach((l, i) => {
        const rows = combos.map(o => Object.assign({}, m.grid.continuous, o, { [m.factor]: l }));
        out.push(...newRows(r, L, 'g' + (i + 1), rows));
        out.push(L.assign('xb' + (i + 1), L.lang === 'py' ? 'np.mean(grid_rows(m, d, g' + (i + 1) + ', names_here), axis=0)' : "mean(grid_rows(m, tbl, g" + (i + 1) + ", names_here), 1)'"));
      });
      const kk = m.levels.length;
      const dfExpr = Number.isFinite(m.df) ? String(m.df) : (L.lang === 'py' ? 'np.inf' : 'Inf');
      out.push(L.assign('df_emm', dfExpr));
      out.push(L.assign('q_emm', L.lang === 'py' ? 'stats.t.ppf(1 - alpha / 2, df_emm) if np.isfinite(df_emm) else stats.norm.ppf(1 - alpha / 2)' : 'wald_quantile(alpha, df_emm)'));
      m.levels.forEach((l, i) => {
        const xb = 'xb' + (i + 1);
        const eta = L.lang === 'py' ? 'float(' + xb + ' @ b)' : xb + "' * b";
        const se = L.lang === 'py' ? 'float(np.sqrt(' + xb + ' @ V @ ' + xb + '))' : 'sqrt(' + xb + "' * V * " + xb + ')';
        out.push(L.assign('e' + (i + 1), eta), L.assign('s' + (i + 1), se));
        out.push(rep(L, r, 'emm ' + l, 'e' + (i + 1)), rep(L, r, 'emm se ' + l, 's' + (i + 1)), rep(L, r, 'emm lower ' + l, 'e' + (i + 1) + ' - q_emm * s' + (i + 1)), rep(L, r, 'emm upper ' + l, 'e' + (i + 1) + ' + q_emm * s' + (i + 1)), rep(L, r, 'emm response ' + l, linkinv(L, 'e' + (i + 1))));
      });
      out.push(c + 'Pairwise differences with Tukey\'s correction: the studentized range over ' + kk + ' means.');
      out.push(L.assign('q_tukey', L.lang === 'py' ? 'studentized_range_ppf(level, ' + kk + ', df_emm) / np.sqrt(2)' : 'studrange_inv(level, ' + kk + ', df_emm) / sqrt(2)'));
      for (let i = 0; i < kk; i++) for (let j = i + 1; j < kk; j++) {
        const k = m.levels[i] + ' - ' + m.levels[j];
        const cvec = L.lang === 'py' ? '(xb' + (i + 1) + ' - xb' + (j + 1) + ')' : '(xb' + (i + 1) + ' - xb' + (j + 1) + ')';
        out.push(L.assign('cv', cvec));
        out.push(L.assign('dd', L.lang === 'py' ? 'float(cv @ b)' : "cv' * b"), L.assign('ds', L.lang === 'py' ? 'float(np.sqrt(cv @ V @ cv))' : "sqrt(cv' * V * cv)"));
        out.push(rep(L, r, 'pair ' + k, 'dd'), rep(L, r, 'pair se ' + k, 'ds'), rep(L, r, 'pair t ' + k, 'dd / ds'));
        out.push(rep(L, r, 'pair p ' + k, L.lang === 'py' ? 'studentized_range_sf(abs(dd / ds) * np.sqrt(2), ' + kk + ', df_emm)' : '1 - studrange_cdf(abs(dd / ds) * sqrt(2), ' + kk + ', df_emm)'));
        out.push(rep(L, r, 'pair lower ' + k, 'dd - q_tukey * ds'), rep(L, r, 'pair upper ' + k, 'dd + q_tukey * ds'));
      }
    }
  }
  if (r.calc) {
    out.push(L.sect('Calculator'));
    out.push(...newRows(r, L, 'nc', [r.calc.row]));
    out.push(L.assign('Xc', 'grid_rows(m, ' + (L.lang === 'm' ? 'tbl' : 'd') + ', nc, ' + (L.lang === 'R' ? 'coef_names' : 'names_here') + ')'));
    out.push(L.assign('etac', matvec(L, 'Xc', 'b')), L.assign('sec', rowSe(L, 'Xc', 'V')));
    out.push(rep(L, r, 'calc eta', at(L, 'etac', 0)), rep(L, r, 'calc se', at(L, 'sec', 0)), rep(L, r, 'calc fit', linkinv(L, at(L, 'etac', 0))));
    out.push(rep(L, r, 'calc lower', 'min(' + linkinv(L, at(L, 'etac', 0) + ' - q_wald * ' + at(L, 'sec', 0)) + ', ' + linkinv(L, at(L, 'etac', 0) + ' + q_wald * ' + at(L, 'sec', 0)) + ')'));
    out.push(rep(L, r, 'calc upper', 'max(' + linkinv(L, at(L, 'etac', 0) + ' - q_wald * ' + at(L, 'sec', 0)) + ', ' + linkinv(L, at(L, 'etac', 0) + ' + q_wald * ' + at(L, 'sec', 0)) + ')'));
  }
  return { body: out, need: ['fit', 'grid'].concat(L.lang === 'm' && r.means ? ['studrange'] : []) };
}
BODIES.predict = { R: predictBody, py: predictBody, m: predictBody };

// ── Compare ──────────────────────────────────────────────────────────────

function compareBody(r, L) {
  const out = [L.lang === 'm' ? 'report_start(check_details);' : 'report_start(check_details)', L.sect('Candidate models')];
  const c = L.comment;
  out.push(c + 'Each candidate fitted by maximum likelihood to the same rows.');
  const fits = [];
  r.candidates.forEach((cand, i) => {
    const v = 'm' + (i + 1);
    fits.push(v);
    const call = L.lang === 'R' ? 'fit_model(d, ' + L.str(cand.family) + ', ' + L.str(cand.link) + ', ' + L.str(cand.formula.R) + ', FALSE)'
      : L.lang === 'py' ? 'fit_model(d, ' + L.str(cand.family) + ', ' + L.str(cand.link) + ', ' + L.str(cand.formula.py) + ', False' + (cand.mixed ? ', group=' + L.str(cand.olre && !cand.group ? 'obs' : cand.group) + ', re_formula=' + L.str(cand.slope ? '~' + cand.slope : '1') : '') + ')'
        : 'fit_model(tbl, ' + L.str(cand.family) + ', ' + L.str(cand.link) + ', ' + L.str(cand.formula.m) + ', false)';
    out.push(L.assign(v, call));
    out.push(rep(L, r, 'loglik ' + cand.name, 'fit_loglik(' + v + ')'), rep(L, r, 'k ' + cand.name, 'fit_k(' + v + ')'));
    out.push(rep(L, r, 'AIC ' + cand.name, '-2 * fit_loglik(' + v + ') + 2 * fit_k(' + v + ')'), rep(L, r, 'BIC ' + cand.name, '-2 * fit_loglik(' + v + ') + fit_k(' + v + ') * ' + (L.lang === 'py' ? 'np.log(len(d))' : L.lang === 'm' ? 'log(height(tbl))' : 'log(nrow(d))')));
  });
  if (r.pairs.length) {
    out.push(L.sect('Likelihood-ratio tests'));
    for (const p of r.pairs) {
      const ia = r.candidates.findIndex(x => x.name === p.a), ib = r.candidates.findIndex(x => x.name === p.b);
      out.push(L.assign('s', '2 * (fit_loglik(m' + (ib + 1) + ') - fit_loglik(m' + (ia + 1) + '))'));
      out.push(rep(L, r, 'LRT ' + p.a + ' vs ' + p.b, 's'));
      if (p.kind === 'random') out.push(c + boundaryNote(p.df, !!r.candidates[ib].slope));
      out.push(rep(L, r, 'LRT p ' + p.a + ' vs ' + p.b, p.kind === 'random' ? boundaryExpr(L, p.df, !!r.candidates[ib].slope) : chisqUpper(L, 's', String(p.df))));
    }
  }
  return { body: out, need: ['fit'] };
}
BODIES.compare = { R: compareBody, py: compareBody, m: compareBody };

// ── Assembly ─────────────────────────────────────────────────────────────

const SECTION_RE = { R: /^## (.*) ----$/, py: /^# ---- (.*) ----$/, m: /^%% (.*)$/ };
const PRINTS_RE = /\b(report|shapiro_check)\(/;
function headings(body, L) {
  const lines = body.join('\n').split('\n');
  const re = SECTION_RE[L.lang], end = L.lang === 'm' ? ';' : '';
  const heads = [];
  lines.forEach((ln, i) => { const m = re.exec(ln); if (m) heads.push([i, m[1]]); });
  const out = [];
  let last = -1;
  heads.forEach(([i, title], h) => {
    const stop = h + 1 < heads.length ? heads[h + 1][0] : lines.length;
    if (lines.slice(i + 1, stop).some(x => PRINTS_RE.test(x) && !/^\s*(#|%)/.test(x))) heads[h].push(true);
  });
  for (let h = 0; h < heads.length; h++) if (heads[h][2]) last = h;
  const summaryAt = last >= 0 ? (last + 1 < heads.length ? heads[last + 1][0] : lines.length) : -1;
  lines.forEach((ln, i) => {
    if (i === summaryAt) out.push('report_summary()' + end);
    out.push(ln);
    const h = heads.find(x => x[0] === i);
    if (h && h[2]) out.push('report_section(' + L.str(h[1]) + ')' + end);
  });
  if (summaryAt === lines.length) out.push('report_summary()' + end);
  return out;
}

/**
 * The script of a recipe in one language.
 * @param {object} recipe
 * @param {'m'|'R'|'tidy'|'py'} lang
 * @returns {string}
 */
export function analysisScript(recipe, lang) {
  const L = Object.prototype.hasOwnProperty.call(LANG, lang) ? LANG[lang] : null;
  if (!L) throw new RangeError('analysisScript: unknown language ' + lang);
  const page = Object.prototype.hasOwnProperty.call(BODIES, recipe.page) ? BODIES[recipe.page] : null;
  if (!page || !page[L.lang]) throw new RangeError('analysisScript: unknown page ' + recipe.page);
  const snippets = LIB[L.lang];
  current = recipe;
  const { body, need } = page[L.lang](recipe, L);
  const figs = figureBlock(recipe, L);
  const helpers = Array.from(new Set((need || []).concat(figs.need))).map(k => {
    const s = snippets[k];
    if (!s) throw new RangeError('analysisScript: no ' + lang + ' snippet ' + k);
    return s.trim();
  });
  const figLib = FIG[L.tidy ? 'tidy' : L.lang];
  for (const k of figs.fig) {
    if (!figLib[k]) throw new RangeError('analysisScript: no ' + lang + ' figure helper ' + k);
    helpers.push(figLib[k].trim());
  }
  const main = [...settingsBlock(recipe, L), ...dataBlock(recipe, L), ...headings(body.concat(figs.lines), L)];
  const lines = header(recipe, L, helpers.concat(main).join('\n'));
  lines.push('', ...L.prelude(helpers.concat(main).join('\n')));
  if (lang !== 'm') lines.push('', snippets.report.trim(), '', ...helpers.flatMap(h => [h, '']));
  lines.push(...main);
  if (lang === 'm') lines.push('', '%% Local functions', LIB.m.report.trim(), '', ...helpers.flatMap(h => [h, '']));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '') + '\n';
}

/**
 * The report lines of a script's output: name to number (yes/no to 1/0, NaN
 * and Inf in any case to NaN and Infinity) or string.
 * @param {string} text
 * @returns {Map<string, number|string>}
 */
export function parseReport(text) {
  const out = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^(.+?): (.*)$/.exec(raw);
    if (!m) continue;
    const v = m[2].replace(/\s+\(analyzer: .*\)$/, '').trim();
    if (v === 'yes') out.set(m[1], 1);
    else if (v === 'no') out.set(m[1], 0);
    else if (/^[-+]?(nan|inf)$/i.test(v)) out.set(m[1], /nan/i.test(v) ? NaN : v[0] === '-' ? -Infinity : Infinity);
    else if (/^[-+]?(\d+\.?\d*([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)$/.test(v)) out.set(m[1], Number(v));
    else out.set(m[1], v);
  }
  return out;
}
