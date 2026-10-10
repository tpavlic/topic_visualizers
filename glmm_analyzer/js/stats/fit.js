// Fitting a specification to a dataset: the support check, the design
// matrix, the fitter the family and the random part call for, and the names
// and flags the pages show. Every page and every recipe fits through
// `fitModel`, and so a number shown anywhere comes from one place. Pure
// functions, no DOM.

import { column, support, valuesOf, SUPPORT_LABEL } from '../data/model.js';
import { FAMILIES, linkOf, invalidRows, familiesFor } from './families.js';
import { modelMatrix, formulaOf } from './design.js';
import { fitGlm } from './glm.js';
import { fitNegbin } from './negbin.js';
import { fitBeta } from './beta.js';
import { fitOrdinal } from './ordinal.js';
import { buildRandom, fitGlmm, fitLmm } from './mixed.js';

/** How the page words each flag a fit may carry. */
export const FLAG_TEXT = {
  notConverged: 'The fit did not converge within the iteration cap; the numbers shown are the last iterate and may be far from the maximum.',
  separation: 'The binomial model separates the data: a fitted probability reached 0 or 1, and so some coefficient and its standard error are not meaningful.',
  singular: 'The design is singular at the solution; the fit stopped.',
  aliased: 'One or more columns were dropped as aliased (a linear combination of the others).',
  fewGroups: 'Fewer than five groups: the variance of the group effect is poorly determined.',
  singularFit: 'A group variance is at zero: the random effect explains nothing beyond the fixed effects.'
};

/**
 * Checks a spec against a dataset before any fitting: a response, rows to
 * use, and a response within the family's support.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} spec
 * @returns {{ ok: boolean, reason: string|null, rows?: number[], fitting?: string[] }}
 */
export function checkSpec(ds, spec) {
  if (!spec.response || !column(ds, spec.response)) return { ok: false, reason: 'Choose the response column.' };
  const fam = FAMILIES[spec.family];
  if (!fam) return { ok: false, reason: 'Choose a family.' };
  const rc = column(ds, spec.response).col;
  const vals = valuesOf(ds, spec.response);
  const sup = support(rc, vals);
  if (fam.id === 'ordinal') {
    if (rc.type === 'continuous') return { ok: false, reason: 'The ordinal family needs a response typed ordinal or categorical; ' + spec.response + ' is continuous.' };
    if ((rc.levels || []).length < 3) return { ok: false, reason: 'The ordinal family needs three or more levels; ' + spec.response + ' has ' + (rc.levels || []).length + '.' };
    return { ok: true, reason: null };
  }
  if (rc.type !== 'continuous') {
    if (fam.id === 'binomial' && (rc.levels || []).length === 2) return { ok: true, reason: null };
    return { ok: false, reason: 'The ' + fam.label + ' family needs a numeric response; ' + spec.response + ' is ' + rc.type + (fam.id === 'binomial' ? ' with ' + (rc.levels || []).length + ' levels' : '') + '.' };
  }
  const nums = vals.filter(v => v != null);
  const bad = invalidRows(fam.id, nums);
  if (bad.length) {
    const rowsOf = [];
    let k = 0;
    ds.rows.forEach((r, i) => { const v = r[column(ds, spec.response).index]; if (v == null) return; if (bad.includes(k)) rowsOf.push(i + 1); k++; });
    return { ok: false, reason: null, rows: rowsOf, fitting: familiesFor(sup), domain: fam.domain, support: SUPPORT_LABEL[sup] };
  }
  return { ok: true, reason: null };
}

/**
 * The response as numbers for the fitter: a two-level categorical response
 * under the binomial family is coded 0 for its first sorted level and 1 for
 * its second.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} spec
 * @param {ReturnType<typeof modelMatrix>} m
 * @returns {{ y: Float64Array, event: string|null }}
 */
export function codedResponse(ds, spec, m) {
  const rc = column(ds, spec.response).col;
  if (rc.type === 'continuous') return { y: m.y, event: null };
  const levels = rc.levels || [];
  if (spec.family === 'binomial' && levels.length === 2) {
    return { y: Float64Array.from(m.yRaw, v => (v === levels[1] ? 1 : 0)), event: levels[1] };
  }
  return { y: Float64Array.from(m.yRaw, v => levels.indexOf(v)), event: null };
}

/**
 * Fits a spec to a dataset. The result carries the design, the fitter's
 * output, the coefficient names, the formula, the flags, and the rows used.
 * Throws when the spec cannot be checked; a support failure returns
 * `{ refused }` instead so that a page can show the warning.
 * @param {import('../data/model.js').Dataset} ds
 * @param {object} spec
 * @returns {{ refused?: object, design?: object, fit?: object, names?: string[], formula?: string, flags?: string[], event?: string|null }}
 */
export function fitModel(ds, spec) {
  const chk = checkSpec(ds, spec);
  if (!chk.ok) {
    if (chk.reason) throw new Error(chk.reason);
    return { refused: chk };
  }
  const design = modelMatrix(ds, spec);
  const { y, event } = codedResponse(ds, spec, design);
  const flags = [];
  if (design.aliased.length) flags.push('aliased');
  let fit, names = design.names;
  if ((spec.group || spec.olre) && spec.family === 'ordinal') throw new Error('A mixed ordinal model is outside this tool.');
  if (spec.olre && spec.family !== 'poisson') throw new Error('The Poisson-lognormal effect is offered for the Poisson family only; the ' + FAMILIES[spec.family].label + ' family carries its spread in its own parameters.');
  if (spec.group || spec.olre) {
    const random = buildRandom(design, spec);
    if (spec.family === 'normal') {
      if (linkOf('normal', spec.link).id !== 'identity') throw new Error('The normal family\'s mixed model takes the identity link.');
      fit = fitLmm(y, design.X, random, { reml: !!spec.reml });
    } else {
      // The fixed-effects fit gives the starting values.
      const start = spec.family === 'negbin' ? fitNegbin(y, design.X, { link: spec.link }) : spec.family === 'beta' ? fitBeta(y, design.X, { link: spec.link }) : fitGlm(y, design.X, { family: spec.family, link: spec.link });
      fit = fitGlmm(y, design.X, random, { family: spec.family, link: spec.link, beta0: start.beta, aux0: spec.family === 'negbin' ? start.theta : spec.family === 'beta' ? start.phi : 1 });
      if (spec.family === 'negbin') { fit.theta = fit.theta_nb; fit.thetaSe = NaN; }
    }
    fit.random = random;
  } else if (spec.family === 'ordinal') {
    // No intercept: the thresholds take its place.
    const rc = column(ds, spec.response).col;
    const Xo = design.X.map(r => r.slice(1));
    fit = fitOrdinal(y, Xo, rc.levels.length);
    fit.zetaNames = rc.levels.slice(0, -1).map((l, k) => l + '|' + rc.levels[k + 1]);
    names = design.names.slice(1);
  } else if (spec.family === 'negbin') fit = fitNegbin(y, design.X, { link: spec.link });
  else if (spec.family === 'beta') fit = fitBeta(y, design.X, { link: spec.link });
  else fit = fitGlm(y, design.X, { family: spec.family, link: spec.link });
  for (const f of fit.flags) if (!flags.includes(f)) flags.push(f);
  return { design, fit, names, formula: formulaOf(spec), flags, event, link: linkOf(spec.family, spec.link).id, codedY: y, refit: fitModel };
}
