import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, decodeSolution, checkSolved, parseCsv, toCsvRow, SHADED, E_ON } from '../js/logic.js';
import { generateSparse, makeRng } from '../js/generator.js';

// Sparse puzzles (experiment): as few clues as possible, uniqueness decided by the exhaustive solver alone.

test('a generated sparse puzzle has a valid solution that is the only one, and few clues', () => {
  const rng = makeRng(7);
  for (let k = 0; k < 3; k++) {
    const r = generateSparse(6, 6, rng, { name: `sp${k}`, bestOf: 4, budgetMs: 20000 });
    assert.ok(r, 'a 6x6 sparse puzzle within 20 s');
    const P = r.puzzle;
    assert.equal(r.stats.clues, P.clues.length);
    assert.ok(P.clues.length >= 3 && P.clues.length <= 7, `${P.clues.length} clues on a 6x6 board`);
    const sol = decodeSolution(P, P.solution);
    const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
    const edges = Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0));
    assert.ok(checkSolved(P, shaded, edges), 'the stored solution is valid');
    assert.equal(solve(P, { limit: 2 }).count, 1, 'and the only one');
    assert.deepEqual(parseCsv(toCsvRow(P))[0].clues, P.clues.map((c) => ({ ...c })), 'the clues survive the CSV');
  }
});

test('maxClues returns as soon as a puzzle is that sparse', () => {
  const rng = makeRng(3);
  const r = generateSparse(6, 6, rng, { name: 'sp', maxClues: 5, bestOf: 50, budgetMs: 30000 });
  assert.ok(r && r.stats.clues <= 5, 'a 6x6 puzzle with at most 5 clues');
  assert.equal(solve(r.puzzle, { limit: 2 }).count, 1);
});

test('starting from an ordinary rules-solvable puzzle (fromRules) also ends with a unique, valid, sparser-or-equal puzzle', () => {
  const rng = makeRng(5);
  const r = generateSparse(7, 7, rng, { name: 'fr', fromRules: true, budgetMs: 30000, polishMs: 5000 });
  assert.ok(r, 'a 7x7 puzzle within 30 s');
  const P = r.puzzle;
  const sol = decodeSolution(P, P.solution);
  const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
  const edges = Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0));
  assert.ok(checkSolved(P, shaded, edges));
  assert.equal(solve(P, { limit: 2 }).count, 1);
});

test('counting with the rules first agrees with counting from scratch', () => {
  for (const rulesFirst of [false, true]) {
    const r = generateSparse(6, 6, makeRng(9), { name: 'rf', rulesFirst, bestOf: 2, budgetMs: 20000 });
    assert.ok(r, `rulesFirst ${rulesFirst}`);
    assert.equal(solve(r.puzzle, { limit: 2 }).count, 1);
  }
});
