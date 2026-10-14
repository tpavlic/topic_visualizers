// Mixed models with one grouping factor, as lme4 fits them: the random
// effects u = Λ_θ b with b standard normal, the relative covariance factor Λ
// built from one lower-triangular block per group (an intercept, or an
// intercept and a slope), a scalar per nested level, and a scalar per
// observation for the observation-level effect; the conditional modes by
// penalized iteratively reweighted least squares; the Laplace approximation
// to the deviance; and for the normal family the deviance profiled over β
// and σ² exactly, by maximum likelihood or REML. Ordering the random effects
// by the outer group keeps every system block diagonal, with one dense block
// per group, and so no sparse code is needed. Pure functions, no DOM.

import { FAMILIES, linkOf } from './families.js';
import { digamma, trigamma } from './negbin.js';
import { nelderMead, bfgsPolish } from './optim.js';
import { logGamma } from './special.js';
import { cholesky, cholSolve, cholInverse, cholLogDet, zeros } from './linalg.js';

/**
 * @typedef {{ kind: 'group'|'nested'|'olre', name: string, ids: number[], levels: string[], q: number, slope: Float64Array|null }} RandomTerm
 */

/**
 * Builds the random part from a design: the group term (with its slope),
 * the nested term, and the observation-level term, and the outer blocks.
 * @param {ReturnType<import('./design.js').modelMatrix>} design
 * @param {{ group: string|null, nested: string|null, slope: string|null, olre: boolean }} spec
 * @returns {{ terms: RandomTerm[], blocks: { obs: number[], cols: number, map: { term: number, level: number, col: number }[] }[], blockOf: number[], nTheta: number }}
 */
export function buildRandom(design, spec) {
  const n = design.X.length;
  const terms = [];
  if (design.groups) terms.push({ kind: 'group', name: spec.group, ids: design.groups.ids, levels: design.groups.levels, q: design.slopeCol ? 2 : 1, slope: design.slopeCol });
  if (design.nested && design.groups) terms.push({ kind: 'nested', name: spec.group + ':' + spec.nested, ids: design.nested.ids, levels: design.nested.levels, q: 1, slope: null });
  if (spec.olre) terms.push({ kind: 'olre', name: 'obs', ids: Array.from({ length: n }, (_, i) => i), levels: Array.from({ length: n }, (_, i) => String(i + 1)), q: 1, slope: null });
  if (!terms.length) throw new Error('The model has no random effect.');
  // The outer blocks: the group's levels, or each observation when only the
  // observation-level effect is present.
  const outer = design.groups ? design.groups.ids : Array.from({ length: n }, (_, i) => i);
  const nBlocks = design.groups ? design.groups.levels.length : n;
  const blocks = Array.from({ length: nBlocks }, () => ({ obs: [], cols: 0, map: [] }));
  for (let i = 0; i < n; i++) blocks[outer[i]].obs.push(i);
  // Each block's columns: the group's q, its nested levels, and its observations, in that order.
  blocks.forEach((b, j) => {
    let col = 0;
    terms.forEach((t, ti) => {
      if (t.kind === 'group') { b.map.push({ term: ti, level: j, col }); col += t.q; }
      else if (t.kind === 'nested') {
        const seen = new Set();
        for (const i of b.obs) { const l = t.ids[i]; if (!seen.has(l)) { seen.add(l); b.map.push({ term: ti, level: l, col }); col += 1; } }
      } else { for (const i of b.obs) { b.map.push({ term: ti, level: i, col }); col += 1; } }
    });
    b.cols = col;
  });
  const nTheta = terms.reduce((s, t) => s + (t.q === 2 ? 3 : 1), 0);
  return { terms, blocks, blockOf: outer, nTheta };
}

// The row of ZΛ for observation i within its block: the entries by column.
function zlRow(random, theta, i, block) {
  const out = [];
  let off = 0;
  random.terms.forEach((t, ti) => {
    const nT = t.q === 2 ? 3 : 1;
    const th = theta.slice(off, off + nT);
    off += nT;
    if (t.kind === 'group') {
      const m = block.map.find(e => e.term === ti);
      if (t.q === 1) out.push([m.col, th[0]]);
      else { const s = t.slope[i]; out.push([m.col, th[0] + s * th[1]], [m.col + 1, s * th[2]]); }
    } else {
      const l = t.ids[i];
      const m = block.map.find(e => e.term === ti && e.level === l);
      out.push([m.col, th[0]]);
    }
  });
  return out;
}

// The diagonal entries of θ, which lme4 bounds below at zero: every entry
// but the slope's correlation entry.
function diagonalMask(random) {
  const mask = [];
  for (const t of random.terms) { if (t.q === 2) mask.push(true, false, true); else mask.push(true); }
  return mask;
}

/**
 * Per-observation score and weight of the conditional log-likelihood in the
 * linear predictor: the GLM working weight and residual for the families
 * lme4 fits (expected information) and the observed information for the
 * beta family, as glmmTMB forms it.
 */
function scoreWeight(family, link, y, eta, aux) {
  const fam = FAMILIES[family];
  const n = y.length;
  const w = new Float64Array(n), r = new Float64Array(n), mu = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const m = link.linkinv(eta[i]), me = link.mu_eta(eta[i]);
    mu[i] = m;
    if (family === 'beta') {
      const a = m * aux, b = (1 - m) * aux;
      const ystar = Math.log(y[i] / (1 - y[i])), mustar = digamma(a) - digamma(b);
      const score = aux * (ystar - mustar) * me;
      // d²μ/dη² for the logit link is μ(1−μ)(1−2μ); for the others, it is taken as zero.
      const d2 = link.id === 'logit' ? m * (1 - m) * (1 - 2 * m) : 0;
      const wi = aux * aux * (trigamma(a) + trigamma(b)) * me * me - aux * (ystar - mustar) * d2;
      w[i] = Math.max(wi, 1e-10); r[i] = score / w[i];
    } else {
      const v = fam.variance(m, aux);
      w[i] = me * me / v; r[i] = (y[i] - m) / me;
    }
  }
  return { w, r, mu };
}

// The conditional log-likelihood as a function of μ, with every part that
// does not depend on μ summed once: the gamma-function terms of the Poisson
// and negative binomial families are the bulk of a PIRLS iteration's cost.
function condLogLik(family, y, aux) {
  const n = y.length, fam = FAMILIES[family];
  if (family === 'poisson') {
    let c = 0;
    for (let i = 0; i < n; i++) c -= logGamma(y[i] + 1);
    return mu => { let s = c; for (let i = 0; i < n; i++) s += y[i] * Math.log(mu[i]) - mu[i]; return s; };
  }
  if (family === 'negbin') {
    let c = 0;
    const lt = Math.log(aux), lg = logGamma(aux);
    for (let i = 0; i < n; i++) c += logGamma(aux + y[i]) - lg - logGamma(y[i] + 1) + aux * lt;
    return mu => { let s = c; for (let i = 0; i < n; i++) s += y[i] * Math.log(mu[i]) - (aux + y[i]) * Math.log(aux + mu[i]); return s; };
  }
  // The gamma family's inner criterion is its deviance, dispersion-free, as lme4's
  // penalized weighted residual sum of squares is: the iterations' fixed point minimizes
  // it, where the profiled-dispersion likelihood (the Laplace value) has another minimizer.
  if (family === 'gamma') return mu => { let s = 0; for (let i = 0; i < n; i++) s -= 0.5 * fam.devResid(y[i], mu[i]); return s; };
  return mu => fam.logLik(y, mu, aux, n);
}

/**
 * The conditional modes at fixed β and θ by PIRLS, and the Laplace deviance.
 * @returns {{ b: Float64Array, dev: number, pdev: number, ldL2: number, mu: Float64Array, eta: Float64Array, w: Float64Array, blocksL: Float64Array[][], converged: boolean }}
 */
function pirls(y, X, random, family, link, beta, theta, aux, b0) {
  const n = y.length, fam = FAMILIES[family];
  const nb = random.blocks.reduce((s, bl) => s + bl.cols, 0);
  const offsets = []; let off = 0;
  for (const bl of random.blocks) { offsets.push(off); off += bl.cols; }
  let b = b0 && b0.length === nb ? Float64Array.from(b0) : new Float64Array(nb);
  const xb = Float64Array.from(X, x => { let s = 0; for (let j = 0; j < beta.length; j++) s += x[j] * beta[j]; return s; });
  // ZΛ rows, fixed for the fit.
  const rows = Array.from({ length: n }, (_, i) => zlRow(random, theta, i, random.blocks[random.blockOf[i]]));
  const etaOf = bb => Float64Array.from(xb, (v, i) => { let s = v; const bl = random.blockOf[i]; for (const [c, z] of rows[i]) s += z * bb[offsets[bl] + c]; return s; });
  const ll = condLogLik(family, y, aux);
  const pdevOf = bb => {
    const eta = etaOf(bb);
    const mu = Float64Array.from(eta, e => link.linkinv(e));
    let d = -2 * ll(mu);
    for (let k = 0; k < nb; k++) d += bb[k] * bb[k];
    return { pdev: d, eta, mu };
  };
  let cur = pdevOf(b);
  let converged = false;
  let blocksL = null, w = null;
  // Weights that overflow at an extreme trial point leave a block that will
  // not factor; the deviance there is infinite, which the outer search steps
  // away from, rather than an error.
  let failed = false;
  const failure = () => ({ b, dev: Infinity, pdev: Infinity, ldL2: Infinity, mu: cur.mu, eta: cur.eta, w, blocksL, rows, offsets, converged: false });
  for (let it = 0; it < 60; it++) {
    const sw = scoreWeight(family, link, y, cur.eta, aux);
    w = sw.w;
    const bNew = new Float64Array(nb);
    blocksL = [];
    random.blocks.forEach((bl, j) => {
      if (failed) return;
      const c = bl.cols;
      const M = zeros(c, c), rhs = new Float64Array(c);
      for (let k = 0; k < c; k++) M[k][k] = 1;
      for (const i of bl.obs) {
        const zr = rows[i], wi = w[i];
        // The working response for the random part: ZΛb + r.
        let zu = sw.r[i];
        for (const [cc, z] of zr) zu += z * b[offsets[j] + cc];
        for (const [ca, za] of zr) {
          rhs[ca] += za * wi * zu;
          for (const [cb, zb] of zr) M[ca][cb] += za * wi * zb;
        }
      }
      const L = cholesky(M, 1e-300);
      if (!L) { failed = true; return; }
      blocksL.push(L);
      const sol = cholSolve(L, rhs);
      for (let k = 0; k < c; k++) bNew[offsets[j] + k] = sol[k];
    });
    if (failed) return failure();
    // Step halving on the penalized deviance.
    let t = 1, next = null;
    const bPrev = b;
    for (let h = 0; h < 20; h++) {
      const bt = Float64Array.from(bPrev, (v, k) => v + t * (bNew[k] - v));
      next = pdevOf(bt);
      if (Number.isFinite(next.pdev) && next.pdev <= cur.pdev + 1e-10) { b = bt; break; }
      t /= 2;
      next = null;
    }
    if (!next) break;
    const change = Math.abs(cur.pdev - next.pdev) / (Math.abs(next.pdev) + 0.1);
    let moved = 0;
    for (let k = 0; k < nb; k++) moved = Math.max(moved, Math.abs(b[k] - bPrev[k]));
    cur = next;
    // Tight, so that the outer search sees a smooth objective.
    if (change < 1e-14 || moved < 1e-11) { converged = true; break; }
  }
  // The determinant at the solution's weights.
  const sw = scoreWeight(family, link, y, cur.eta, aux);
  w = sw.w;
  blocksL = [];
  let ldL2 = 0;
  random.blocks.forEach((bl, j) => {
    const c = bl.cols;
    const M = zeros(c, c);
    for (let k = 0; k < c; k++) M[k][k] = 1;
    for (const i of bl.obs) { const zr = rows[i], wi = w[i]; for (const [ca, za] of zr) for (const [cb, zb] of zr) M[ca][cb] += za * wi * zb; }
    const L = cholesky(M, 1e-300);
    if (!L) { failed = true; return; }
    blocksL.push(L);
    ldL2 += cholLogDet(L);
  });
  if (failed) return failure();
  // The Laplace value's data term: for the gamma family, the conditional log-likelihood at
  // its profiled dispersion plus 2 for that parameter, as lme4 forms it through R's
  // Gamma()$aic; for the other families, the penalized deviance as it stands.
  let data = cur.pdev;
  if (family === 'gamma') { let sb = 0; for (let k = 0; k < nb; k++) sb += b[k] * b[k]; data = -2 * fam.logLik(y, cur.mu, aux, n) + sb + 2; }
  return { b, dev: data + ldL2, pdev: cur.pdev, ldL2, mu: cur.mu, eta: cur.eta, w, blocksL, rows, offsets, converged };
}

// PIRLS over β and b together, at fixed θ: the fixed effects enter the
// same working least-squares problem unpenalized, solved through the Schur
// complement over the blocks. Returns the Laplace deviance at the joint
// solution, which lme4 uses for its first stage.
function pirlsJoint(y, X, random, family, link, theta, aux, b0) {
  const n = y.length, p = X[0].length, fam = FAMILIES[family];
  const offsets = []; let off = 0;
  for (const bl of random.blocks) { offsets.push(off); off += bl.cols; }
  const nb = off;
  let b = b0 && b0.length === nb ? Float64Array.from(b0) : new Float64Array(nb);
  const rows = Array.from({ length: n }, (_, i) => zlRow(random, theta, i, random.blocks[random.blockOf[i]]));
  let beta = new Float64Array(p);
  // A first η from the family's starting values.
  let eta = Float64Array.from(y, v => link.linkfun(fam.initialize(v)));
  const etaOf = (bb, bt) => Float64Array.from(X, (x, i) => { let s = 0; for (let j = 0; j < p; j++) s += x[j] * bt[j]; const bl = random.blockOf[i]; for (const [c, z] of rows[i]) s += z * bb[offsets[bl] + c]; return s; });
  const ll = condLogLik(family, y, aux);
  const pdevOf = (bb, bt) => { const e = etaOf(bb, bt); const mu = Float64Array.from(e, v => link.linkinv(v)); let d = -2 * ll(mu); for (let k = 0; k < nb; k++) d += bb[k] * bb[k]; return { pdev: d, eta: e, mu }; };
  let cur = null;
  for (let it = 0; it < 60; it++) {
    const sw = scoreWeight(family, link, y, eta, aux);
    const w = sw.w;
    // The working response: η + r.
    const z = Float64Array.from(eta, (e, i) => e + sw.r[i]);
    const RXX = zeros(p, p), rX = new Float64Array(p);
    for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) { rX[a] += X[i][a] * w[i] * z[i]; for (let c = 0; c < p; c++) RXX[a][c] += X[i][a] * w[i] * X[i][c]; }
    const blocksL = [], Cs = [], gs = [];
    let failed = false;
    random.blocks.forEach((bl, j) => {
      if (failed) return;
      const c = bl.cols;
      const M = zeros(c, c), C = zeros(c, p), g = new Float64Array(c);
      for (let q = 0; q < c; q++) M[q][q] = 1;
      for (const i of bl.obs) {
        const zr = rows[i], wi = w[i];
        for (const [ca, za] of zr) {
          g[ca] += za * wi * z[i];
          for (let a = 0; a < p; a++) C[ca][a] += za * wi * X[i][a];
          for (const [cb, zb] of zr) M[ca][cb] += za * wi * zb;
        }
      }
      const L = cholesky(M, 1e-300);
      if (!L) { failed = true; return; }
      blocksL.push(L); Cs.push(C); gs.push(g);
      const Mg = cholSolve(L, g);
      for (let a = 0; a < p; a++) {
        const col = Float64Array.from({ length: c }, (_, q) => C[q][a]);
        const sol = cholSolve(L, col);
        for (let b2 = 0; b2 < p; b2++) { let s2 = 0; for (let q = 0; q < c; q++) s2 += C[q][b2] * sol[q]; RXX[a][b2] -= s2; }
        let s2 = 0; for (let q = 0; q < c; q++) s2 += C[q][a] * Mg[q]; rX[a] -= s2;
      }
    });
    if (failed) return null;
    const LX = cholesky(RXX);
    if (!LX) return null;
    const betaNew = cholSolve(LX, rX);
    const bNew = new Float64Array(nb);
    random.blocks.forEach((bl, j) => {
      const rhs = Float64Array.from(gs[j], (v, q) => { let s2 = v; for (let a = 0; a < p; a++) s2 -= Cs[j][q][a] * betaNew[a]; return s2; });
      const sol = cholSolve(blocksL[j], rhs);
      for (let q = 0; q < bl.cols; q++) bNew[offsets[j] + q] = sol[q];
    });
    if (!cur) cur = pdevOf(b, beta);
    let t = 1, next = null;
    for (let h = 0; h < 20; h++) {
      const bt = Float64Array.from(b, (v, k) => v + t * (bNew[k] - v)), bb = Float64Array.from(beta, (v, k) => v + t * (betaNew[k] - v));
      next = pdevOf(bt, bb);
      if (Number.isFinite(next.pdev) && next.pdev <= cur.pdev + 1e-10) { b = bt; beta = bb; break; }
      t /= 2; next = null;
    }
    if (!next) break;
    const change = Math.abs(cur.pdev - next.pdev) / (Math.abs(next.pdev) + 0.1);
    cur = next; eta = cur.eta;
    if (change < 1e-10) break;
  }
  const r = pirls(y, X, random, family, link, beta, theta, aux, b);
  return { dev: r.dev, beta, b: r.b };
}

// The covariance of β from the penalized system: the Schur complement of the
// random part, inverted.
function betaCov(X, random, w, rows, blocksL, offsets, scale) {
  const p = X[0].length;
  const R = zeros(p, p);
  const n = X.length;
  for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) for (let c = 0; c < p; c++) R[a][c] += X[i][a] * w[i] * X[i][c];
  random.blocks.forEach((bl, j) => {
    const c = bl.cols;
    // C = (ZΛ)'W X for the block, c by p.
    const C = zeros(c, p);
    for (const i of bl.obs) { const zr = rows[i], wi = w[i]; for (const [ca, za] of zr) for (let a = 0; a < p; a++) C[ca][a] += za * wi * X[i][a]; }
    const L = blocksL[j];
    // R -= C' M^{-1} C.
    for (let a = 0; a < p; a++) {
      const col = Float64Array.from({ length: c }, (_, k) => C[k][a]);
      const sol = cholSolve(L, col);
      for (let b2 = 0; b2 < p; b2++) { let s = 0; for (let k = 0; k < c; k++) s += C[k][b2] * sol[k]; R[a][b2] -= s; }
    }
  });
  const L = cholesky(R);
  const V = L ? cholInverse(L) : null;
  return { vcov: V ? V.map(r => Float64Array.from(r, v => v * scale)) : null, R };
}

// The variance components from θ: for each term its variances, standard
// deviations, and the slope's correlation, times σ².
function varComp(random, theta, sigma2) {
  const out = [];
  let off = 0;
  for (const t of random.terms) {
    if (t.q === 2) {
      const [a, b, c] = [theta[off], theta[off + 1], theta[off + 2]];
      const v1 = a * a, v2 = b * b + c * c, cov = a * b;
      out.push({ term: t.name, names: ['(Intercept)', 'slope'], variances: [v1 * sigma2, v2 * sigma2], covariance: cov * sigma2, correlation: v1 > 0 && v2 > 0 ? cov / Math.sqrt(v1 * v2) : NaN });
      off += 3;
    } else { out.push({ term: t.name, names: ['(Intercept)'], variances: [theta[off] * theta[off] * sigma2], covariance: null, correlation: null }); off += 1; }
  }
  return out;
}

// The random effects u = Λb per term and level, with their conditional variances.
function ranefOf(random, theta, b, offsets, blocksL, sigma2) {
  const out = random.terms.map(t => ({ term: t.name, levels: t.levels, q: t.q, modes: Array.from({ length: t.levels.length }, () => new Float64Array(t.q)), condvar: Array.from({ length: t.levels.length }, () => new Float64Array(t.q)) }));
  random.blocks.forEach((bl, j) => {
    const L = blocksL[j], c = bl.cols;
    const Minv = cholInverse(L);
    let off = 0;
    random.terms.forEach((t, ti) => {
      const nT = t.q === 2 ? 3 : 1;
      const th = theta.slice(off, off + nT);
      off += nT;
      for (const m of bl.map) {
        if (m.term !== ti) continue;
        if (t.q === 1) {
          out[ti].modes[m.level][0] = th[0] * b[offsets[j] + m.col];
          out[ti].condvar[m.level][0] = th[0] * th[0] * Minv[m.col][m.col] * sigma2;
        } else {
          // u = T b with T = [[θ1, 0], [θ2, θ3]].
          const b1 = b[offsets[j] + m.col], b2 = b[offsets[j] + m.col + 1];
          out[ti].modes[m.level][0] = th[0] * b1;
          out[ti].modes[m.level][1] = th[1] * b1 + th[2] * b2;
          const V11 = Minv[m.col][m.col], V12 = Minv[m.col][m.col + 1], V22 = Minv[m.col + 1][m.col + 1];
          out[ti].condvar[m.level][0] = th[0] * th[0] * V11 * sigma2;
          out[ti].condvar[m.level][1] = (th[1] * th[1] * V11 + 2 * th[1] * th[2] * V12 + th[2] * th[2] * V22) * sigma2;
        }
      }
    });
  });
  return out;
}

/**
 * Fits a generalized linear mixed model by the Laplace approximation (the
 * normal family goes through fitLmm). The outer search runs over θ and β,
 * and over log θ or log φ for the negative binomial and beta families.
 * @param {Float64Array} y
 * @param {Float64Array[]} X
 * @param {ReturnType<typeof buildRandom>} random
 * @param {{ family: string, link?: string|null, beta0: Float64Array, aux0?: number }} o
 */
export function fitGlmm(y, X, random, o) {
  const link = linkOf(o.family, o.link);
  const n = y.length, p = X[0].length;
  const mask = diagonalMask(random);
  const withAux = o.family === 'negbin' || o.family === 'beta';
  const theta0 = new Float64Array(random.nTheta);
  let k = 0;
  for (const t of random.terms) { if (t.q === 2) { theta0[k] = 1; theta0[k + 1] = 0; theta0[k + 2] = 1; k += 3; } else theta0[k++] = 1; }
  const x0 = new Float64Array(random.nTheta + p + (withAux ? 1 : 0));
  x0.set(theta0, 0); x0.set(o.beta0, random.nTheta);
  if (withAux) x0[x0.length - 1] = Math.log(o.aux0 || 1);
  let warm = null;
  const unpack = x => {
    const theta = Float64Array.from(x.slice(0, random.nTheta), (v, i) => (mask[i] ? Math.abs(v) : v));
    const beta = Float64Array.from(x.slice(random.nTheta, random.nTheta + p));
    const aux = withAux ? Math.exp(x[x.length - 1]) : 1;
    return { theta, beta, aux };
  };
  // Every evaluation of stage 2 starts the inner solve from stage 1's modes,
  // so that the deviance is a function of x alone. A start carried over from
  // the last evaluation makes one x give deviances that differ in the eighth
  // digit, and where the dispersion is small (a gamma response that averages
  // many observations), that spread exceeds the simplex's tolerance and the
  // search runs to its cap at the optimum.
  const objective = x => {
    const { theta, beta, aux } = unpack(x);
    const r = pirls(y, X, random, o.family, link, beta, theta, aux, warm);
    return Number.isFinite(r.dev) ? r.dev : 1e300;
  };
  // Stage 1, as lme4's: θ alone with β profiled out by the joint PIRLS,
  // which puts the outer search near its optimum; stage 2 over θ and β.
  const stage1 = nelderMead(th => {
    const theta = Float64Array.from(th, (v, i) => (mask[i] ? Math.abs(v) : v));
    const r = pirlsJoint(y, X, random, o.family, link, theta, withAux ? Math.exp(x0[x0.length - 1]) : 1, warm);
    if (!r) return 1e300;
    warm = r.b;
    x0.set(r.beta, random.nTheta);
    return r.dev;
  }, theta0, { step: 0.25, ftol: 1e-8, xtol: 1e-5, restarts: 1 });
  x0.set(stage1.x, 0);
  const step = Float64Array.from(x0, (v, i) => (i < random.nTheta ? 0.05 : i < random.nTheta + p ? 0.05 : 0.1));
  const nm = nelderMead(objective, x0, { step, ftol: 1e-9, xtol: 1e-6, restarts: 1, maxIter: 600 * x0.length });
  // A quasi-Newton polish finds the digits the simplex leaves behind.
  const pol = bfgsPolish(objective, nm.x, { h: 1e-4, maxIter: 40 });
  const res = pol.f <= nm.f ? { x: pol.x, f: pol.f, iterations: nm.iterations + pol.iterations, converged: nm.converged } : nm;
  const { theta, beta, aux } = unpack(res.x);
  const fin = pirls(y, X, random, o.family, link, beta, theta, aux, warm);
  // The covariance of β as lme4 reports it for a generalized model: the β
  // block of the inverse of the numerical Hessian of the deviance over θ and
  // β together, times 2, which carries the uncertainty in θ into β. The
  // Schur-complement form stands in where that Hessian is not positive
  // definite.
  // glmer.nb's final fit holds θ_nb fixed, and so its Hessian leaves it out;
  // glmmTMB's includes φ.
  // Every evaluation starts the inner solve from the same modes, so that
  // the differences see a smooth function rather than the solver's noise.
  const devAt = x => { const u = unpack(x); const r = pirls(y, X, random, o.family, link, u.beta, u.theta, u.aux, fin.b); return Number.isFinite(r.dev) ? r.dev : 1e300; };
  let vcov = o.family === 'negbin'
    ? hessianCov(xx => { const z = new Float64Array(xx.length + 1); z.set(xx); z[xx.length] = res.x[res.x.length - 1]; return devAt(z); }, res.x.slice(0, -1), random.nTheta, p)
    : hessianCov(devAt, res.x, random.nTheta, p);
  if (!vcov) vcov = betaCov(X, random, fin.w, fin.rows, fin.blocksL, fin.offsets, 1).vcov;
  const fam = FAMILIES[o.family];
  const logLik = -fin.dev / 2;
  const df = p + random.nTheta + (withAux || o.family === 'gamma' ? 1 : 0);
  const flags = [];
  if (!res.converged || !fin.converged) flags.push('notConverged');
  const vc = varComp(random, theta, 1);
  if (vc.some(v => v.variances.some(x => x < 1e-6 * Math.max(1e-6, varianceOf(y))))) flags.push('singularFit');
  if (random.terms[0].kind === 'group' && random.terms[0].levels.length < 5) flags.push('fewGroups');
  if (o.family === 'binomial' && fin.mu.some(m => m < 1e-8 || m > 1 - 1e-8)) flags.push('separation');
  const pearson = Float64Array.from(y, (v, i) => (v - fin.mu[i]) / Math.sqrt(fam.variance(fin.mu[i], aux)));
  // The gamma family's dispersion as lme4 estimates it: the penalized weighted residual sum
  // of squares over n, the Pearson chi-square plus the squared spherical random effects.
  let dispersion = 1;
  if (o.family === 'gamma') { let s = 0; for (let i = 0; i < n; i++) s += pearson[i] * pearson[i]; for (let k2 = 0; k2 < fin.b.length; k2++) s += fin.b[k2] * fin.b[k2]; dispersion = s / n; }
  return {
    mixed: true, beta, vcov, thetaRe: theta, varcomp: vc, ranef: ranefOf(random, theta, fin.b, fin.offsets, fin.blocksL, 1), b: fin.b,
    eta: fin.eta, fitted: fin.mu, weights: fin.w, deviance: fin.dev, logLik, aic: fin.dev + 2 * df, bic: fin.dev + df * Math.log(n), df, dfResidual: n - df, rank: p, n,
    dispersion, aux, theta_nb: o.family === 'negbin' ? aux : undefined, phi: o.family === 'beta' ? aux : undefined, sigma2: 1,
    iterations: res.iterations, converged: res.converged && fin.converged, hat: null, pearson, devianceResiduals: null, cooks: null,
    family: o.family, link: link.id, flags, nullDeviance: NaN, reml: false
  };
}

// The β block of 2 H⁻¹ for the numerical Hessian H of the deviance in every
// outer parameter, by central differences.
function hessianCov(f, x, nTheta, p) {
  const d = x.length;
  // A step of 1e-3: the inner solve leaves noise near 1e-12 in the objective, which a
  // second difference over a step of 1e-4 magnifies into the standard errors.
  const h = Float64Array.from(x, v => 1e-3 * Math.max(1, Math.abs(v)));
  const f0 = f(x);
  const H = zeros(d, d);
  const at = (i, di, j, dj) => { const z = Float64Array.from(x); z[i] += di; if (j != null) z[j] += dj; return f(z); };
  for (let i = 0; i < d; i++) {
    H[i][i] = (at(i, h[i]) - 2 * f0 + at(i, -h[i])) / (h[i] * h[i]);
    for (let j = i + 1; j < d; j++) {
      H[i][j] = (at(i, h[i], j, h[j]) - at(i, h[i], j, -h[j]) - at(i, -h[i], j, h[j]) + at(i, -h[i], j, -h[j])) / (4 * h[i] * h[j]);
      H[j][i] = H[i][j];
    }
  }
  const L = cholesky(H);
  if (!L) return null;
  const inv = cholInverse(L);
  const out = zeros(p, p);
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) out[a][b] = 2 * inv[nTheta + a][nTheta + b];
  return out;
}

function varianceOf(y) { let m = 0; for (const v of y) m += v; m /= y.length; let s = 0; for (const v of y) s += (v - m) ** 2; return s / Math.max(1, y.length - 1); }

/**
 * Fits the linear mixed model with β and σ² profiled out, by maximum
 * likelihood or REML, as lmer does.
 * @param {Float64Array} y
 * @param {Float64Array[]} X
 * @param {ReturnType<typeof buildRandom>} random
 * @param {{ reml?: boolean }} o
 */
export function fitLmm(y, X, random, o = {}) {
  const n = y.length, p = X[0].length;
  const mask = diagonalMask(random);
  const reml = !!o.reml;
  const theta0 = new Float64Array(random.nTheta);
  let k = 0;
  for (const t of random.terms) { if (t.q === 2) { theta0[k] = 1; theta0[k + 1] = 0; theta0[k + 2] = 1; k += 3; } else theta0[k++] = 1; }
  const offsets = []; let off = 0;
  for (const bl of random.blocks) { offsets.push(off); off += bl.cols; }
  const nb = off;
  const solve = theta => {
    const rows = Array.from({ length: n }, (_, i) => zlRow(random, theta, i, random.blocks[random.blockOf[i]]));
    // Per block: M = (ZΛ)'(ZΛ) + I, C = (ZΛ)'X, g = (ZΛ)'y.
    const blocksL = [], Cs = [], gs = [];
    const RXX = zeros(p, p), rX = new Float64Array(p);
    for (let i = 0; i < n; i++) for (let a = 0; a < p; a++) { rX[a] += X[i][a] * y[i]; for (let c = 0; c < p; c++) RXX[a][c] += X[i][a] * X[i][c]; }
    let ldL2 = 0;
    random.blocks.forEach((bl, j) => {
      const c = bl.cols;
      const M = zeros(c, c), C = zeros(c, p), g = new Float64Array(c);
      for (let q = 0; q < c; q++) M[q][q] = 1;
      for (const i of bl.obs) {
        const zr = rows[i];
        for (const [ca, za] of zr) {
          g[ca] += za * y[i];
          for (let a = 0; a < p; a++) C[ca][a] += za * X[i][a];
          for (const [cb, zb] of zr) M[ca][cb] += za * zb;
        }
      }
      const L = cholesky(M, 1e-300);
      ldL2 += cholLogDet(L);
      blocksL.push(L); Cs.push(C); gs.push(g);
      // Schur complement: RXX -= C' M^{-1} C, rX -= C' M^{-1} g.
      const Mg = cholSolve(L, g);
      for (let a = 0; a < p; a++) {
        const col = Float64Array.from({ length: c }, (_, q) => C[q][a]);
        const sol = cholSolve(L, col);
        for (let b2 = 0; b2 < p; b2++) { let s = 0; for (let q = 0; q < c; q++) s += C[q][b2] * sol[q]; RXX[a][b2] -= s; }
        let s = 0; for (let q = 0; q < c; q++) s += C[q][a] * Mg[q]; rX[a] -= s;
      }
    });
    const LX = cholesky(RXX);
    if (!LX) return null;
    const beta = cholSolve(LX, rX);
    const b = new Float64Array(nb);
    random.blocks.forEach((bl, j) => {
      const c = bl.cols;
      const rhs = Float64Array.from(gs[j], (v, q) => { let s = v; for (let a = 0; a < p; a++) s -= Cs[j][q][a] * beta[a]; return s; });
      const sol = cholSolve(blocksL[j], rhs);
      for (let q = 0; q < c; q++) b[offsets[j] + q] = sol[q];
    });
    // The penalized residual sum of squares.
    let r2 = 0;
    const eta = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let a = 0; a < p; a++) e += X[i][a] * beta[a];
      const bl = random.blockOf[i];
      for (const [c, z] of rows[i]) e += z * b[offsets[bl] + c];
      eta[i] = e;
      r2 += (y[i] - e) ** 2;
    }
    for (let q = 0; q < nb; q++) r2 += b[q] * b[q];
    const ldRX2 = cholLogDet(LX);
    const dev = reml ? ldL2 + ldRX2 + (n - p) * (1 + Math.log(2 * Math.PI * r2 / (n - p))) : ldL2 + n * (1 + Math.log(2 * Math.PI * r2 / n));
    return { dev, beta, b, r2, eta, blocksL, LX, rows, ldL2 };
  };
  const objective = x => {
    const theta = Float64Array.from(x, (v, i) => (mask[i] ? Math.abs(v) : v));
    const r = solve(theta);
    return r ? r.dev : 1e300;
  };
  const nm = nelderMead(objective, theta0, { step: 0.25, ftol: 1e-12, xtol: 1e-9, restarts: 2 });
  const pol = bfgsPolish(objective, nm.x, { h: 1e-6, maxIter: 30 });
  const res = pol.f <= nm.f ? { x: pol.x, f: pol.f, iterations: nm.iterations + pol.iterations, converged: nm.converged } : nm;
  const theta = Float64Array.from(res.x, (v, i) => (mask[i] ? Math.abs(v) : v));
  const fin = solve(theta);
  const sigma2 = fin.r2 / (reml ? n - p : n);
  const V = cholInverse(fin.LX);
  const vcov = V.map(r => Float64Array.from(r, v => v * sigma2));
  const df = p + random.nTheta + 1;
  const logLik = -fin.dev / 2;
  const flags = [];
  if (!res.converged) flags.push('notConverged');
  const vc = varComp(random, theta, sigma2);
  if (vc.some(v => v.variances.some(x => x < 1e-6 * sigma2))) flags.push('singularFit');
  if (random.terms[0].kind === 'group' && random.terms[0].levels.length < 5) flags.push('fewGroups');
  const w = new Float64Array(n).fill(1);
  const pearson = Float64Array.from(y, (v, i) => (v - fin.eta[i]) / Math.sqrt(sigma2));
  return {
    mixed: true, beta: fin.beta, vcov, thetaRe: theta, varcomp: vc, ranef: ranefOf(random, theta, fin.b, offsets, fin.blocksL, sigma2), b: fin.b,
    eta: fin.eta, fitted: fin.eta, weights: w, deviance: fin.dev, logLik, aic: fin.dev + 2 * df, bic: fin.dev + df * Math.log(n), df, dfResidual: n - df, rank: p, n,
    dispersion: sigma2, aux: sigma2, sigma2, reml, iterations: res.iterations, converged: res.converged, hat: null, pearson, devianceResiduals: null, cooks: null,
    family: 'normal', link: 'identity', flags, nullDeviance: NaN
  };
}

/**
 * The Laplace deviance at given parameters, for checking a fit against
 * another program's solution.
 * @param {Float64Array} y
 * @param {Float64Array[]} X
 * @param {ReturnType<typeof buildRandom>} random
 * @param {{ family: string, link?: string|null, beta: ArrayLike<number>, theta: ArrayLike<number>, aux?: number }} o
 */
export function laplaceDeviance(y, X, random, o) {
  const link = linkOf(o.family, o.link);
  return pirls(y, X, random, o.family, link, Float64Array.from(o.beta), Float64Array.from(o.theta), o.aux == null ? 1 : o.aux, null).dev;
}

/** The inner PIRLS, exported for the tests. */
export { pirls as _pirls };
