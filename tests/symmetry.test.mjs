import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout } from '../js/generator_layouts.js';
import { symmetryOf, orbitOf, SYMMETRY_MODES } from '../js/generator_symmetry.js';
import { makeRng } from '../js/generator.js';
import { solve, decodeSolution, E_ON } from '../js/logic.js';
import { solvedByRules } from '../js/rating.js';

test('symmetries: each is an involution (a quarter turn has order four) and each arrow direction comes back after a full orbit', () => {
  for (const [name, rows, cols] of [['mirror', 6, 8], ['mirror', 7, 7], ['transpose', 7, 7], ['rot90', 8, 8], ['rot180', 6, 8]]) {
    const s = symmetryOf(name, rows, cols);
    for (let i = 0; i < rows * cols; i++) {
      let j = i; for (let k = 0; k < s.order; k++) j = s.map[j];
      assert.equal(j, i, `${name}: ${s.order} steps return`);
      for (let d = 0; d < 4; d++) {
        const orbit = orbitOf(s, i, d);
        let v = orbit[orbit.length - 1].dir; v = s.dir(v);
        if (orbit.length * 1 === s.order) assert.equal(v, d, `${name}: direction ${d} returns`);   // (a fixed cell may not: arrowOK refuses those)
      }
    }
  }
  assert.throws(() => symmetryOf('transpose', 6, 8), /square/);
});

// a symmetric puzzle: every clue has an image with the image direction and the same number, voids go to voids, and the loop of the solution is its own image
function assertSymmetric(P, mode) {
  const s = symmetryOf(mode, P.rows, P.cols), at = new Map(P.clues.map((c) => [c.r * P.cols + c.c, c]));
  for (const [i, c] of at) {
    const o = at.get(s.map[i]);
    assert.ok(o, `${mode}: clue at ${i} has no image`);
    if (c.n < 0) assert.ok(o.n < 0); else { assert.equal(o.d, s.dir(c.d)); assert.equal(o.n, c.n); }
  }
  const sol = decodeSolution(P, P.solution), N = P.rows * P.cols;
  const edge = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return sol.e[hi === lo + 1 ? 2 * lo : 2 * lo + 1] === E_ON; };
  for (let i = 0; i < N; i++) for (const j of [i + 1, i + P.cols]) {
    if (j >= N || (j === i + 1 && j % P.cols === 0)) continue;
    assert.equal(edge(i, j), edge(s.map[i], s.map[j]), `${mode}: the loop is not its own image at ${i}-${j}`);
  }
}

for (const mode of SYMMETRY_MODES) {
  test(`${mode}: the whole puzzle, numbers and loop included, is symmetric, and it has exactly one solution`, () => {
    let made = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const res = generateLayout(8, 8, makeRng(seed), { mode, budgetMs: 20000 });
      if (!res) continue;
      made++;
      assertSymmetric(res.puzzle, mode);
      assert.equal(solvedByRules(res.puzzle).solved, true);
      assert.equal(solve(res.puzzle, { limit: 2 }).count, 1);
    }
    assert.ok(made >= 3, `made ${made} of 4`);
  });
}

test('mirror: an odd board puts the clue column on the axis, and no arrow there points sideways', () => {
  const res = generateLayout(9, 9, makeRng(2), { mode: 'mirror', budgetMs: 20000 });
  assert.ok(res);
  for (const c of res.puzzle.clues) if (c.c === 4 && c.n >= 0) assert.ok(c.d === 0 || c.d === 2, 'on the axis an arrow points up or down');
});

test('transpose: no arrow on the diagonal', () => {
  const res = generateLayout(8, 8, makeRng(2), { mode: 'transpose', budgetMs: 20000 });
  assert.ok(res);
  for (const c of res.puzzle.clues) if (c.r === c.c) assert.ok(c.n < 0, 'a diagonal clue is a void');
});
