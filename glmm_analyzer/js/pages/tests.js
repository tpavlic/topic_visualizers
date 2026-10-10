// The Tests as models page: five classical tests beside the models that
// contain them, each on a bundled dataset, with the matching numbers side
// by side and one paragraph on what matches and what does not.

import * as state from '../state.js';
import { EXAMPLES } from '../data/examples.js';
import { sniff, buildTable } from '../io/parse.js';
import { column, sameData } from '../data/model.js';
import { fitModel } from '../stats/fit.js';
import { termTests, randomEffectTest, waldP } from '../stats/inference.js';
import { twoSampleT, onewayAnova, pairedT, chiSquareIndependence, twoProportions } from '../stats/classical.js';
import { fCdf } from '../stats/special.js';
import { card, cardRow, notice } from '../ui/widgets.js';
import { installExportRow } from '../ui/exportrow.js';
import { esc, num, stat, pValue, pEq, intl } from '../ui/format.js';
import { FAMILIES, LINKS } from '../stats/families.js';
import { formulaOf } from '../stats/design.js';
import { registerTips } from '../ui/tooltip.js';

/** The page's hash id. */
export const id = 'tests';
/** The page's title. */
export const title = 'Classic tests as GLMM';
/** The page's sections. */
export const sections = [
  { id: 't', label: 'Two-sample t test', tip: 'A normal model with one binary predictor.' },
  { id: 'anova', label: 'One-way ANOVA', tip: 'A normal model with one categorical predictor.' },
  { id: 'paired', label: 'Paired t test', tip: 'A normal mixed model with the subject as the group.' },
  { id: 'chisq', label: 'Chi-square test of independence', tip: 'A Poisson model of the counts with an interaction.' },
  { id: 'proportion', label: 'Two-proportion test', tip: 'A logistic model with one binary predictor.' }
];

let rootEl = null;
const datasets = new Map();

function tourDataset(which) {
  if (datasets.has(which)) return datasets.get(which);
  const ex = EXAMPLES.find(e => e.tour === which);
  const { dataset } = buildTable(sniff(ex.text, { name: ex.mapping.name }), ex.mapping);
  dataset.source.file = ex.file;
  datasets.set(which, { ex, ds: dataset });
  return datasets.get(which);
}

// The section's facts, first and apart from the prose: the data, the
// classical test, and the model that is that test.
function modelBlock(spec, data, test) {
  return '<dl class="tm-model">' +
    '<dt>Data to compare</dt><dd>' + data + '</dd>' +
    '<dt>Classical test</dt><dd>' + test + '</dd>' +
    '<dt>Equivalent model</dt><dd><code>' + esc(formulaOf(spec)) + '</code> <span class="tm-model-fam">' + esc(FAMILIES[spec.family].label) + ' family, ' + esc(LINKS[spec.link].label) + ' link' + (spec.reml ? ', fitted by REML' : '') + '</span></dd>' +
    '</dl>';
}

function loadButton(which, spec) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-run2';
  b.textContent = 'Open this dataset and model on the Model page';
  b.addEventListener('click', () => {
    const { ds } = tourDataset(which);
    let loaded = state.datasets.find(d => sameData(d, ds));
    if (!loaded) { loaded = state.add(ds); }
    state.select(loaded.id);
    state.setSpec(Object.assign(state.emptySpec(), spec, { dataset: loaded.id }));
    location.hash = '#model';
  });
  return b;
}

function pair(label, classical, model, note) {
  return '<tr><td>' + label + '</td><td>' + classical + '</td><td>' + model + '</td><td class="muted-line">' + (note || '') + '</td></tr>';
}
function table(rows) {
  return '<div class="scroll-box"><table class="ptab"><thead><tr><th>Quantity</th><th>Classical test</th><th>GLMM</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}

function sectionT(root) {
  const { ds } = tourDataset('t');
  const spec = { response: 'throughput', family: 'normal', link: 'identity', terms: ['line'], group: null, nested: null, slope: null, olre: false, reml: false };
  const r = fitModel(ds, spec);
  const li = column(ds, 'line');
  const a = ds.rows.filter(x => x[li.index] === 'A').map(x => x[0]), b = ds.rows.filter(x => x[li.index] === 'B').map(x => x[0]);
  // The test on B − A, in the direction of the model's contrast.
  const t = twoSampleT(b, a);
  const fit = r.fit;
  const se1 = Math.sqrt(fit.vcov[1][1]), tm = fit.beta[1] / se1, pm = waldP(tm, fit.dfResidual);
  root.innerHTML = modelBlock(spec, 'Throughput on fifteen days of each of two production lines.', 'The pooled two-sample t test.') + '<p class="exp-note">A pooled two-sample t test can be realized as the GLMM above. The intercept of the GLMM is production line A’s mean, and its one coefficient is the mean difference B − A, the change in mean from line A to line B; fitting the coefficient estimates the difference between the two population means. The GLMM’s p-value tests that estimated difference against a difference of 0, and it is identical to the p-value of the pooled two-sample t test. Welch’s two-sample t test allows the lines different variances, which calls for a generalized least-squares fit outside the GLMM’s structure; Welch’s results are in the table for comparison.</p>';
  root.innerHTML += table([
    pair('Difference of means, B − A', stat(t.diff, 5), stat(fit.beta[1], 5), 'the coefficient of lineB'),
    pair('Standard error', stat(t.pooled.se, 5), stat(se1, 5), 'the pooled estimate'),
    pair('t', stat(t.pooled.t, 5) + ' (pooled), ' + stat(t.welch.t, 5) + ' (Welch)', stat(tm, 5), 'the GLMM matches the pooled test'),
    pair('Degrees of freedom', intl(t.pooled.df) + ' (pooled), ' + num(t.welch.df, 4) + ' (Welch)', intl(fit.dfResidual), 'the GLMM matches the pooled test'),
    pair('p', pValue(t.pooled.p) + ' (pooled), ' + pValue(t.welch.p) + ' (Welch)', pValue(pm), 'the GLMM matches the pooled test')
  ]);
  root.appendChild(loadButton('t', spec));
}

function sectionAnova(root) {
  const { ds } = tourDataset('anova');
  const spec = { response: 'defect_rate', family: 'normal', link: 'identity', terms: ['shift'], group: null, nested: null, slope: null, olre: false, reml: false };
  const r = fitModel(ds, spec);
  const si = column(ds, 'shift');
  const groups = si.col.levels.map(l => ds.rows.filter(x => x[si.index] === l).map(x => x[0]));
  const av = onewayAnova(groups);
  const fit = r.fit;
  const df1 = fit.rank - 1, df2 = fit.dfResidual;
  const F = ((fit.nullDeviance - fit.deviance) / df1) / (fit.deviance / df2);
  const pF = 1 - fCdf(F, df1, df2);
  const tt = termTests(ds, spec, r);
  root.innerHTML = modelBlock(spec, 'The defect rate on twelve days of each of three shifts.', 'One-way analysis of variance.') + '<p class="exp-note">One-way ANOVA can be realized as the GLMM above. The intercept of the GLMM is the day shift’s mean, and its two coefficients are the other shifts’ differences from it. ANOVA asks whether the three means differ through the F ratio of the between-shift to the within-shift mean square, and the same F comes from the GLMM’s deviances: the null deviance is the total sum of squares and the deviance is the within-shift sum of squares, so the F and its p-value are the test’s. The Model page’s term test is the likelihood-ratio form of the same comparison; it agrees with the F test in large samples and is close here.</p>';
  root.innerHTML += table([
    pair('Between sum of squares', stat(av.ssBetween, 5), stat(fit.nullDeviance - fit.deviance, 5), 'null deviance − deviance'),
    pair('Within sum of squares', stat(av.ssWithin, 5), stat(fit.deviance, 5), 'the deviance'),
    pair('F', stat(av.F, 5) + ' on ' + intl(av.df1) + ' and ' + intl(av.df2) + ' df', stat(F, 5) + ' on ' + intl(df1) + ' and ' + intl(df2) + ' df', ''),
    pair('p', pValue(av.p), pValue(pF), ''),
    pair('Likelihood-ratio test of shift', '–', stat(tt.rows[0].stat, 4) + ' on ' + intl(tt.rows[0].df) + ' df, ' + pEq(tt.rows[0].p), 'the Model page’s term test')
  ]);
  root.appendChild(loadButton('anova', spec));
}

function sectionPaired(root) {
  const { ds } = tourDataset('paired');
  const spec = { response: 'time', family: 'normal', link: 'identity', terms: ['condition'], group: 'subject', nested: null, slope: null, olre: false, reml: true };
  const r = fitModel(ds, spec);
  const ci = column(ds, 'condition'), si = column(ds, 'subject');
  const subjects = si.col.levels;
  const before = subjects.map(s => ds.rows.find(x => x[si.index] === s && x[ci.index] === 'before')[0]);
  const after = subjects.map(s => ds.rows.find(x => x[si.index] === s && x[ci.index] === 'after')[0]);
  const pt = pairedT(after, before);
  const fit = r.fit;
  const k = r.names.indexOf('conditionbefore');
  const est = -fit.beta[k], se = Math.sqrt(fit.vcov[k][k]);
  const ret = randomEffectTest(ds, spec, r);
  root.innerHTML = modelBlock(spec, 'Fourteen operators timed before and after a change.', 'The paired t test.') + '<p class="exp-note">The paired t test can be realized as the GLMM above, a mixed model with a random intercept per operator. The paired test works on each operator’s difference, which removes the operator’s own level from the comparison; the random intercept does the same. The GLMM’s coefficient for the condition is the mean difference after − before, and under REML its standard error is the paired test’s. The GLMM reports a z test where the paired test has t on 13 degrees of freedom, which is why the p-values differ a little; the GLMM also says how much of the variation sits between operators, which the t test never does.</p>';
  root.innerHTML += table([
    pair('Mean difference, after − before', stat(pt.meanDiff, 5), stat(est, 5), 'minus the coefficient of conditionbefore'),
    pair('Standard error', stat(pt.se, 5), stat(se, 5), 'REML'),
    pair('Statistic', 't = ' + stat(pt.t, 5) + ' on ' + intl(pt.df) + ' df', 'z = ' + stat(est / se, 5), ''),
    pair('p', pValue(pt.p), pValue(waldP(est / se, Infinity)), 'z against t on 13 df'),
    pair('Between-operator variance', '–', stat(fit.varcomp[0].variances[0], 5) + ' (residual ' + stat(fit.sigma2, 5) + ')', 'random part LRT ' + pEq(ret.p))
  ]);
  root.appendChild(loadButton('paired', spec));
}

function sectionChisq(root) {
  const { ds } = tourDataset('chisq');
  const spec = { response: 'count', family: 'poisson', link: 'log', terms: ['outcome', 'channel', { of: ['outcome', 'channel'] }], group: null, nested: null, slope: null, olre: false, reml: false };
  const r = fitModel(ds, spec);
  const oi = column(ds, 'outcome'), chi = column(ds, 'channel');
  const tab = chi.col.levels.map(ch => oi.col.levels.map(o => ds.rows.find(x => x[oi.index] === o && x[chi.index] === ch)[0]));
  const cs = chiSquareIndependence(tab);
  const tt = termTests(ds, spec, r);
  const ia = tt.rows.find(x => x.term.includes(':'));
  // The independence model's Pearson statistic.
  const r0 = fitModel(ds, Object.assign({}, spec, { terms: ['outcome', 'channel'] }));
  let X2 = 0;
  for (const p of r0.fit.pearson) X2 += p * p;
  root.innerHTML = modelBlock(spec, 'Orders counted by outcome (early, on time, late) and channel (web, phone): a 3 × 2 table.', 'The chi-square test of independence.') + '<p class="exp-note">The chi-square test of independence can be realized as the GLMM above, a Poisson model of the six counts with the outcome-by-channel interaction. The test asks whether outcome and channel are associated. With the interaction, the GLMM fits the table exactly; without it, it is the independence model, whose fitted counts are the test’s expected counts. The likelihood-ratio test of the interaction is G², the likelihood-ratio form of the chi-square test, and Pearson’s X² is the independence model’s Pearson statistic; the two agree in large samples.</p>';
  root.innerHTML += table([
    pair('Degrees of freedom', intl(cs.df), intl(ia.df), '(rows − 1)(columns − 1)'),
    pair('Pearson X²', stat(cs.X2, 5) + ', ' + pEq(cs.pX), stat(X2, 5), 'Σ Pearson residual² of the independence model'),
    pair('Likelihood-ratio G²', stat(cs.G2, 5) + ', ' + pEq(cs.pG), stat(ia.stat, 5) + ', ' + pEq(ia.p), 'the term test of outcome:channel'),
    pair('Saturated model’s deviance', '–', stat(r.fit.deviance, 3), 'the table is fitted exactly')
  ]);
  root.appendChild(loadButton('chisq', spec));
}

function sectionProportion(root) {
  const { ds } = tourDataset('proportion');
  const spec = { response: 'converted', family: 'binomial', link: 'logit', terms: ['offer'], group: null, nested: null, slope: null, olre: false, reml: false };
  const r = fitModel(ds, spec);
  const oi = column(ds, 'offer');
  const a = ds.rows.filter(x => x[oi.index] === 'A'), b = ds.rows.filter(x => x[oi.index] === 'B');
  // The test on B − A, in the direction of the model's contrast.
  const pr = twoProportions(b.filter(x => x[0] === 1).length, b.length, a.filter(x => x[0] === 1).length, a.length);
  const fit = r.fit;
  const se1 = Math.sqrt(fit.vcov[1][1]), z = fit.beta[1] / se1;
  const tt = termTests(ds, spec, r);
  root.innerHTML = modelBlock(spec, 'Fifty customers shown each of two offers, and whether each converted.', 'The two-proportion z test.') + '<p class="exp-note">The two-proportion test can be realized as the GLMM above, a logistic model with the offer as its one predictor. The GLMM’s coefficient is the log odds ratio of converting under B against A, and its likelihood-ratio test is G² for the 2 × 2 table. The classical test compares the two rates by a z test with the pooled proportion’s standard error (a score test, whose square is the chi-square test on the table), whereas the GLMM’s Wald z uses the standard error at the estimate, which is why the two z values differ a little.</p>';
  root.innerHTML += table([
    pair('Conversion rates', stat(pr.p2, 4) + ' (A), ' + stat(pr.p1, 4) + ' (B)', stat(1 / (1 + Math.exp(-fit.beta[0])), 4) + ' (A), ' + stat(1 / (1 + Math.exp(-(fit.beta[0] + fit.beta[1]))), 4) + ' (B)', 'the fitted probabilities'),
    pair('Effect', 'difference B − A ' + stat(pr.diff, 4), 'odds ratio ' + stat(Math.exp(fit.beta[1]), 4) + ' (log odds ratio ' + stat(fit.beta[1], 4) + ')', ''),
    pair('z', stat(pr.z, 5) + ' (score, pooled SE)', stat(z, 5) + ' (Wald)', ''),
    pair('p', pValue(pr.p), pValue(waldP(z, Infinity)) + ' (Wald), ' + pValue(tt.rows[0].p) + ' (likelihood ratio)', 'three tests of one hypothesis'),
    pair('Chi-square on the 2 × 2 table', stat(pr.chisq, 5), stat(tt.rows[0].stat, 5) + ' (G²)', '')
  ]);
  root.appendChild(loadButton('proportion', spec));
}

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  rootEl = root;
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">The tests of a first statistics course can each be realized as a generalized linear mixed model: a t test as a normal model with one binary predictor, ANOVA as a normal model with a factor, the paired test as a mixed model, the chi-square test as a Poisson model of counts, and the comparison of two proportions as a logistic model. Each section names the classical test, states the GLMM that realizes it, fits that GLMM to a small bundled dataset, and sets its numbers beside the test’s. The point is not that the GLMM is better on these data; it is that the GLMM keeps working when a second predictor, a covariate, a count, or a grouping factor arrives, where the test stops.</p>' +
    '<div data-subnav class="subnav"></div>' +
    sections.map(s => '<div data-section="' + s.id + '" class="sec"><div class="sec-hd">' + esc(s.label) + '</div><div id="ts-' + s.id + '"></div></div>').join('');
  for (const [sec, fn] of [['t', sectionT], ['anova', sectionAnova], ['paired', sectionPaired], ['chisq', sectionChisq], ['proportion', sectionProportion]]) {
    const box = root.querySelector('#ts-' + sec);
    try { fn(box); } catch (err) { console.error(err); box.appendChild(notice('warn', 'This section could not be computed: ' + esc(err.message))); }
  }
  installExportRow(root, id);
  registerTips(root);
}

/** Called each time the page is shown. */
export function onShow() {}

export default { id, title, render, onShow, sections };
