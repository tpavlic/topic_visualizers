// The "Regenerate these results in" scripts: a recipe becomes a MATLAB, R, or
// Python script that recomputes the page's numbers and prints each beside the
// analyzer's own. The harness here writes a script, runs it where the language
// is installed, parses its report lines, and compares them with the recipe's
// `expect` map. R and Python run on every test run when installed (the full
// matrix under GLMM_SCRIPTS=1, and otherwise only the fixtures marked smoke, a
// subset on every page); MATLAB runs under GLMM_MATLAB=1 only, because its
// start-up takes about a minute, and then runs every script in one session
// (see "MATLAB batch" below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisScript as writeScript, parseReport, scriptFileName, ascii, sectionLine, ANALYSIS_WRITERS, tolFor } from '../js/io/analysis_scripts.js';
import { modelRecipe, diagnosticsRecipe, predictRecipe, compareRecipe, varianceRecipe } from '../js/io/recipes.js';
import { varianceParts } from '../js/stats/variance.js';
import { capability, capabilityAll } from '../js/io/capability.js';
import { csvMode } from '../js/io/recipes.js';
import { dataFileText, uniformsFileText } from '../js/io/datafiles.js';
import { makeDataset } from '../js/data/model.js';
import { sniff, buildTable } from '../js/io/parse.js';
import { EXAMPLES } from '../js/data/examples.js';
import { fitModel } from '../js/stats/fit.js';
import { termTests, randomEffectTest, waldTable, predictRows, marginalMeans, effectGrid, ordinalPredictRows } from '../js/stats/inference.js';
import { residualSet } from '../js/stats/residuals.js';
import { shapiroWilk } from '../js/stats/normality.js';

// ── Harness ─────────────────────────────────────────────────────────────

function has(cmd, probeArgs) {
  const r = spawnSync(cmd, probeArgs, { encoding: 'utf8' });
  return !r.error && r.status === 0;
}
// The Python scripts need statsmodels 0.14 or later and pandas; without them this exits with status 3.
const PY_PROBE = 'import re, sys, numpy, scipy, pandas; import statsmodels; v = tuple(int(re.match(r"\\d+", p).group()) for p in statsmodels.__version__.split(".")[:2]); sys.exit(0 if v >= (0, 14) else 3)';
function pyStatus() {
  const r = spawnSync('python3', ['-c', PY_PROBE], { encoding: 'utf8' });
  if (r.error || r.status === 1) return 'python3 with NumPy, SciPy, pandas, and statsmodels is not installed';
  if (r.status === 3) return 'statsmodels is older than 0.14';
  return r.status === 0 ? true : 'python3 with NumPy, SciPy, pandas, and statsmodels is not installed';
}
const PY = pyStatus();
export const HAS = {
  R: has('Rscript', ['--version']),
  tidy: has('Rscript', ['--vanilla', '-e', 'if (getRversion() < "4.1" || packageVersion("dplyr") < "1.1") quit(status = 1); for (p in c("tibble","tidyr","broom","ggplot2")) if (!requireNamespace(p, quietly = TRUE)) quit(status = 1)']),
  py: PY === true,
  // Found on the PATH, not started: the batch below starts MATLAB once, and a
  // MATLAB that cannot start fails every MATLAB test with its own message.
  m: process.env.GLMM_MATLAB === '1' && has('sh', ['-c', 'command -v matlab'])
};
// Why a language cannot run here.
const MISSING = { R: 'R is not installed', tidy: 'R 4.1 with dplyr 1.1, tibble, tidyr, broom, and ggplot2 is not installed', py: PY,
  m: process.env.GLMM_MATLAB === '1' ? 'MATLAB is not installed' : 'MATLAB runs under GLMM_MATLAB=1 only' };
const FULL = process.env.GLMM_SCRIPTS === '1';
export const LANGS = ['R', 'tidy', 'py', 'm'];

/** Loads a bundled example as a dataset, as the Import page does. */
export function example(id) {
  const ex = EXAMPLES.find(x => x.id === id);
  const sn = sniff(ex.text, { name: ex.mapping.name });
  return buildTable(sn, ex.mapping).dataset;
}

/**
 * Writes the script, runs it, and returns the parsed report and both output
 * streams (or throws with the output). `text` replaces the script the recipe
 * gives, and `files` (name to contents) are written beside it, where the
 * script runs. MATLAB runs here in a session of its own; the fixtures below
 * run their MATLAB scripts through the batch instead (runIn).
 */
export function runScript(recipe, lang, { text = null, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'glmm-regen-'));
  const name = scriptFileName(recipe, lang);
  const f = join(dir, name);
  try {
    for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
    writeFileSync(f, text != null ? text : analysisScript(recipe, lang));
    // A hung script fails its test instead of hanging the suite. A script with a
    // line per replication can print megabytes, past spawnSync's 1 MB default.
    const big = 256 * 1024 * 1024;
    let r;
    if (lang === 'R' || lang === 'tidy') r = spawnSync('Rscript', ['--vanilla', f], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: big });
    else if (lang === 'py') r = spawnSync('python3', [f], { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: big, env: Object.assign({}, process.env, { MPLBACKEND: 'Agg' }) });
    else r = spawnSync('matlab', ['-batch', `cd('${dir}'); run('${name}')`], { cwd: dir, encoding: 'utf8', timeout: 600000, maxBuffer: big });
    return Object.assign(scriptResult(r, lang, name), { file: f });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A finished run ({ status, stdout, stderr, error }, as spawnSync gives it) as runScript returns it, or the error it throws. */
function scriptResult(r, lang, name) {
  if (r.error) throw new Error(`${lang} script did not finish (${name}): ${r.error.message}\n${r.stdout || ''}\n${r.stderr || ''}`);
  if (r.status !== 0) throw new Error(`${lang} script failed (${name}):\n${r.stdout}\n${r.stderr}`);
  return { report: parseReport(r.stdout), stdout: r.stdout, stderr: r.stderr || '' };
}

// ── MATLAB batch ────────────────────────────────────────────────────────
//
// MATLAB takes from fifteen seconds to a minute to start, which, once per
// script, came to most of the full matrix's hour. Every MATLAB script in this
// file therefore runs in one session. A test registers its script when it is
// defined (matlabJob, with a function that builds the script and its files),
// the batch starts once every test is defined (startMatlab, the last line of
// this file) and runs in the background while the R and Python tests run, and
// each MATLAB test then waits for its own script's result (matlabOutcome),
// which reads as a run of its own would. test/run_matlab_batch.m runs each
// script from its own folder in a fresh workspace and writes what it printed
// into that folder. A script still running after M_TIMEOUT is stopped and
// fails its own test, as does one that brings MATLAB down, and the scripts
// after it run in a new session. A run filtered by --test-name-pattern or
// --test-skip-pattern batches only the scripts of the tests it selects, and a
// test whose script was left out gets it from a later batch.

const HERE = dirname(fileURLToPath(import.meta.url));
const M_TIMEOUT = 600000;   // one script, as when each started a MATLAB of its own, or the gap between two
const M_START = 600000;     // MATLAB's start, up to its first script
const M_EXIT = 120000;      // MATLAB's exit, after its last script
const mJobs = [];
let mRoot = null, mChild = null, mBatches = 0, mOpen = false;

// The name patterns node passes to this file's process, as regular expressions.
function namePatterns(flag) {
  const out = [], a = process.execArgv;
  for (let i = 0; i < a.length; i++) {
    let v = null;
    if (a[i].startsWith(flag + '=')) v = a[i].slice(flag.length + 1);
    else if (a[i] === flag && i + 1 < a.length) v = a[++i];
    if (v == null) continue;
    const m = /^\/(.*)\/([a-z]*)$/s.exec(v);
    out.push(m ? new RegExp(m[1], m[2]) : new RegExp(v));
  }
  return out;
}
const NAME_ONLY = namePatterns('--test-name-pattern'), NAME_SKIP = namePatterns('--test-skip-pattern');
const selected = title => (!NAME_ONLY.length || NAME_ONLY.some(re => re.test(title))) && !NAME_SKIP.some(re => re.test(title));

/**
 * Registers the MATLAB script of the test titled `title`, or returns null when
 * MATLAB does not run here (`smoke` as for skipFor). `build()` returns
 * { name, text, files }: the script's file name, its text, and the files
 * (name to contents) written beside it. It runs when the batch starts, and an
 * error it throws fails the test.
 */
function matlabJob(title, smoke, build) {
  if (skipFor('m', smoke)) return null;
  const job = { id: mJobs.length, wanted: selected(title), build, dir: null, script: null, result: null };
  job.done = new Promise(resolve => { job.settle = r => { if (!job.result) { job.result = r; resolve(r); } }; });
  mJobs.push(job);
  if (mOpen && job.wanted) runMatlab();
  return job;
}

/** Waits for a job's run: { status, stdout, stderr, error }, as spawnSync gives it. */
function matlabOutcome(job) {
  job.wanted = true;
  if (!job.result && !collect(job)) runMatlab();
  return job.done;
}

// Settles a job the driver has finished, and says whether it had.
function collect(j) {
  if (j.result || !j.dir || !existsSync(join(j.dir, 'status.txt'))) return !!j.result;
  const read = f => readFileSync(join(j.dir, f), 'utf8');
  j.settle({ status: Number(read('status.txt')), stdout: read('stdout.txt'), stderr: read('stderr.txt'), error: null });
  return true;
}

/** Waits for a job's run as matlabOutcome does, and throws the error its build() threw, if any. */
async function matlabRun(job) {
  const r = await matlabOutcome(job);
  if (r.buildError) throw r.buildError;
  return r;
}

/** Runs a fixture's script: in the batch when `job` is given, and otherwise as runScript does. */
async function runIn(job, recipe, lang, opts) {
  if (!job) return runScript(recipe, lang, opts);
  return scriptResult(await matlabRun(job), 'm', job.script + '.m');
}

/** Starts the batch; called once, after every test is defined. */
function startMatlab() {
  mOpen = true;
  runMatlab();
}

function stopMatlab() {
  if (mChild) try { process.kill(-mChild.pid, 'SIGKILL'); } catch { /* already gone */ }
}

// Starts one MATLAB session on every wanted script not yet run, unless one is
// running; when it ends, the next starts on whatever is left.
function runMatlab() {
  if (mChild || !mOpen) return;
  const todo = mJobs.filter(j => j.wanted && !j.result);
  if (!todo.length) return;
  if (!mRoot) {
    mRoot = mkdtempSync(join(tmpdir(), 'glmm-matlab-'));
    // MATLAB runs in a process group of its own, so that stopping it stops
    // every process it started; this process stops it on the way out.
    process.on('exit', () => { stopMatlab(); rmSync(mRoot, { recursive: true, force: true }); });
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => { stopMatlab(); if (!process.listenerCount(sig)) process.kill(process.pid, sig); });
    }
  }
  const list = [];
  for (const j of todo) {
    if (!j.dir) {
      try {
        const { name, text, files = {} } = j.build();
        const dir = join(mRoot, 'job' + String(j.id).padStart(4, '0'));
        mkdirSync(dir);
        for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body);
        writeFileSync(join(dir, name), text);
        j.dir = dir;
        j.script = name.replace(/\.m$/, '');
      } catch (e) {
        j.settle({ status: null, stdout: '', stderr: '', error: e, buildError: e });
        continue;
      }
    }
    list.push(j);
  }
  if (!list.length) return;
  const n = ++mBatches;
  const listFile = join(mRoot, 'batch' + n + '.txt'), logFile = join(mRoot, 'batch' + n + '.log');
  writeFileSync(listFile, list.map(j => j.dir + '\t' + j.script).join('\n') + '\n');
  const q = s => s.replace(/'/g, "''");
  const fd = openSync(logFile, 'w');
  try {
    mChild = spawn('matlab', ['-batch', `addpath('${q(HERE)}'); run_matlab_batch('${q(listFile)}')`],
      { cwd: mRoot, stdio: ['ignore', fd, fd], detached: true });
  } finally { closeSync(fd); }
  const child = mChild, t0 = Date.now();
  const at = (j, f) => join(j.dir, f);
  const read = (j, f) => (existsSync(at(j, f)) ? readFileSync(at(j, f), 'utf8') : '');
  const log = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  let stopped = null;   // the job MATLAB was stopped in, 'start', or 'between'
  // `done` counts the finished scripts, and `doneAt` is when the latest of them
  // finished. Between two scripts (in the driver's own clean-up) or after the
  // last, MATLAB is stopped once nothing has finished for M_TIMEOUT or M_EXIT,
  // and the scripts not yet started run in a new session.
  let done = 0, doneAt = t0;
  const poll = () => {
    for (const j of list) collect(j);
    const n = list.filter(j => j.result).length;
    if (n !== done) { done = n; doneAt = Date.now(); }
    if (stopped) return;
    const cur = list.find(j => !j.result && existsSync(at(j, 'started.txt')));
    if (cur && Date.now() - statSync(at(cur, 'started.txt')).mtimeMs > M_TIMEOUT) { stopped = cur; stopMatlab(); }
    if (!cur && !list.some(j => existsSync(at(j, 'started.txt'))) && Date.now() - t0 > M_START) { stopped = 'start'; stopMatlab(); }
    if (!cur && done && Date.now() - doneAt > (done === list.length ? M_EXIT : M_TIMEOUT)) { stopped = 'between'; stopMatlab(); }
  };
  const timer = setInterval(poll, 200);
  let ended = false;
  const end = how => {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    mChild = null;
    poll();
    const begun = list.some(j => existsSync(at(j, 'started.txt')));
    for (const j of list) {
      if (j.result) continue;
      let why;
      if (stopped === j) why = `it was still running after ${M_TIMEOUT / 1000} s, and so MATLAB was stopped`;
      else if (existsSync(at(j, 'started.txt'))) why = `MATLAB stopped while running it (${how})`;
      else if (!begun) why = stopped === 'start' ? `MATLAB had not started a script after ${M_START / 1000} s` : `MATLAB did not start (${how})`;
      else continue;   // not started: the next session runs it
      j.settle({ status: null, stdout: read(j, 'stdout.txt'), stderr: why + '\n' + log(), error: new Error(why) });
    }
    runMatlab();
  };
  child.on('error', e => end(e.message));
  child.on('exit', (code, signal) => end(signal ? 'signal ' + signal : 'exit status ' + code));
}

// Tolerances come from tolFor in js/io/analysis_scripts.js, the same ones the
// scripts check their own results with.
export { tolFor };

// Every script the tests write prints its results in detail, each beside the
// analyzer's value, as parseReport reads them: check_details is set.
export function detailed(text) {
  return text.replace(/^check_details (<-|=) (FALSE|False|false)(;?)$/m,
    (m, op, v, semi) => 'check_details ' + op + ' ' + { FALSE: 'TRUE', False: 'True', false: 'true' }[v] + semi);
}
function analysisScript(recipe, lang, opts) { return detailed(writeScript(recipe, lang, opts)); }

/** Compares a parsed report with a recipe's expect map; fails with every mismatch listed. */
export function compareReport(report, expect, lang, recipe) {
  const bad = [];
  for (const [rawKey, want] of Object.entries(expect)) {
    // "[optional]" marks a line only MATLAB may leave out (the Shapiro-Wilk
    // check, whose swtest the toolbox has only from R2026b).
    const optional = / \[optional\]$/.test(rawKey) && lang === 'm';
    const key = rawKey.replace(/ \[optional\]$/, '');
    if (!report.has(key)) { if (!optional) bad.push(`${key}: missing`); continue; }
    if (want === null) continue;
    const got = report.get(key);
    if (typeof want === 'string') { if (String(got) !== want) bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    if (typeof got !== 'number') { bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    if (Number.isNaN(want) || Number.isNaN(got)) { if (!(Number.isNaN(want) && Number.isNaN(got))) bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    if (!Number.isFinite(want) || !Number.isFinite(got)) { if (got !== want) bad.push(`${key}: got ${got}, expected ${want}`); continue; }
    const t = tolFor(key, lang, recipe);
    const err = Math.abs(got - want);
    const ok = t.abs != null ? err <= t.abs : err <= t.rel * Math.max(1, Math.abs(want));
    if (!ok) bad.push(`${key}: got ${got}, expected ${want}`);
  }
  assert.equal(bad.length, 0, `${lang}:\n  ` + bad.join('\n  '));
}

// Why a language's run is skipped, or false to run it.
function skipFor(lang, smoke) {
  if (!HAS[lang]) return MISSING[lang];
  if (!smoke && !FULL && lang !== 'm') return 'GLMM_SCRIPTS=1 runs the full matrix';
  return false;
}

/**
 * Runs one recipe through every installed language and compares. `smoke`
 * runs even without GLMM_SCRIPTS=1; `also(stdout, lang, stderr)` makes further
 * checks on a run's raw output. `notInR` matches the keys that R and Tidy R
 * print but are not held to: those resting on R's own qtukey and ptukey,
 * which are approximate on few degrees of freedom (about 1% or more off at 2,
 * several percent with many designs), where the scripts keep them as the
 * idiomatic call and say so in a comment.
 */
export function checkRecipe(name, recipe, { smoke = false, also = null, notInR = null, langs = LANGS } = {}) {
  // Base R's stderr for this fixture, kept from its own run (or run when Tidy R needs it).
  let baseErr = null;
  const cap = recipe.capability || capability(recipe.spec);
  for (const lang of LANGS) {
    if (!langs.includes(lang)) continue;
    const title = `${name} regenerates in ${lang}`;
    if (!cap[lang].ok) {
      test(title, () => { assert.throws(() => { throw new Error('grayed'); }, /grayed/, 'a grayed language is not run'); });
      continue;
    }
    const job = lang === 'm' ? matlabJob(title, smoke, () => ({ name: scriptFileName(recipe, 'm'), text: analysisScript(recipe, 'm') })) : null;
    test(title, { skip: skipFor(lang, smoke) }, async () => {
      const { report, stdout, stderr } = await runIn(job, recipe, lang);
      if (lang === 'R') baseErr = stderr;
      let expect = recipe.expect;
      if (notInR && (lang === 'R' || lang === 'tidy')) {
        expect = Object.assign({}, expect);
        for (const k of Object.keys(expect)) if (notInR.test(k)) expect[k] = null;
      }
      compareReport(report, expect, lang === 'tidy' ? 'R' : lang, recipe);
      // The tidyverse layer of the Tidy R script (its tibbles, broom's tables,
      // and ggplot2's figures) adds nothing to what Base R prints on stderr.
      if (lang === 'tidy') {
        if (baseErr === null) baseErr = runScript(recipe, 'R').stderr;
        assert.deepEqual(stderrAdded(stderr, baseErr), [], 'Tidy R prints on stderr what Base R does not:\n' + stderr);
      }
      if (also) also(stdout, lang, stderr);
    });
  }
}

/**
 * Runs a recipe in CSV mode: the script embeds no data and reads the files
 * the export row's Data buttons save, written beside it as the Import page
 * writes them. `make()` builds the recipe afresh.
 */
export function checkCsvMode(name, make, ds, { smoke = false } = {}) {
  const recipe = csvMode(make(), ds);
  const files = { [recipe.csvFile]: dataFileText(ds) };
  if (recipe.uniformsFile) files[recipe.uniformsFile] = uniformsFileText(ds, recipe.uniforms);
  const cap = recipe.capability || capability(recipe.spec);
  const resp = ds.columns.find(c => c.role === 'response').name;
  for (const lang of LANGS) {
    const title = `${name} regenerates in ${lang}`;
    if (!cap[lang].ok) continue;
    const job = lang === 'm' ? matlabJob(title, smoke, () => ({ name: scriptFileName(recipe, 'm'), text: analysisScript(recipe, 'm'), files })) : null;
    test(title, { skip: skipFor(lang, smoke) }, async () => {
      const text = analysisScript(recipe, lang);
      assert.ok(text.includes(recipe.csvFile), 'the script names its data file');
      assert.ok(!new RegExp('^' + resp + '(_col)? (<-|=) ', 'm').test(text), 'the script embeds no data');
      if (recipe.uniformsFile) assert.ok(text.includes(recipe.uniformsFile) && !/^u (<-|=) (c\(|np\.array|\[)/m.test(text), 'the uniforms come from their file');
      const { report } = await runIn(job, recipe, lang, { text, files });
      compareReport(report, recipe.expect, lang === 'tidy' ? 'R' : lang, recipe);
    });
  }
}

/** The lines of `stderr` that `base` lacks, blank lines ignored. */
export function stderrAdded(stderr, base) {
  const seen = new Set(String(base).split(/\r?\n/).map(l => l.trim()));
  return String(stderr).split(/\r?\n/).map(l => l.trim()).filter(l => l && !seen.has(l));
}


// ── Fixtures ────────────────────────────────────────────────────────────
// Each fixture builds a recipe as the page does, from the same stats modules,
// and runs it in every language the capability table keeps live.

const LEVEL = 0.95;
const specOf = (ds, response, family, terms, extra = {}) => Object.assign({ dataset: ds.id, response, family, link: null, terms, group: null, nested: null, slope: null, olre: false, reml: false }, extra);

/** The Model page's recipe of a spec on a dataset. */
export function modelOf(ds, spec, title) {
  const result = fitModel(ds, spec);
  if (result.refused) throw new Error('refused');
  const waldRows = waldTable(result, LEVEL);
  const tt = termTests(ds, spec, result);
  const rt = result.fit.mixed ? randomEffectTest(ds, spec, result) : null;
  return modelRecipe({ ds, spec, result, level: LEVEL, title: title || 'Model: ' + result.formula, provenance: { dataset: ds.name, formula: result.formula, family: spec.family }, waldRows, termTests: tt, randomTest: rt });
}

/** The Diagnostics page's recipe. */
export function diagnosticsOf(ds, spec, title) {
  const result = fitModel(ds, spec);
  const res = residualSet(result);
  const r = Array.from(res.quantile).filter(Number.isFinite);
  let m = 0, s2 = 0;
  for (const v of r) m += v;
  m /= r.length;
  for (const v of r) s2 += (v - m) * (v - m);
  const sw = r.length >= 3 && r.length <= 5000 ? shapiroWilk(r) : null;
  const rec = diagnosticsRecipe({ ds, spec, result, level: LEVEL, title: title || 'Diagnostics: ' + result.formula, provenance: { dataset: ds.name, formula: result.formula }, residuals: res, summary: { mean: m, sd: Math.sqrt(s2 / Math.max(1, r.length - 1)), sw } });
  // MATLAB may lack a Shapiro-Wilk function.
  for (const k of ['shapiro W', 'shapiro p']) if (k in rec.expect) { rec.expect[k + ' [optional]'] = rec.expect[k]; delete rec.expect[k]; }
  return rec;
}

/** The Predict page's recipe: the effect plot along `x` by `by`, the means of `factor`, and the calculator at `row`. */
export function predictOf(ds, spec, { x, by = null, factor = null, row = null, intercept = false, hold = {}, weights = 'equal' }, title) {
  const result = fitModel(ds, spec);
  let effect = null;
  if (spec.family === 'ordinal') {
    // The ordinal model: a probability per level, along x or from the thresholds alone.
    const levels = ds.columns.find(c => c.name === spec.response).levels;
    const rows = x ? effectGrid(ds, result, x, null, 7, hold).series[0].rows : intercept ? [{}] : null;
    if (rows) effect = { x: x || null, by: null, ordinal: true, levels, weights, series: [{ label: 'probabilities', by: null, rows, probs: ordinalPredictRows(ds, result, rows, weights) }] };
    const calc = row ? { row, ordinal: true, levels, probs: ordinalPredictRows(ds, result, [row])[0] } : null;
    return predictRecipe({ ds, spec, result, level: LEVEL, title: title || 'Predict: ' + result.formula, provenance: { dataset: ds.name, formula: result.formula }, effect, means: null, calc });
  }
  if (x) {
    const g = effectGrid(ds, result, x, by, 7, hold);
    effect = { x, by, weights, series: g.series.map(s => ({ label: s.label, rows: s.rows, pred: predictRows(ds, result, s.rows, LEVEL, weights) })) };
  } else if (intercept) {
    // No predictor: the page's one predicted mean across the observations.
    effect = { x: null, by: null, series: [{ label: 'predicted mean', by: null, rows: [{}], pred: predictRows(ds, result, [{}], LEVEL) }] };
  }
  const means = factor ? marginalMeans(ds, result, factor, LEVEL, weights) : null;
  const calc = row ? { row, pred: predictRows(ds, result, [row], LEVEL) } : null;
  return predictRecipe({ ds, spec, result, level: LEVEL, title: title || 'Predict: ' + result.formula, provenance: { dataset: ds.name, formula: result.formula }, effect, means, calc });
}

/** The Variance explained page's recipe. */
export function varianceOf(ds, spec, title) {
  const result = fitModel(ds, spec);
  const parts = varianceParts(ds, spec, result);
  if (!parts.ok) throw new Error(parts.why);
  return varianceRecipe({ ds, spec, result, level: LEVEL, title: title || 'Variance explained: ' + result.formula, provenance: { dataset: ds.name, formula: result.formula }, parts });
}

/** The Compare page's recipe of several specs on one dataset. */
export function compareOf(ds, named, title) {
  const candidates = named.map(([name, spec]) => ({ name, spec: Object.assign({}, spec, { reml: false }), result: fitModel(ds, Object.assign({}, spec, { reml: false })) }));
  const pairs = [];
  for (const a of candidates) for (const b of candidates) {
    if (a === b) continue;
    const ta = a.spec.terms.map(t => (typeof t === 'string' ? t : JSON.stringify(t))), tb = b.spec.terms.map(t => (typeof t === 'string' ? t : JSON.stringify(t)));
    const sameRandom = (a.spec.group || null) === (b.spec.group || null) && !!a.spec.olre === !!b.spec.olre && (a.spec.slope || null) === (b.spec.slope || null);
    const sameFixed = ta.join('|') === tb.join('|');
    let kind = null;
    if (a.spec.family === b.spec.family && sameRandom && ta.length < tb.length && ta.every(t => tb.includes(t))) kind = 'terms';
    else if (a.spec.family === b.spec.family && sameFixed && !a.spec.group && !a.spec.olre && (b.spec.group || b.spec.olre)) kind = 'random';
    if (!kind) continue;
    const stat = Math.max(0, 2 * (b.result.fit.logLik - a.result.fit.logLik)), df = b.result.fit.df - a.result.fit.df;
    const upper = (x, d) => (d <= 0 ? (x > 0 ? 0 : 1) : 1 - (await0(x, d)));
    const p = kind === 'random' ? 0.5 * upper(stat, df - 1) + 0.5 * upper(stat, df) : upper(stat, df);
    pairs.push({ a: a.name, b: b.name, kind, df, stat, p });
  }
  const r = compareRecipe({ ds, level: LEVEL, title: title || 'Compare: ' + candidates.length + ' candidates', provenance: { dataset: ds.name }, candidates, pairs });
  r.capability = capabilityAll(candidates.map(c => c.spec));
  return r;
}
import { chi2Cdf } from '../js/stats/special.js';
const await0 = (x, d) => chi2Cdf(x, d);

const ON_TIME = example('on-time'), CYCLE = example('cycle-time'), BALKS = example('balks'), UTIL = example('utilization'), COLONY = example('colony-recruits'), RATING = example('rating');
const PAIRED = example('tour-paired');
const OVEN = example('muffin-oven');

// The Model page on every family.
checkRecipe('model, binomial logit with an interaction', modelOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy', { of: ['queue', 'policy'] }])), { smoke: true });
checkRecipe('model, gamma log', modelOf(CYCLE, specOf(CYCLE, 'time_in_system', 'gamma', ['load', 'class'])), { smoke: true });
checkRecipe('model, normal identity with a power', modelOf(CYCLE, specOf(CYCLE, 'time_in_system', 'normal', ['load', { name: 'load', degree: 2 }, 'class'])), { smoke: true });
checkRecipe('model, Poisson log', modelOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'])), { smoke: true });
checkRecipe('model, negative binomial', modelOf(BALKS, specOf(BALKS, 'balks', 'negbin', ['load', 'staffing'])), { smoke: true });
checkRecipe('model, beta logit', modelOf(UTIL, specOf(UTIL, 'utilization', 'beta', ['arrival_rate', 'day_type'])), { smoke: true });
checkRecipe('model, ordinal', modelOf(RATING, specOf(RATING, 'rating', 'ordinal', ['wait', 'express'])), { smoke: true });
// An outcome column modeled as the response, in a table whose other outputs ride along unused.
checkRecipe('model, an outcome as the response', modelOf(OVEN, specOf(OVEN, 'max_waiting', 'poisson', ['bake_time', 'threshold'])));

// CSV mode: the same scripts past the numbers cap, reading the data files.
checkCsvMode('csv model, Poisson', () => modelOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'])), BALKS, { smoke: true });
checkCsvMode('csv diagnostics, binomial', () => diagnosticsOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy'])), ON_TIME);
checkCsvMode('csv model, ordinal', () => modelOf(RATING, specOf(RATING, 'rating', 'ordinal', ['wait', 'express'])), RATING);
checkRecipe('model, binomial probit', modelOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy'], { link: 'probit' })));
checkRecipe('model, Poisson with a random intercept', modelOf(COLONY, specOf(COLONY, 'recruits', 'poisson', ['temperature', 'treatment'], { group: 'colony' })), { smoke: true });
checkRecipe('model, Poisson with a random slope', modelOf(COLONY, specOf(COLONY, 'recruits', 'poisson', ['temperature', 'treatment'], { group: 'colony', slope: 'temperature' })));
checkRecipe('model, normal mixed by REML', modelOf(BALKS, specOf(BALKS, 'balks', 'normal', ['load', 'staffing'], { group: 'week', reml: true })), { smoke: true });
checkRecipe('model, Poisson-lognormal', modelOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'], { olre: true })));
checkRecipe('model, binomial with a random intercept', modelOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy'], { group: 'seed' })));

// Diagnostics.
checkRecipe('diagnostics, Poisson', diagnosticsOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'])), { smoke: true });
checkRecipe('diagnostics, gamma', diagnosticsOf(CYCLE, specOf(CYCLE, 'time_in_system', 'gamma', ['load', 'class'])), { smoke: true });
checkRecipe('diagnostics, binomial', diagnosticsOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy'])));
checkRecipe('diagnostics, negative binomial', diagnosticsOf(BALKS, specOf(BALKS, 'balks', 'negbin', ['load', 'staffing'])));
checkRecipe('diagnostics, beta', diagnosticsOf(UTIL, specOf(UTIL, 'utilization', 'beta', ['arrival_rate', 'day_type'])));
checkRecipe('diagnostics, Poisson mixed', diagnosticsOf(COLONY, specOf(COLONY, 'recruits', 'poisson', ['temperature', 'treatment'], { group: 'colony' })), { smoke: true });
checkRecipe('diagnostics, gamma mixed', diagnosticsOf(PAIRED, specOf(PAIRED, 'time', 'gamma', ['condition'], { group: 'subject' })));
checkRecipe('model, gamma mixed', modelOf(PAIRED, specOf(PAIRED, 'time', 'gamma', ['condition'], { group: 'subject' })), { smoke: true });

// Predict.
checkRecipe('predict, gamma effect and means', predictOf(CYCLE, specOf(CYCLE, 'time_in_system', 'gamma', ['load', 'class']), { x: 'load', by: 'class', factor: 'class', row: { load: 0.7, class: 'express' } }), { smoke: true });
checkRecipe('predict, binomial effect and means', predictOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy']), { x: 'queue', by: null, factor: 'policy', row: { queue: 2, policy: 'B' } }), { smoke: true });
checkRecipe('predict, Poisson means with three levels', predictOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing', 'week']), { x: 'load', factor: 'week', row: { load: 0.8, staffing: '3 servers', week: 'week03' } }));
checkRecipe('predict, mixed Poisson effect', predictOf(COLONY, specOf(COLONY, 'recruits', 'poisson', ['temperature', 'treatment'], { group: 'colony' }), { x: 'temperature', by: 'treatment', factor: 'treatment', row: { temperature: 25, treatment: 'sugar' } }));
checkRecipe('predict, other predictors held at chosen values', predictOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing', 'week']), { x: 'load', by: 'staffing', hold: { week: 'week03' } }), { smoke: true });
test('a held value reaches the recipe', () => {
  const rec = predictOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing', 'week']), { x: 'load', by: 'staffing', hold: { week: 'week03' } });
  assert.ok(rec.effect.series.every(s => s.rows.every(row => row.week === 'week03')), 'every effect row holds week at week03');
  const first = predictOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing', 'week']), { x: 'load', by: 'staffing' });
  assert.notEqual(first.effect.series[0].rows[0].week, 'week03', 'the default is another level');
});
checkRecipe('predict, proportional weights', predictOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing', 'week']), { x: 'load', factor: 'week', weights: 'proportional' }), { smoke: true });
checkRecipe('predict, ordinal with proportional weights', predictOf(RATING, specOf(RATING, 'rating', 'ordinal', ['wait', 'express']), { x: 'wait', weights: 'proportional' }));
test('proportional weights differ from equal ones on these data', () => {
  const p = predictOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing', 'week']), { x: 'load', factor: 'week', weights: 'proportional' });
  assert.ok(new Set(p.effect.counts).size > 1, 'the averaged combinations are unbalanced: ' + p.effect.counts);
  assert.ok(new Set(p.means.counts).size > 1, 'the marginal means average over unbalanced levels: ' + p.means.counts);
  const q = predictOf(RATING, specOf(RATING, 'rating', 'ordinal', ['wait', 'express']), { x: 'wait', weights: 'proportional' });
  assert.ok(new Set(q.effect.counts).size > 1, 'express is unbalanced: ' + q.effect.counts);
});
checkRecipe('predict, ordinal with a held value', predictOf(RATING, specOf(RATING, 'rating', 'ordinal', ['wait', 'express']), { x: 'wait', hold: { express: 'yes' } }));
checkRecipe('predict, intercept only', predictOf(example('tour-one'), specOf(example('tour-one'), 'deviation', 'normal', []), { x: null, intercept: true, row: {} }), { smoke: true });
checkRecipe('predict, mixed intercept only', predictOf(example('tour-repeated'), specOf(example('tour-repeated'), 'deviation', 'normal', [], { group: 'day' }), { x: null, intercept: true, row: {} }));
checkRecipe('predict, ordinal effect', predictOf(RATING, specOf(RATING, 'rating', 'ordinal', ['wait', 'express']), { x: 'wait', row: { wait: 5, express: 'yes' } }), { smoke: true });
checkRecipe('predict, ordinal intercept only', predictOf(example('tour-anova'), specOf(example('tour-anova'), 'shift', 'ordinal', []), { x: null, intercept: true, row: {} }));

// Compare.
checkRecipe('compare, Poisson candidates', compareOf(BALKS, [['load only', specOf(BALKS, 'balks', 'poisson', ['load'])], ['load and staffing', specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'])], ['negative binomial', specOf(BALKS, 'balks', 'negbin', ['load', 'staffing'])]]), { smoke: true });
checkRecipe('compare, mixed against fixed', compareOf(COLONY, [['fixed', specOf(COLONY, 'recruits', 'poisson', ['temperature', 'treatment'])], ['mixed', specOf(COLONY, 'recruits', 'poisson', ['temperature', 'treatment'], { group: 'colony' })]]));

// The Variance explained page: R and Tidy R only (its capability grays Python and MATLAB).
checkRecipe('variance, normal with a factor', varianceOf(CYCLE, specOf(CYCLE, 'time_in_system', 'normal', ['load', 'class'])), { smoke: true });
checkRecipe('variance, binomial logit', varianceOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy'])));
checkRecipe('variance, Poisson with a random intercept', varianceOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'], { group: 'week' })), { smoke: true });
checkRecipe('variance, negative binomial', varianceOf(BALKS, specOf(BALKS, 'balks', 'negbin', ['load', 'staffing'])));
checkRecipe('variance, Poisson-lognormal', varianceOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load'], { olre: true })));
checkRecipe('variance, gamma with a random intercept', varianceOf(PAIRED, specOf(PAIRED, 'time', 'gamma', ['condition'], { group: 'subject' })));
checkRecipe('variance, beta logit', varianceOf(UTIL, specOf(UTIL, 'utilization', 'beta', ['arrival_rate'])));
checkRecipe('variance, binomial with a random intercept', varianceOf(ON_TIME, specOf(ON_TIME, 'on_time', 'binomial', ['queue', 'policy'], { group: 'seed' })));

startMatlab();

// The report names, in order, are the same in every language: a reader
// comparing two scripts' output sees the same lines in the same places.
test('report names come out in one order in every language', () => {
  const namesOf = text => {
    const out = [];
    for (const m of text.matchAll(/\b(report|shapiro_check)\((["'])((?:\\.|[^\\])*?)\2/g)) {
      if (m[1] === 'report') out.push(m[3]); else out.push(m[3] + ' W', m[3] + ' p');
    }
    return out;
  };
  const recipes = [
    modelOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'], { group: 'week' })),
    diagnosticsOf(BALKS, specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'])),
    predictOf(CYCLE, specOf(CYCLE, 'time_in_system', 'gamma', ['load', 'class']), { x: 'load', by: 'class', factor: 'class', row: { load: 0.7, class: 'express' } }),
    compareOf(BALKS, [['pois', specOf(BALKS, 'balks', 'poisson', ['load'])], ['pois2', specOf(BALKS, 'balks', 'poisson', ['load', 'staffing'])]])
  ];
  for (const recipe of recipes) {
    const r = namesOf(writeScript(recipe, 'R'));
    assert.ok(r.length > 3, 'the script reports');
    for (const lang of ['py', 'm']) assert.deepEqual(namesOf(writeScript(recipe, lang)), r, lang + ' names and order against R, ' + recipe.title);
  }
});
