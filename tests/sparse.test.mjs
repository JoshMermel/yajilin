import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, decodeSolution, checkSolved, parseCsv, toCsvRow, SHADED, E_ON } from '../js/logic.js';
import { generateSparse, makeRng } from '../js/generator.js';
import { RULES, solvedByRules, rate } from '../js/rating.js';

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

test('diagonal and mixed directions give unique, valid sparse puzzles that use those directions', () => {
  for (const [dirs, label] of [[[4, 5, 6, 7], 'diagonal'], [[0, 1, 2, 3, 4, 5, 6, 7], 'mixed']]) {
    const r = generateSparse(6, 6, makeRng(3), { name: label, directions: dirs, bestOf: 3, budgetMs: 20000 });
    assert.ok(r, `a ${label} 6x6 sparse puzzle within 20 s`);
    const P = r.puzzle;
    assert.ok(P.clues.length >= 3 && P.clues.length <= 6, `${P.clues.length} clues`);
    if (label === 'diagonal') assert.ok(P.clues.every((c) => c.d >= 4), 'every arrow is diagonal');
    const sol = decodeSolution(P, P.solution);
    const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
    const edges = Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0));
    assert.ok(checkSolved(P, shaded, edges), 'the stored solution is valid');
    assert.equal(solve(P, { limit: 2 }).count, 1, 'and the only one');
  }
});

test('with a rule limit (upto) the puzzle is solved by those rules alone, so its tier is capped and it is unique', () => {
  for (const tier of ['Medium', 'Hard']) {                                      // the first rule of this tier ends the prefix: Beginner rules, or Beginner and Medium
    const upto = RULES.findIndex((r) => r.tier === tier);
    const r = generateSparse(7, 7, makeRng(5), { name: `cap${tier}`, upto, bestOf: 2, budgetMs: 40000, polishMs: 3000 });
    assert.ok(r, `a ${tier}-capped 7x7 sparse puzzle within 40 s`);
    const P = r.puzzle;
    assert.ok(solvedByRules(P, upto).solved, 'the allowed rules alone solve it');
    const tiers = tier === 'Medium' ? ['Beginner'] : ['Beginner', 'Medium'];
    assert.ok(tiers.includes(rate(P).tier), `its rated tier is ${tiers.join(' or ')}, got ${rate(P).tier}`);
    assert.equal(solve(P, { limit: 2 }).count, 1, 'and the exhaustive solver agrees it is the only solution');
  }
});
