import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, decodeSolution, checkSolved, parseCsv, toCsvRow, SHADED, E_ON } from '../js/logic.js';
import { solvedByRules } from '../js/rating.js';
import { generateVoidsOnly, makeRng } from '../js/generator.js';

// Voids-only puzzles (experiment): no numbers, no arrows, only void cells. The shape of the board is the whole clue.

test('a generated voids-only puzzle has only voids, a valid solution, and exactly one', () => {
  const rng = makeRng(11);
  for (let k = 0; k < 3; k++) {
    const r = generateVoidsOnly(6, 6, rng, { name: `vo${k}`, budgetMs: 20000 });
    assert.ok(r, 'a 6x6 voids-only puzzle within 20 s');
    const P = r.puzzle;
    assert.ok(P.clues.length > 0 && P.clues.every((c) => c.n < 0), 'every clue is a void');
    const sol = decodeSolution(P, P.solution);
    const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
    const edges = Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0));
    assert.ok(checkSolved(P, shaded, edges), 'the stored solution is valid');
    assert.equal(solve(P, { limit: 2 }).count, 1, 'and the only one');
    assert.ok(solvedByRules(P).solved, 'the rules solve it');
    assert.deepEqual(parseCsv(toCsvRow(P))[0].clues, P.clues.map((c) => ({ ...c })), 'the voids survive the CSV');
  }
});
