// The formula builder: the controls that turn the shared model
// specification (state.spec) into a dataset, a response, a family and
// link, a list of fixed terms, and the random part, with the formula
// written out in R's notation as it changes. Every change goes through
// state.setSpec, and so every page that reads the spec follows.

import * as state from '../state.js';
import { column, support, valuesOf, predictorColumns, groupColumns, SUPPORT_LABEL } from '../data/model.js';
import { FAMILIES, FAMILY_ORDER, LINKS, familiesFor, linkOf } from '../stats/families.js';
import { formulaOf, termLabel, orderedTerms, missingMainEffects } from '../stats/design.js';
import { datasetSelect, spinner, levelSelect } from './widgets.js';
import { registerTips } from './tooltip.js';
import { esc } from './format.js';

const FAMILY_TIP = {
  normal: 'A response on a continuous scale with a constant spread: the linear model.',
  binomial: 'A response with two values, modeled through the probability of the second sorted level (the event).',
  poisson: 'A count whose variance equals its mean.',
  negbin: 'A count whose variance exceeds its mean, with the extra spread measured by θ.',
  gamma: 'A positive response whose spread grows in proportion to its mean.',
  beta: 'A proportion strictly between 0 and 1, with its precision φ.',
  ordinal: 'An ordered response of three or more levels, modeled through the cumulative probabilities (proportional odds).'
};

/** The family a response's support calls for by default. */
export function defaultFamily(sup) {
  return { binary: 'binomial', count: 'poisson', unit: 'beta', positive: 'gamma', real: 'normal', ordinal: 'ordinal' }[sup] || 'normal';
}

/**
 * A default spec for a dataset: its response column, every predictor as a
 * main effect, the family its support calls for, and the first group column
 * as the group.
 * @param {import('../data/model.js').Dataset} ds
 */
export function defaultSpec(ds) {
  const resp = ds.columns.find(c => c.role === 'response');
  const sup = resp ? support(resp, valuesOf(ds, resp.name)) : 'real';
  const groups = groupColumns(ds);
  return Object.assign(state.emptySpec(), {
    dataset: ds.id,
    response: resp ? resp.name : null,
    family: defaultFamily(sup),
    link: null,
    terms: predictorColumns(ds).map(c => c.name),
    group: groups.length ? groups[0].name : null
  });
}

function opt(value, label, selected, disabled, tip) {
  return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + (disabled ? ' disabled' : '') + (tip ? ' title="' + esc(tip) + '"' : '') + '>' + esc(label) + '</option>';
}

/**
 * Installs the builder in `container` and keeps it in step with state.spec.
 * @param {HTMLElement} container
 * @param {{ page: string }} opts the page id, for the dataset picker's memory
 * @returns {{ refresh: () => void }}
 */
const PRED_TIP = 'A main effect: a slope for a continuous predictor, or a coefficient per level for a categorical one.';
const POW_TIP = 'A polynomial term in a continuous predictor, of the degree given: a curve rather than a line.';
const IA_TIP = 'The product of two predictors, which lets the effect of one depend on the other. Its main effects join the model with it.';
const OLRE_TIP = 'An observation-level random intercept: each row gets its own normal deviation on the log scale, which turns the Poisson into a Poisson-lognormal and absorbs overdispersion.';
const OLRE_OFF_TIP = 'Not for this family: the negative binomial already carries its own overdispersion parameter, θ, and an observation-level effect would compete with it for the same spread. Choose the Poisson family to use it.';

export function formulaBuilder(container, opts) {
  container.innerHTML =
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-ds">Dataset</label><select id="fb-ds"></select></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-resp">Response</label><select id="fb-resp"></select></span>' +
      '<span class="ctrl-note" id="fb-support"></span>' +
    '</div>' +
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-family"><span class="tip" tabindex="0" data-tip="The distribution of the response around its mean, given the predictors. The families the response\'s values rule out are grayed.">Family</span></label><select id="fb-family"></select></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-link"><span class="tip" tabindex="0" data-tip="The function that connects the mean to the linear predictor. Each family\'s canonical or customary link is the default.">Link</span></label><select id="fb-link"></select></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-level">Confidence</label><select id="fb-level"></select></span>' +
    '</div>' +
    '<div class="ctrl-grp-lbl">Model</div>' +
    '<div class="fb-model" id="fb-model" aria-live="polite"></div>' +
    '<div class="ctrl-grp-lbl">Add to the model</div>' +
    '<div class="ctrl-row fb-add">' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-add-pred"><span class="tip" tabindex="0" id="fb-add-pred-tip" data-tip="">Predictor</span></label><select id="fb-add-pred"></select><button type="button" class="btn-clear" id="fb-add-pred-btn">Add</button></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-add-pow"><span class="tip" tabindex="0" id="fb-add-pow-tip" data-tip="">Power of</span></label><select id="fb-add-pow"></select><input type="text" id="fb-add-deg" class="par-inp" value="2" aria-label="Degree" style="width:56px"><button type="button" class="btn-clear" id="fb-add-pow-btn">Add</button></span>' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-add-ia"><span class="tip" tabindex="0" id="fb-add-ia-tip" data-tip="">Interaction</span></label><select id="fb-add-ia"></select><span class="ctrl-note">×</span><select id="fb-add-ib" aria-label="Second factor of the interaction"></select><button type="button" class="btn-clear" id="fb-add-ia-btn">Add</button></span>' +
    '</div>' +
    '<div class="ctrl-grp-lbl">Random effects</div>' +
    '<div class="ctrl-row">' +
      '<span class="ctrl-pair"><label class="ctrl-lbl" for="fb-group"><span class="tip" tabindex="0" data-tip="A grouping factor whose rows share an unmeasured something: a random intercept per group is added to the model.">Group</span></label><select id="fb-group"></select></span>' +
      '<span class="ctrl-pair" id="fb-slope-pair"><label class="ctrl-lbl" for="fb-slope"><span class="tip" tabindex="0" data-tip="A continuous predictor whose slope varies from group to group, correlated with the group\'s intercept.">Random slope on</span></label><select id="fb-slope"></select></span>' +
      '<span class="ctrl-pair" id="fb-nested-pair"><label class="ctrl-lbl" for="fb-nested"><span class="tip" tabindex="0" data-tip="A second grouping factor nested inside the first, such as a nest within a colony.">Nested in it</span></label><select id="fb-nested"></select></span>' +
      '<label class="ctrl-chk" id="fb-olre-lbl"><input type="checkbox" id="fb-olre"> <span class="tip" tabindex="0" data-tip="An observation-level random intercept: each row gets its own normal deviation on the log scale, which turns the Poisson into a Poisson-lognormal and absorbs overdispersion.">Poisson-lognormal</span></label>' +
      '<label class="ctrl-chk" id="fb-reml-lbl"><input type="checkbox" id="fb-reml"> <span class="tip" tabindex="0" data-tip="Restricted maximum likelihood for the normal family\'s mixed model, as lmer uses by default. Off, the fit is by maximum likelihood, which the AIC comparisons need.">REML</span></label>' +
    '</div>';

  const q = s => container.querySelector(s);
  const el = { ds: q('#fb-ds'), resp: q('#fb-resp'), support: q('#fb-support'), family: q('#fb-family'), link: q('#fb-link'), level: q('#fb-level'),
    model: q('#fb-model'), addPredTip: q('#fb-add-pred-tip'), addPowTip: q('#fb-add-pow-tip'), addIaTip: q('#fb-add-ia-tip'), olreTip: q('#fb-olre-lbl .tip'), addPred: q('#fb-add-pred'), addPredBtn: q('#fb-add-pred-btn'), addPow: q('#fb-add-pow'), addDeg: q('#fb-add-deg'), addPowBtn: q('#fb-add-pow-btn'),
    addIa: q('#fb-add-ia'), addIb: q('#fb-add-ib'), addIaBtn: q('#fb-add-ia-btn'), group: q('#fb-group'), slope: q('#fb-slope'), nested: q('#fb-nested'),
    olre: q('#fb-olre'), reml: q('#fb-reml') };
  levelSelect(el.level);
  const deg = spinner(el.addDeg, { min: 2, max: 6, step: 1 });

  let syncing = false;
  const current = () => state.get(state.spec.dataset);

  // The dataset picker drives the spec's dataset; a new dataset gets its default spec.
  datasetSelect(el.ds, { remember: { page: opts.page, key: 'dataset' } });
  el.ds.addEventListener('change', () => {
    if (syncing) return;
    const ds = state.get(el.ds.value);
    if (!ds) { state.setSpec(state.emptySpec()); return; }
    if (state.spec.dataset !== ds.id) state.setSpec(defaultSpec(ds));
  });

  el.resp.addEventListener('change', () => {
    const ds = current();
    if (!ds) return;
    const rc = column(ds, el.resp.value);
    const sup = rc ? support(rc.col, valuesOf(ds, rc.col.name)) : 'real';
    const fam = familiesFor(sup).includes(state.spec.family) ? state.spec.family : defaultFamily(sup);
    state.setSpec({ response: el.resp.value, family: fam, link: null, terms: state.spec.terms.filter(t => !termUses(t, el.resp.value)) });
  });
  // The observation-level effect is a Poisson device: the negative binomial
  // already carries its own overdispersion parameter, and the two would
  // compete for the same spread. Leaving a family that offered it drops it.
  el.family.addEventListener('change', () => state.setSpec({ family: el.family.value, link: null, olre: el.family.value === 'poisson' && state.spec.olre }));
  el.link.addEventListener('change', () => state.setSpec({ link: el.link.value }));
  el.addPredBtn.addEventListener('click', () => { if (el.addPred.value) addTerm(el.addPred.value); });
  el.addPowBtn.addEventListener('click', () => { if (el.addPow.value) addTerm({ name: el.addPow.value, degree: deg.get() }); });
  el.addIaBtn.addEventListener('click', () => { if (el.addIa.value && el.addIb.value && el.addIa.value !== el.addIb.value) addTerm({ of: [el.addIa.value, el.addIb.value] }); });
  el.group.addEventListener('change', () => state.setSpec({ group: el.group.value || null, slope: el.group.value ? state.spec.slope : null, nested: el.group.value ? state.spec.nested : null }));
  el.slope.addEventListener('change', () => state.setSpec({ slope: el.slope.value || null }));
  el.nested.addEventListener('change', () => state.setSpec({ nested: el.nested.value || null }));
  el.olre.addEventListener('change', () => state.setSpec({ olre: el.olre.checked }));
  el.reml.addEventListener('change', () => state.setSpec({ reml: el.reml.checked }));
  el.addIa.addEventListener('change', refresh);
  el.model.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-term]');
    if (!b) return;
    const k = Number(b.getAttribute('data-term'));
    const all = orderedTerms(state.spec);
    const gone = all[k];
    // Removing a main effect also removes the powers and interactions that use it.
    const terms = all.filter((t, i) => i !== k && !(typeof gone === 'string' && typeof t === 'object' && termUses(t, gone)));
    state.setSpec({ terms });
  });

  function addTerm(t) {
    const terms = orderedTerms(state.spec);
    if (terms.some(x => termLabel(x) === termLabel(t))) return;
    // An interaction's factors are entered as main effects when absent.
    if (typeof t === 'object' && t.of) for (const v of t.of) if (!terms.some(x => termLabel(x) === v)) terms.push(v);
    terms.push(t);
    state.setSpec({ terms });
  }

  function refresh() {
    syncing = true;
    try {
      const ds = current();
      if (ds && el.ds.value !== ds.id) el.ds.value = ds.id;
      const s = state.spec;
      const cols = ds ? ds.columns.filter(c => c.role !== 'ignored') : [];
      el.resp.innerHTML = cols.map(c => opt(c.name, c.name, c.name === s.response)).join('') || opt('', 'No dataset', true);
      el.resp.disabled = !ds;
      const rc = ds && s.response ? column(ds, s.response) : null;
      const sup = rc ? support(rc.col, valuesOf(ds, rc.col.name)) : null;
      el.support.textContent = sup ? 'The response holds ' + SUPPORT_LABEL[sup] + '.' : '';
      const fits = sup ? familiesFor(sup) : FAMILY_ORDER;
      el.family.innerHTML = FAMILY_ORDER.map(id => opt(id, FAMILIES[id].label, id === s.family, !fits.includes(id), fits.includes(id) ? FAMILY_TIP[id] : 'The response\'s values are not ' + FAMILIES[id].domain + '.')).join('');
      const fam = FAMILIES[s.family] || FAMILIES.normal;
      const link = linkOf(s.family, s.link);
      el.link.innerHTML = fam.links.map(id => opt(id, LINKS[id].label, id === link.id)).join('');
      // The model line: the response, each fixed term as a removable chip,
      // and the random part as the selects below write it.
      const terms = orderedTerms(s);
      if (ds && s.response) {
        const base = formulaOf(Object.assign({}, s, { terms: [] }));
        const random = base.startsWith(s.response + ' ~ 1') ? base.slice((s.response + ' ~ 1').length) : '';
        const chips = terms.map((t, i) => '<span class="fb-term">' + esc(termLabel(t)) + '<button type="button" class="fb-term-x" data-term="' + i + '" aria-label="Remove ' + esc(termLabel(t)) + '">×</button></span>');
        el.model.innerHTML = '<div class="fb-model-line"><span class="fb-model-resp">' + esc(s.response) + '</span><span class="fb-model-op">~</span>' +
          (chips.length ? chips.join('<span class="fb-model-op">+</span>') : '<span class="fb-model-one">1</span>') +
          (random ? '<span class="fb-model-rand">' + esc(random) + '</span>' : '') + '</div>' +
          '<div class="fb-model-fam">' + esc(fam.label + ' family, ' + link.label + ' link') + '</div>';
        const missing = missingMainEffects(s);
        if (missing.length) el.model.insertAdjacentHTML('beforeend', '<div class="ctrl-note">An interaction needs its main effects: ' + esc(missing.join(', ')) + '.</div>');
      } else {
        el.model.innerHTML = '<span class="muted-line">Choose a dataset and a response.</span>';
      }
      // The adders: each is grayed, with its tooltip saying why, once the
      // dataset has nothing left for it to add.
      const preds = ds ? ds.columns.filter(c => c.role !== 'ignored' && c.role !== 'group' && c.name !== s.response) : [];
      const cont = preds.filter(c => c.type === 'continuous');
      const have = new Set(terms.map(termLabel));
      const left = preds.filter(c => !have.has(c.name));
      el.addPred.innerHTML = left.map(c => opt(c.name, c.name)).join('') || opt('', ds ? 'all in the model' : 'none', true);
      el.addPred.disabled = el.addPredBtn.disabled = !left.length;
      el.addPredTip.setAttribute('data-tip', PRED_TIP + (ds && !left.length ? ' Every predictor is in the model.' : ''));
      el.addPow.innerHTML = cont.map(c => opt(c.name, c.name)).join('') || opt('', 'none', true);
      el.addPow.disabled = el.addDeg.disabled = el.addPowBtn.disabled = !cont.length;
      el.addPowTip.setAttribute('data-tip', POW_TIP + (ds && !cont.length ? ' The dataset has no continuous predictor.' : ''));
      const pairKey = (a, b) => [a, b].sort().join('\u0000');
      const paired = new Set(terms.filter(t => typeof t === 'object' && t.of).map(t => pairKey(t.of[0], t.of[1])));
      const partners = a => preds.filter(c => c.name !== a && !paired.has(pairKey(a, c.name)));
      const firsts = preds.filter(c => partners(c.name).length);
      const keepA = el.addIa.value;
      el.addIa.innerHTML = firsts.map(c => opt(c.name, c.name, c.name === keepA)).join('') || opt('', 'none', true);
      const seconds = el.addIa.value ? partners(el.addIa.value) : [];
      el.addIb.innerHTML = seconds.map(c => opt(c.name, c.name)).join('') || opt('', 'none', true);
      el.addIa.disabled = el.addIb.disabled = el.addIaBtn.disabled = !firsts.length;
      el.addIaTip.setAttribute('data-tip', IA_TIP + (!ds ? '' : preds.length < 2 ? ' An interaction needs two predictors.' : !firsts.length ? ' Every pair of predictors is in the model.' : ''));
      // Random part.
      const groups = ds ? ds.columns.filter(c => c.role === 'group') : [];
      el.group.innerHTML = opt('', 'none', !s.group) + groups.map(c => opt(c.name, c.name, c.name === s.group)).join('');
      el.group.disabled = !groups.length || s.family === 'ordinal';
      q('#fb-slope-pair').hidden = !s.group;
      q('#fb-nested-pair').hidden = !s.group || groups.length < 2;
      el.slope.innerHTML = opt('', 'none', !s.slope) + cont.filter(c => have.has(c.name)).map(c => opt(c.name, c.name, c.name === s.slope)).join('');
      el.nested.innerHTML = opt('', 'none', !s.nested) + groups.filter(c => c.name !== s.group).map(c => opt(c.name, c.name, c.name === s.nested)).join('');
      // The observation-level effect is shown for the two count families: live
      // for the Poisson, and grayed with the reason for the negative binomial.
      q('#fb-olre-lbl').hidden = !(s.family === 'poisson' || s.family === 'negbin');
      el.olre.disabled = s.family === 'negbin';
      el.olre.checked = !!s.olre;
      el.olreTip.setAttribute('data-tip', s.family === 'negbin' ? OLRE_OFF_TIP : OLRE_TIP);
      q('#fb-reml-lbl').hidden = !(s.family === 'normal' && (s.group || s.olre));
      el.reml.checked = !!s.reml;
      registerTips(container);
    } finally { syncing = false; }
  }
  state.on('spec', refresh);
  state.on('datasets', refresh);
  // A dataset selected elsewhere (one just loaded on the Import page, or
  // opened from the Tests page) becomes the model's dataset.
  state.on('selection', sel => {
    const ds = sel ? state.get(sel) : null;
    if (ds && state.spec.dataset !== ds.id) { el.ds.value = ds.id; state.setPick(opts.page, 'dataset', ds.id); state.setSpec(defaultSpec(ds)); }
  });
  refresh();
  return { refresh };
}

function termUses(t, name) {
  if (typeof t === 'string') return t === name;
  if (t.degree) return t.name === name;
  return t.of.includes(name);
}
