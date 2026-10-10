// Tests for js/stats/linalg.js on small matrices worked by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cholesky, cholSolve, cholInverse, cholLogDet, crossprod, crossprodVec, matvec, matmul, transpose, independentColumns, identity, solveSpd } from '../js/stats/linalg.js';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), a + ' vs ' + b);
const M = rows => rows.map(r => Float64Array.from(r));

test('Cholesky, solve, inverse, and log determinant', () => {
  const A = M([[4, 2, 0.6], [2, 5, 1], [0.6, 1, 3]]);
  const L = cholesky(A);
  const LLt = matmul(L, transpose(L));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(LLt[i][j], A[i][j]);
  const x = cholSolve(L, [1, 2, 3]);
  const Ax = matvec(A, x);
  [1, 2, 3].forEach((b, i) => close(Ax[i], b));
  const inv = cholInverse(L);
  const I = matmul(A, inv);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(I[i][j], i === j ? 1 : 0, 1e-12);
  // det = 4*(15-1) - 2*(6-0.6) + 0.6*(2-3) = 56 - 10.8 - 0.6 = 44.6
  close(Math.exp(cholLogDet(L)), 44.6, 1e-12);
  assert.equal(cholesky(M([[1, 2], [2, 1]])), null, 'not positive definite');
  assert.throws(() => solveSpd(M([[1, 2], [2, 1]]), [1, 1]));
});

test('weighted cross products', () => {
  const X = M([[1, 2], [1, 3], [1, 5]]);
  const w = [1, 2, 0.5];
  const A = crossprod(X, w);
  close(A[0][0], 3.5); close(A[0][1], 2 + 6 + 2.5); close(A[1][1], 4 + 18 + 12.5);
  close(A[1][0], A[0][1]);
  const v = crossprodVec(X, w, [1, 1, 1]);
  close(v[0], 3.5); close(v[1], 10.5);
  const B = crossprod(X, null);
  close(B[0][0], 3);
  const I = identity(2);
  close(I[1][1], 1); close(I[0][1], 0);
});

test('independentColumns keeps the earlier of two aliased columns and drops a zero column', () => {
  const X = M([[1, 2, 3, 0, 1], [1, 3, 4, 0, 1], [1, 5, 6, 0, 0], [1, 7, 8, 0, 1]]);
  const r = independentColumns(X);
  assert.deepEqual(r.keep, [0, 1, 4]);
  assert.deepEqual(r.drop, [2, 3]);
});
