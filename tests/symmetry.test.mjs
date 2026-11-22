import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLayout } from '../js/generator_layouts.js';
import { symmetryOf, orbitOf, SYMMETRY_MODES } from '../js/generator_symmetry.js';
import { makeRng } from '../js/generator.js';
import fs from 'node:fs';
import { solve, decodeSolution, parseCsv, compile, E_ON } from '../js/logic.js';
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

// symmetric LAYOUT: every clue cell has an image that is a clue cell; arrows, numbers, boxes and the loop are free
for (const mode of SYMMETRY_MODES) {
  test(`layout-${mode}: the clue cells are symmetric (and the puzzle is not forced to be more), and it has exactly one solution`, () => {
    let made = 0, notExact = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const res = generateLayout(8, 8, makeRng(seed), { mode: `layout-${mode}`, budgetMs: 20000 });
      if (!res) continue;
      made++;
      const P = res.puzzle, s = symmetryOf(mode, 8, 8), at = new Map(P.clues.map((c) => [c.r * 8 + c.c, c]));
      let exact = true;
      for (const [i, c] of at) {
        const o = at.get(s.map[i]);
        assert.ok(o, `${mode}: clue at ${i} has no image`);
        if (o.n !== c.n || o.d !== s.dir(c.d)) exact = false;
      }
      if (!exact) notExact++;
      assert.equal(solvedByRules(P).solved, true);
      assert.equal(solve(P, { limit: 2 }).count, 1);
    }
    assert.ok(made >= 3, `made ${made} of 4`);
    assert.ok(notExact >= 1, 'arrows and numbers are free, so some puzzle is not exactly symmetric');
  });
}

// the shipped books: every puzzle of a Symmetry mix is exactly symmetric under one of the four symmetries; every puzzle of a Symmetric layout book has symmetric clue cells
const bookOf = (id) => parseCsv(fs.readFileSync(new URL(`../data/${id}.csv`, import.meta.url), 'utf8')).map(compile);
const clueMap = (P) => new Map(P.clues.map((c) => [c.r * P.cols + c.c, c]));
const cluesSymmetric = (P, s) => { const at = clueMap(P); return [...at.keys()].every((i) => at.has(s.map[i])); };
const exactlySymmetric = (P, s) => { const at = clueMap(P); return [...at].every(([i, c]) => { const o = at.get(s.map[i]); return o && (c.n < 0 ? o.n < 0 : o.n === c.n && o.d === s.dir(c.d)); }); };

test('the Symmetry mix books hold only exactly symmetric puzzles, and all four symmetries turn up in each', () => {
  for (const size of ['8x8', '12x12']) {
    const ps = bookOf(`bonus-symmetry-mix-${size}`), seen = new Set();
    assert.ok(ps.length >= 50);
    for (const P of ps) {
      const which = SYMMETRY_MODES.filter((m) => exactlySymmetric(P, symmetryOf(m, P.rows, P.cols)));
      assert.ok(which.length, `${P.name} is not symmetric`);
      which.forEach((m) => seen.add(m));
    }
    assert.equal(seen.size, 4, `${size}: ${[...seen]}`);
  }
});

test('the Symmetric layout books hold only puzzles whose clue cells are symmetric, and all four symmetries turn up in each', () => {
  for (const size of ['8x8', '12x12']) {
    const ps = bookOf(`bonus-symmetric-layout-${size}`), seen = new Set();
    assert.ok(ps.length >= 100);
    for (const P of ps) {
      const which = SYMMETRY_MODES.filter((m) => cluesSymmetric(P, symmetryOf(m, P.rows, P.cols)));
      assert.ok(which.length, `${P.name} has no symmetric clue cells`);
      which.forEach((m) => seen.add(m));
    }
    assert.equal(seen.size, 4, `${size}: ${[...seen]}`);
  }
});
