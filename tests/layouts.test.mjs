import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { generateLayout } from '../js/generator_layouts.js';
import { makeRng } from '../js/generator.js';
import { parseCsv, compile, solve } from '../js/logic.js';
import { solvedByRules } from '../js/rating.js';

// the arrows, as "cell:direction:number" (a void has direction 0 and number -1)
const arrowSet = (P) => new Map(P.clues.map((c) => [c.r * P.cols + c.c, c]));

function assertHalfTurnSymmetric(P) {
  const at = arrowSet(P), N = P.rows * P.cols;
  for (const [i, c] of at) {
    const twin = at.get(N - 1 - i);
    assert.ok(twin, `cell ${i} has an arrow but ${N - 1 - i} does not`);
    assert.equal(twin.n < 0, c.n < 0);
    if (c.n >= 0) assert.equal(twin.d, (c.d + 2) % 4, 'the twin points the opposite way');
  }
}

test('symmetric layout: arrows are the same after a half turn (twins point opposite ways), and the puzzle has exactly one solution', () => {
  let made = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const res = generateLayout(8, 8, makeRng(seed), { mode: 'symmetric', budgetMs: 20000 });
    if (!res) continue;
    made++;
    assertHalfTurnSymmetric(res.puzzle);
    assert.equal(solvedByRules(res.puzzle).solved, true);
    assert.equal(solve(res.puzzle, { limit: 2 }).count, 1);
  }
  assert.ok(made >= 3, `made ${made} of 4`);
});

test('symmetric layout: a half turn needs an even number of rows plus columns', () => {
  assert.throws(() => generateLayout(7, 8, makeRng(1), { mode: 'symmetric' }), /even/);
});

test('frame layout: every border cell is an arrow pointing inward or a void, the inside has no arrows, and there is exactly one solution', () => {
  let made = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const res = generateLayout(8, 8, makeRng(seed), { mode: 'frame', budgetMs: 20000 });
    if (!res) continue;
    made++;
    const P = res.puzzle, at = arrowSet(P);
    for (let i = 0; i < P.N; i++) {
      const r = (i / P.cols) | 0, c = i % P.cols, onBorder = r === 0 || c === 0 || r === P.rows - 1 || c === P.cols - 1;
      const cl = at.get(i);
      if (!onBorder) { assert.ok(!cl || cl.n < 0, `cell ${i} inside has an arrow`); continue; }
      assert.ok(cl, `border cell ${i} is empty`);
      if (cl.n < 0) continue;
      const inwards = [r === 0 ? 2 : -1, r === P.rows - 1 ? 0 : -1, c === 0 ? 1 : -1, c === P.cols - 1 ? 3 : -1];
      assert.ok(inwards.includes(cl.d), `border arrow at ${i} does not point inward`);
    }
    assert.equal(solve(P, { limit: 2 }).count, 1);
  }
  assert.ok(made >= 3, `made ${made} of 4`);
});

test('the symmetric bonus books hold only half-turn symmetric puzzles', () => {
  for (const size of ['8x8', '12x12']) {
    const ps = parseCsv(fs.readFileSync(new URL(`../data/bonus-symmetric-${size}.csv`, import.meta.url), 'utf8'));
    assert.ok(ps.length >= 30);
    for (const raw of ps.slice(0, 30)) assertHalfTurnSymmetric(compile(raw));
  }
});
