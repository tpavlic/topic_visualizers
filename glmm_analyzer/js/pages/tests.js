// The Classic tests as GLMM page: seven classical tests beside the models
// that contain them, each on a bundled dataset, with the matching numbers
// side by side and one paragraph on what matches and what does not.

import * as state from '../state.js';
import { EXAMPLES } from '../data/examples.js';
import { sniff, buildTable } from '../io/parse.js';
import { column, sameData } from '../data/model.js';
import { fitModel } from '../stats/fit.js';
import { termTests, randomEffectTest, waldP } from '../stats/inference.js';
import { oneSampleT, twoSampleT, onewayAnova, pairedT, chiSquareIndependence, twoProportions } from '../stats/classical.js';
import { fCdf, chi2Cdf } from '../stats/special.js';
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
  { id: 'one', label: 'One-sample t test', tip: 'A normal model with no predictor.' },
  { id: 't', label: 'Two-sample t test', tip: 'A normal model with one binary predictor.' },
  { id: 'anova', label: 'One-way ANOVA', tip: 'A normal model with one categorical predictor.' },
  { id: 'paired', label: 'Paired t test', tip: 'A normal mixed model with the subject as the group.' },
  { id: 'repeated', label: 'Repeated measures', tip: 'A normal mixed model with no predictor and the day as the group.' },
  { id: 'chisq', label: 'Chi-square test of independence', tip: 'Two Poisson models of the counts, with and without the interaction.' },
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
// Terms explained in a tooltip where they appear.
const tipped = (text, tip) => '<span class="tip" tabindex="0" data-tip="' + esc(tip) + '">' + text + '</span>';
const DEVIANCE_TIP = 'Twice the gap in log-likelihood between this model and a model that fits the data exactly. It is 0 for an exact fit and grows as the fit worsens. For a normal model, it is the residual sum of squares.';
const REML_TIP = 'Restricted maximum likelihood. The variances are estimated after the fixed effects are removed, which undoes the downward bias of plain maximum likelihood, as dividing by n − 1 rather than n does for a sample variance. It is the default for a normal mixed model, and it is what makes the standard errors here match the classical test’s.';

function modelRow(spec, label) {
  return '<dt>' + esc(label) + '</dt><dd><code>' + esc(formulaOf(spec)) + '</code> <span class="tm-model-fam">' + esc(FAMILIES[spec.family].label) + ' family, ' + esc(LINKS[spec.link].label) + ' link' + (spec.reml ? ', fitted by ' + tipped('REML', REML_TIP) : '') + '</span></dd>';
}
function modelBlock(spec, data, test, label = 'Equivalent model') {
  return '<dl class="tm-model">' +
    '<dt>Data to compare</dt><dd>' + data + '</dd>' +
    '<dt>Classical test</dt><dd>' + test + '</dd>' +
    modelRow(spec, label) +
    '</dl>';
}
function loadButton(which, spec, label = 'Open this dataset and model on the Model page') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-run2';
  b.textContent = label;
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
// One quantity over several rows, as a small contingency table: the label
// and the note span the rows, and each row carries its own name. A
// continuation row's first cell is a value, not a label, and so stays
// right-aligned (tm-cont).
function pairSpan(label, rows, note) {
  return rows.map(([name, classical, model], i) =>
    '<tr' + (i === 0 ? '' : ' class="tm-cont"') + '>' + (i === 0 ? '<td rowspan="' + rows.length + '">' + label + '</td>' : '') +
    '<td>' + name + ': ' + classical + '</td><td>' + name + ': ' + model + '</td>' +
    (i === 0 ? '<td rowspan="' + rows.length + '" class="muted-line">' + (note || '') + '</td>' : '') + '</tr>').join('');
}
function table(rows) {
  return '<div class="scroll-box"><table class="ptab"><thead><tr><th>Quantity</th><th>Classical test</th><th>GLMM</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
}

function sectionOne(root) {
  const { ds } = tourDataset('one');
  const spec = { response: 'deviation', family: 'normal', link: 'identity', terms: [], group: null, nested: null, slope: null, olre: false, reml: false };
  const r = fitModel(ds, spec);
  const t = oneSampleT(ds.rows.map(x => x[0]));
  const fit = r.fit;
  const se0 = Math.sqrt(fit.vcov[0][0]), tm = fit.beta[0] / se0, pm = waldP(tm, fit.dfResidual);
  root.innerHTML = modelBlock(spec, 'The delivery time of twenty-five orders, each as its deviation from the thirty-minute target.', 'The one-sample t test of the mean against 0.') + '<p class="exp-note">The one-sample t test can be realized as the GLMM above, a normal model with no predictor. The intercept of the GLMM is the mean deviation, its standard error is s/√n, and the Wald test of the intercept against 0 is the one-sample t test, on the same n − 1 degrees of freedom. A test against a target other than 0 is the same test on the response minus the target, which is why these data are each order’s deviation from the target rather than its delivery time.</p>';
  root.innerHTML += table([
    pair('Mean deviation', stat(t.mean, 5), stat(fit.beta[0], 5), 'the intercept'),
    pair('Standard error', stat(t.se, 5), stat(se0, 5), 's/√n'),
    pair('t', stat(t.t, 5), stat(tm, 5), 'the GLMM matches the test'),
    pair('Degrees of freedom', intl(t.df), intl(fit.dfResidual), 'the GLMM matches the test'),
    pair('p', pValue(t.p), pValue(pm), 'the GLMM matches the test')
  ]);
  root.appendChild(loadButton('one', spec));
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
  root.innerHTML = modelBlock(spec, 'The daily defect rate on twelve days of each of three work shifts (day, evening, night).', 'One-way analysis of variance.') + '<p class="exp-note">One-way ANOVA can be realized as the GLMM above. The intercept of the GLMM is the day shift’s mean, and its two coefficients are the other shifts’ differences from it. ANOVA asks whether the three means differ through the F ratio of the between-shift to the within-shift mean square, and the same F comes from the GLMM’s deviances: the null deviance is the total sum of squares and the deviance is the within-shift sum of squares, so the F and its p-value are the test’s. The Model page’s term test is the likelihood-ratio form of the same comparison; it agrees with the F test in large samples and is close here.</p>';
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
  root.innerHTML = modelBlock(spec, 'Task times of fourteen operators, each timed before and after a process change.', 'The paired t test.') + '<p class="exp-note">The paired t test can be realized as the GLMM above, a mixed model with a random intercept per operator. The paired test works on each operator’s difference, which removes the operator’s own level from the comparison; the random intercept does the same. The GLMM’s coefficient for the condition is the mean difference after − before, and under REML its standard error is the paired test’s. The GLMM reports a z test where the paired test has t on 13 degrees of freedom, which is why the p-values differ a little; the GLMM also says how much of the variation sits between operators, which the t test never does.</p>';
  root.innerHTML += table([
    pair('Mean difference, after − before', stat(pt.meanDiff, 5), stat(est, 5), 'minus the coefficient of conditionbefore'),
    pair('Standard error', stat(pt.se, 5), stat(se, 5), 'REML'),
    pair('Statistic', 't = ' + stat(pt.t, 5) + ' on ' + intl(pt.df) + ' df', 'z = ' + stat(est / se, 5), ''),
    pair('p', pValue(pt.p), pValue(waldP(est / se, Infinity)), 'z against t on 13 df'),
    pair('Between-operator variance', '–', stat(fit.varcomp[0].variances[0], 5) + ' (residual ' + stat(fit.sigma2, 5) + ')', 'random part LRT ' + pEq(ret.p))
  ]);
  root.appendChild(loadButton('paired', spec));
}

function sectionRepeated(root) {
  const { ds } = tourDataset('repeated');
  const spec = { response: 'deviation', family: 'normal', link: 'identity', terms: [], group: 'day', nested: null, slope: null, olre: false, reml: true };
  const r = fitModel(ds, spec);
  const di = column(ds, 'day');
  const days = di.col.levels.map(d => ds.rows.filter(x => x[di.index] === d).map(x => x[0]));
  const means = oneSampleT(days.map(v => v.reduce((a, b) => a + b, 0) / v.length));
  const naive = oneSampleT(ds.rows.map(x => x[0]));
  const fit = r.fit;
  const se0 = Math.sqrt(fit.vcov[0][0]), z = fit.beta[0] / se0;
  const ret = randomEffectTest(ds, spec, r);
  root.innerHTML = modelBlock(spec, 'The delivery time of twenty orders on each of ten days, each as its deviation from the thirty-minute target.', 'The one-sample t test on the ten daily means.') + '<p class="exp-note">A one-sample t test on repeated measures can be realized as the GLMM above, a mixed model with a random intercept per day and no predictor. The two hundred orders are not independent: orders on the same day share that day’s conditions, and a t test that treats them as two hundred independent observations takes a standard error that is too small. The classical remedy is to test the ten daily means, one number per day. The random intercept of the GLMM does the same: under REML, the standard error of its intercept is the standard error of the daily means, exactly, because every day carries the same number of orders and the between-day variance is estimated above 0. The GLMM reports a z test where the t test has 9 degrees of freedom, as on the paired test, and it also says how much of the variation sits between days. The paired t test is the two-condition form of this model; a factor with more levels in place of the condition gives one-way repeated-measures analysis of variance under compound symmetry.</p>';
  root.innerHTML += table([
    pair('Mean deviation', stat(means.mean, 5) + ' (daily means), ' + stat(naive.mean, 5) + ' (all orders)', stat(fit.beta[0], 5), 'the intercept'),
    pair('Standard error', stat(means.se, 5) + ' (daily means), ' + stat(naive.se, 5) + ' (all orders as if independent)', stat(se0, 5), 'the GLMM matches the test on the daily means'),
    pair('Statistic', 't = ' + stat(means.t, 5) + ' on ' + intl(means.df) + ' df (daily means), t = ' + stat(naive.t, 5) + ' on ' + intl(naive.df) + ' df (all orders)', 'z = ' + stat(z, 5), ''),
    pair('p', pValue(means.p) + ' (daily means), ' + pValue(naive.p) + ' (all orders)', pValue(waldP(z, Infinity)), 'z against t on 9 df'),
    pair('Between-day variance', '–', stat(fit.varcomp[0].variances[0], 5) + ' (residual ' + stat(fit.sigma2, 5) + ')', 'random part LRT ' + pEq(ret.p))
  ]);
  root.appendChild(loadButton('repeated', spec));
}

function sectionChisq(root) {
  const { ds } = tourDataset('chisq');
  const spec0 = { response: 'count', family: 'poisson', link: 'log', terms: ['outcome', 'channel'], group: null, nested: null, slope: null, olre: false, reml: false };
  const spec = Object.assign({}, spec0, { terms: ['outcome', 'channel', { of: ['outcome', 'channel'] }] });
  const r0 = fitModel(ds, spec0), r = fitModel(ds, spec);
  const oi = column(ds, 'outcome'), chi = column(ds, 'channel');
  // The cells in the order the data list the outcomes (early, on time,
  // late), not the levels' sorted order.
  const outcomes = [...new Set(ds.rows.map(x => x[oi.index]))];
  const cells = chi.col.levels.map(ch => outcomes.map(o => ds.rows.findIndex(x => x[oi.index] === o && x[chi.index] === ch)));
  const tab = cells.map(row => row.map(i => ds.rows[i][0]));
  const cs = chiSquareIndependence(tab);
  // The independence model's Pearson statistic, and its fitted counts in the
  // table's order.
  let X2 = 0;
  for (const p of r0.fit.pearson) X2 += p * p;
  const counts = (m, i) => cells[i].map(j => num(m[j], 4)).join(', ');
  const fittedByCell = new Float64Array(ds.rows.length);
  r0.design.keep.forEach((rowIndex, k) => { fittedByCell[rowIndex] = r0.fit.fitted[k]; });
  const expectedByCell = new Float64Array(ds.rows.length);
  cells.forEach((row, i) => row.forEach((j, k) => { expectedByCell[j] = cs.expected[i][k]; }));
  const tt = termTests(ds, spec, r);
  const ia = tt.rows.find(x => x.term.includes(':'));
  root.innerHTML = '<dl class="tm-model">' +
    '<dt>Data to compare</dt><dd>Delivery orders counted by outcome (early, on time, late) and by order channel (web, phone): a 3 × 2 table.</dd>' +
    '<dt>Classical test</dt><dd>The chi-square test of independence.</dd>' +
    modelRow(spec, 'Model with interaction') + modelRow(spec0, 'Model without interaction') + '</dl>' +
    '<p class="exp-note">The chi-square test of independence is the comparison of the two GLMMs above, Poisson models of the six counts. The model without the interaction is the independence model: it says that the outcome’s distribution is the same on every channel, and its fitted counts are the classical test’s expected counts. The model with the interaction lets the distribution differ by channel. Under independence, the second model predicts the counts no better than the first, and the likelihood-ratio test of the interaction asks whether it does: that test is the chi-square test. On the Model page, it is the term test of outcome:channel in the model with the interaction. The question is an interaction and not a main effect of channel because the response is the count, and a channel term alone says only that one channel is busier; in the two-proportion section, where the outcome is the response, the same question is a main effect.</p>' +
    '<p class="tm-sub">Comparing the two models</p>' +
    table([
      pair(tipped('Deviance', DEVIANCE_TIP) + ', model with interaction', '–', Math.abs(r.fit.deviance) < 1e-8 ? '0' : stat(r.fit.deviance, 3), 'one coefficient per cell fits the table exactly'),
      pair(tipped('Deviance', DEVIANCE_TIP) + ', model without interaction', '–', stat(r0.fit.deviance, 5), ''),
      pair('Difference', stat(cs.G2, 5), stat(ia.stat, 5), 'the likelihood-ratio test of outcome:channel'),
      pair('Degrees of freedom', intl(cs.df), intl(ia.df), 'coefficients of the interaction'),
      pair('p', pEq(cs.pG), pEq(ia.p), 'the Model page’s term test')
    ]) +
    '<p class="tm-sub">The model without interaction on its own</p>' +
    '<p class="exp-note">Because the model with the interaction fits the table exactly, the comparison reduces to the deviance of the model without it, which is why the classical likelihood-ratio statistic can be read off this one fit. Pearson’s chi-square is the same lack of fit measured as Σ (observed − fitted)²/fitted instead of the deviance’s Σ 2 × observed × log(observed/fitted); the two agree in large samples, and both are chi-square on (rows − 1)(columns − 1) degrees of freedom.</p>' +
    table([
      pairSpan('Expected counts', chi.col.levels.map((ch, i) => [esc(ch), counts(expectedByCell, i), counts(fittedByCell, i)]), 'the fitted counts'),
      pair('Degrees of freedom', intl(cs.df), intl(r0.fit.dfResidual), '(rows − 1)(columns − 1)'),
      pair('Pearson chi-square', stat(cs.X2, 5) + ', ' + pEq(cs.pX), stat(X2, 5) + ', ' + pEq(1 - chi2Cdf(X2, r0.fit.dfResidual)), 'Σ Pearson residual²'),
      pair('Likelihood-ratio chi-square', stat(cs.G2, 5) + ', ' + pEq(cs.pG), stat(r0.fit.deviance, 5) + ', ' + pEq(1 - chi2Cdf(r0.fit.deviance, r0.fit.dfResidual)), 'the ' + tipped('deviance', DEVIANCE_TIP))
    ]);
  root.appendChild(loadButton('chisq', spec, 'Open this dataset and the model with interaction on the Model page'));
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
  root.innerHTML = modelBlock(spec, 'Fifty customers shown each of two offers (A and B), and whether each customer converted.', 'The two-proportion z test.') + '<p class="exp-note">Whereas a chi-square test treats any difference from expectation the same, a two-proportion z test allows a one-sided test of which of two proportions is the greater. Such a two-proportion z test can be realized as the GLMM above, a logistic model with the offer as its one predictor. The GLMM’s coefficient is the log odds ratio of converting under B against A, and its likelihood-ratio test is the likelihood-ratio chi-square statistic for the 2 × 2 table. The classical test compares the two rates by a z test with the pooled proportion’s standard error (a score test, whose square is the chi-square test on the table), whereas the GLMM’s Wald z uses the standard error at the estimate, which is why the two z values differ a little. Fisher’s exact test can also be used for a 2 × 2 table (and agrees on a table this size), but its conservatism makes it appropriate only for small experiments.</p>';
  root.innerHTML += table([
    pair('Conversion rates', stat(pr.p2, 4) + ' (A), ' + stat(pr.p1, 4) + ' (B)', stat(1 / (1 + Math.exp(-fit.beta[0])), 4) + ' (A), ' + stat(1 / (1 + Math.exp(-(fit.beta[0] + fit.beta[1]))), 4) + ' (B)', 'the fitted probabilities'),
    pair('Effect', 'difference B − A ' + stat(pr.diff, 4), 'odds ratio ' + stat(Math.exp(fit.beta[1]), 4) + ' (log odds ratio ' + stat(fit.beta[1], 4) + ')', ''),
    pair('z', stat(pr.z, 5) + ' (score, pooled SE)', stat(z, 5) + ' (Wald)', ''),
    pair('p', pValue(pr.p), pValue(waldP(z, Infinity)) + ' (Wald), ' + pValue(tt.rows[0].p) + ' (likelihood ratio)', 'three tests of one hypothesis'),
    pair('Chi-square on the 2 × 2 table', stat(pr.chisq, 5), stat(tt.rows[0].stat, 5) + ' (likelihood ratio)', '')
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
    '<p class="lede">The tests of a first statistics course can each be realized as a generalized linear mixed model: the one-sample t test as a normal model with no predictor, the two-sample t test as one with a binary predictor, ANOVA as a normal model with a factor, the paired test and a test on repeated measures as mixed models, the chi-square test as a Poisson model of counts, and the comparison of two proportions as a logistic model. Each section names the classical test, states the GLMM that realizes it, fits that GLMM to a small bundled dataset, and sets its numbers beside the test’s; a dash marks a quantity the classical test has no counterpart for. The point is not that the GLMM is better on these data; it is that the GLMM keeps working when a second predictor, a covariate, a count, or a grouping factor arrives, where the test stops.</p>' +
    '<div data-subnav class="subnav"></div>' +
    sections.map(s => '<div data-section="' + s.id + '" class="sec"><div class="sec-hd">' + esc(s.label) + '</div><div id="ts-' + s.id + '"></div></div>').join('');
  for (const [sec, fn] of [['one', sectionOne], ['t', sectionT], ['anova', sectionAnova], ['paired', sectionPaired], ['repeated', sectionRepeated], ['chisq', sectionChisq], ['proportion', sectionProportion]]) {
    const box = root.querySelector('#ts-' + sec);
    try { fn(box); } catch (err) { console.error(err); box.appendChild(notice('warn', 'This section could not be computed: ' + esc(err.message))); }
  }
  installExportRow(root, id);
  registerTips(root);
}

/** Called each time the page is shown. */
export function onShow() {}

export default { id, title, render, onShow, sections };
