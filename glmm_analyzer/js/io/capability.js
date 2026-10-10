// Which languages have a commonly used routine for a model: a button in the
// export row is live exactly where the language has one, and gray with a
// reason otherwise. R has a routine for every model this tool fits. Pure
// functions, no DOM.

const FAMILY_WORD = { normal: 'normal', binomial: 'binomial', poisson: 'Poisson', negbin: 'negative binomial', gamma: 'gamma', beta: 'beta', ordinal: 'ordinal' };

/**
 * The capability of each script language for a specification.
 * @param {{ family: string, group?: string|null, olre?: boolean }} spec
 * @returns {{ R: {ok: boolean, why: string|null}, tidy: {ok: boolean, why: string|null}, py: {ok: boolean, why: string|null}, m: {ok: boolean, why: string|null} }}
 */
export function capability(spec) {
  const mixed = !!(spec.group || spec.olre);
  const fam = spec.family;
  const word = FAMILY_WORD[fam] || fam;
  const out = { R: { ok: true, why: null }, tidy: { ok: true, why: null }, py: { ok: true, why: null }, m: { ok: true, why: null } };
  if (mixed) {
    if (fam !== 'normal') out.py = { ok: false, why: 'Python has no maximum-likelihood routine for a ' + word + ' mixed model: statsmodels fits only the linear mixed model, and its two Bayesian mixed models answer a different question. R\'s lme4' + (fam === 'beta' ? ' and glmmTMB' : '') + ' and MATLAB\'s fitglme are the conventional tools.' };
    if (fam === 'negbin' || fam === 'beta') out.m = { ok: false, why: 'MATLAB\'s fitglme has no ' + word + ' distribution. R\'s ' + (fam === 'beta' ? 'glmmTMB' : 'glmer.nb') + ' is the conventional tool.' };
    if (fam === 'negbin') out.py = { ok: false, why: 'Python has no maximum-likelihood routine for a negative binomial mixed model. R\'s glmer.nb is the conventional tool.' };
    if (fam === 'beta' && out.m.ok) out.m = { ok: false, why: 'MATLAB has no beta mixed model. R\'s glmmTMB is the conventional tool.' };
    if (fam === 'ordinal') { out.py = { ok: false, why: 'A mixed ordinal model is outside this tool.' }; out.m = out.py; }
    if (fam === 'normal' && (spec.nested)) out.py = { ok: false, why: 'statsmodels\' MixedLM takes a nested factor through variance-component formulas that this script does not write; R\'s lmer and MATLAB\'s fitlme are the conventional tools.' };
  } else {
    if (fam === 'negbin') out.m = { ok: false, why: 'MATLAB\'s fitglm has no negative binomial distribution. R\'s MASS::glm.nb and Python\'s statsmodels are the conventional tools.' };
    if (fam === 'beta') out.m = { ok: false, why: 'MATLAB has no beta regression. R\'s betareg and Python\'s statsmodels are the conventional tools.' };
  }
  return out;
}

/**
 * The capability for the Compare page: every candidate's languages together,
 * since one script fits them all.
 * @param {object[]} specs
 */
export function capabilityAll(specs) {
  const out = capability(specs[0] || { family: 'normal' });
  for (const s of specs.slice(1)) {
    const c = capability(s);
    for (const k of Object.keys(out)) if (!c[k].ok && out[k].ok) out[k] = c[k];
  }
  return out;
}
