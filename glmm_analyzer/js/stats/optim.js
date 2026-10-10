// Nelder–Mead minimization for the mixed models' outer search over the
// variance parameters (and the fixed effects, for a generalized model), in
// one to about fifteen dimensions. Restarted from the best point until the
// simplex collapses, so that the optimum is found to the digits the pages
// compare against R. Pure functions, no DOM.

/**
 * Minimizes f from x0.
 * @param {(x: Float64Array) => number} f
 * @param {ArrayLike<number>} x0
 * @param {{ step?: number|ArrayLike<number>, maxIter?: number, ftol?: number, xtol?: number, restarts?: number }} [o]
 * @returns {{ x: Float64Array, f: number, iterations: number, converged: boolean }}
 */
export function nelderMead(f, x0, o = {}) {
  const n = x0.length;
  const maxIter = o.maxIter || 4000 * Math.max(1, n);
  const ftol = o.ftol || 1e-12, xtol = o.xtol || 1e-9;
  const restarts = o.restarts == null ? 3 : o.restarts;
  let best = { x: Float64Array.from(x0), f: f(Float64Array.from(x0)) };
  let total = 0, converged = false;
  let step = Float64Array.from({ length: n }, (_, i) => (typeof o.step === 'number' ? o.step : o.step ? o.step[i] : 0.1));
  for (let r = 0; r <= restarts; r++) {
    const res = run(f, best.x, step, maxIter, ftol, xtol);
    total += res.iterations;
    const moved = Math.abs(res.f - best.f) > ftol * (Math.abs(best.f) + 1e-12) || res.x.some((v, i) => Math.abs(v - best.x[i]) > xtol);
    if (res.f <= best.f) best = { x: res.x, f: res.f };
    converged = res.converged;
    if (!moved && res.converged) break;
    step = Float64Array.from(step, s => s / 4);
  }
  return { x: best.x, f: best.f, iterations: total, converged };
}

function run(f, x0, step, maxIter, ftol, xtol) {
  const n = x0.length;
  const simplex = [Float64Array.from(x0)];
  for (let i = 0; i < n; i++) { const v = Float64Array.from(x0); v[i] += step[i] || 0.1; simplex.push(v); }
  const fv = simplex.map(v => f(v));
  const order = () => { const idx = fv.map((_, i) => i).sort((a, b) => fv[a] - fv[b]); const s2 = idx.map(i => simplex[i]), f2 = idx.map(i => fv[i]); for (let i = 0; i <= n; i++) { simplex[i] = s2[i]; fv[i] = f2[i]; } };
  let it = 0, converged = false;
  const centroid = new Float64Array(n);
  while (it < maxIter) {
    it++;
    order();
    // Convergence: the function values and the simplex both small.
    const frange = Math.abs(fv[n] - fv[0]);
    let size = 0;
    for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) size = Math.max(size, Math.abs(simplex[i][j] - simplex[0][j]));
    if (frange <= ftol * (Math.abs(fv[0]) + 1e-12) && size <= xtol) { converged = true; break; }
    centroid.fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const xr = Float64Array.from(centroid, (c, j) => c + (c - worst[j]));
    const fr = f(xr);
    if (fr < fv[0]) {
      const xe = Float64Array.from(centroid, (c, j) => c + 2 * (c - worst[j]));
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; fv[n] = fe; } else { simplex[n] = xr; fv[n] = fr; }
    } else if (fr < fv[n - 1]) {
      simplex[n] = xr; fv[n] = fr;
    } else {
      const outside = fr < fv[n];
      const xc = Float64Array.from(centroid, (c, j) => c + 0.5 * ((outside ? xr[j] : worst[j]) - c));
      const fc = f(xc);
      if (fc < (outside ? fr : fv[n])) { simplex[n] = xc; fv[n] = fc; }
      else {
        // Shrink toward the best point.
        for (let i = 1; i <= n; i++) { simplex[i] = Float64Array.from(simplex[0], (b, j) => b + 0.5 * (simplex[i][j] - b)); fv[i] = f(simplex[i]); }
      }
    }
  }
  order();
  return { x: simplex[0], f: fv[0], iterations: it, converged };
}

/**
 * A BFGS polish from a point near the minimum, with central-difference
 * gradients and a backtracking line search, for the last digits a simplex
 * search leaves behind. Stops when a step moves the function by less than
 * `ftol` relative or the gradient is below `gtol`.
 * @param {(x: Float64Array) => number} f
 * @param {ArrayLike<number>} x0
 * @param {{ h?: number, maxIter?: number, ftol?: number, gtol?: number }} [o]
 * @returns {{ x: Float64Array, f: number, iterations: number }}
 */
export function bfgsPolish(f, x0, o = {}) {
  const n = x0.length;
  const h = o.h || 1e-5, maxIter = o.maxIter || 40, ftol = o.ftol || 1e-12, gtol = o.gtol || 1e-7;
  let x = Float64Array.from(x0), fx = f(x);
  const grad = xv => {
    const g = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const d = h * Math.max(1, Math.abs(xv[i]));
      const xp = Float64Array.from(xv), xm = Float64Array.from(xv);
      xp[i] += d; xm[i] -= d;
      g[i] = (f(xp) - f(xm)) / (2 * d);
    }
    return g;
  };
  let g = grad(x);
  // The inverse Hessian estimate, started at the identity.
  const H = Array.from({ length: n }, (_, i) => Float64Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let it = 0;
  for (it = 1; it <= maxIter; it++) {
    let gn = 0;
    for (let i = 0; i < n; i++) gn = Math.max(gn, Math.abs(g[i]));
    if (gn < gtol) break;
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s2 = 0; for (let j = 0; j < n; j++) s2 += H[i][j] * g[j]; d[i] = -s2; }
    let slope = 0;
    for (let i = 0; i < n; i++) slope += d[i] * g[i];
    if (slope >= 0) { for (let i = 0; i < n; i++) d[i] = -g[i]; slope = -gn * gn; }
    let t = 1, xn = null, fn = Infinity;
    for (let k = 0; k < 30; k++) {
      xn = Float64Array.from(x, (v, i) => v + t * d[i]);
      fn = f(xn);
      if (Number.isFinite(fn) && fn <= fx + 1e-4 * t * slope) break;
      t /= 2;
    }
    if (!(fn < fx)) break;
    const gnew = grad(xn);
    const sVec = Float64Array.from(xn, (v, i) => v - x[i]), yVec = Float64Array.from(gnew, (v, i) => v - g[i]);
    let sy = 0;
    for (let i = 0; i < n; i++) sy += sVec[i] * yVec[i];
    const improved = Math.abs(fx - fn) > ftol * (Math.abs(fn) + 1e-12);
    x = xn; fx = fn; g = gnew;
    if (sy > 1e-12) {
      // The BFGS update of the inverse Hessian.
      const Hy = new Float64Array(n);
      for (let i = 0; i < n; i++) { let s2 = 0; for (let j = 0; j < n; j++) s2 += H[i][j] * yVec[j]; Hy[i] = s2; }
      let yHy = 0;
      for (let i = 0; i < n; i++) yHy += yVec[i] * Hy[i];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        H[i][j] += ((sy + yHy) * sVec[i] * sVec[j]) / (sy * sy) - (Hy[i] * sVec[j] + sVec[i] * Hy[j]) / sy;
      }
    }
    if (!improved) break;
  }
  return { x, f: fx, iterations: it };
}
