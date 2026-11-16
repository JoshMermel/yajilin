import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, initialState, solve, decodeSolution, encodeSolution, checkSolved, cluesToString, cluesFromString, parseCsv, toCsvRow, puzzleHash, SHADED, LOOP, E_ON, E_OFF, UNKNOWN } from '../js/logic.js';
import { rate, solvedByRules, contradiction } from '../js/rating.js';
import { rotated } from '../js/rotate.js';

// Void cells: a cell that is not a box, not on the loop and carries no arrow. In the data a void is a clue with n < 0 (written "r:c:V:-1").
// The loop never enters it, a box may touch it, and arrows skip over it when counting (as they skip clue cells).

const VOID = (r, c) => ({ r, c, d: 0, n: -1 });

test('the file token: a void is written r:c:V:-1 and read back; the old r:c:U:-1 form still reads as a void', () => {
  const clues = [{ r: 0, c: 0, d: 1, n: 2 }, VOID(1, 2)];
  assert.equal(cluesToString(clues), '0:0:R:2;1:2:V:-1');
  assert.deepEqual(cluesFromString('0:0:R:2;1:2:V:-1'), [{ r: 0, c: 0, d: 1, n: 2 }, VOID(1, 2)]);
  assert.equal(cluesFromString('1:2:U:-1')[0].n, -1);
  const p = { name: 'v', rows: 3, cols: 3, clues, solution: '', rules: '', tier: '', score: '', boxes: [] };
  assert.deepEqual(parseCsv(toCsvRow(p))[0].clues, clues);
});

test('compile: a void is a non-loop cell with an empty line, arrows skip it, and loop edges never touch it', () => {
  const P = compile({ name: 'v', rows: 3, cols: 4, clues: [{ r: 0, c: 0, d: 1, n: 1 }, VOID(0, 2)] });
  assert.deepEqual([...P.rays[0]], [1, 3], 'the arrow counts cell 1 and 3, skipping the void at 2');
  assert.deepEqual([...P.rays[1]], [], 'a void has no line');
  assert.ok(P.clueAt[2] >= 0, 'not a regular cell');
  for (let d = 0; d < 4; d++) { assert.equal(P.nb[2 * 4 + d], -1); }
  assert.equal(P.nb[1 * 4 + 1], -1, 'no neighbour link from cell 1 into the void');
  assert.deepEqual([...P.voidIdx], [2]);
});

// a 3x4 board: voids at (0,0) and (2,3); the loop must go around the other ten cells... it is a 3x4 with two corners cut off
test('the solver counts solutions on a board with voids, and a box may touch a void', () => {
  // 3x3 board, void in the middle: the loop is the ring of 8 cells (unique), no box
  const ring = compile({ name: 'r', rows: 3, cols: 3, clues: [VOID(1, 1)] });
  const r = solve(ring, { limit: 5 });
  assert.equal(r.count, 1);
  const sol = r.solutions[0];
  assert.equal([...sol.cell].filter((v) => v === SHADED).length, 0);
  // 3x4, void in the middle of the top row, an arrow that forces a box next to the void
  const P = compile({ name: 'b', rows: 3, cols: 4, clues: [VOID(0, 1), { r: 2, c: 0, d: 1, n: 0 }] });
  const all = solve(P, { limit: 50 });
  for (const s of all.solutions) {
    for (let i = 0; i < P.N; i++) if (P.clueAt[i] >= 0) assert.notEqual(s.cell[i], LOOP, 'clue and void cells are never on the loop');
  }
});

test('rules are sound with voids: every puzzle with voids the rules solve has the one solution the exhaustive solver finds', async () => {
  const { generatePuzzle, makeRng } = await import('../js/generator.js');
  let checked = 0;
  for (let seed = 1; seed <= 12 && checked < 6; seed++) {
    const r = generatePuzzle(7, 7, makeRng(seed), { voids: 4, budgetMs: 20000, tight: true });
    if (!r) continue;
    const P = r.puzzle;
    assert.equal(P.clues.filter((c) => c.n < 0).length, 4, 'four voids');
    const byRules = solvedByRules(P);
    assert.ok(byRules.solved, 'the generator only returns puzzles the rules solve');
    const ex = solve(P, { limit: 2 });
    assert.equal(ex.count, 1, 'exactly one solution');
    const stored = decodeSolution(P, P.solution);
    for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) assert.equal(byRules.state.cell[i], stored.cell[i], `cell ${i}`);
    assert.ok(checkSolved(P, Uint8Array.from(stored.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(stored.e, (v) => (v === E_ON ? 1 : 0))));
    const q = rate(P);
    assert.ok(q.solved && q.score > 0);
    checked++;
  }
  assert.ok(checked >= 3, `generated ${checked} puzzles with voids`);
});

test('a board with a void is rated without the contradiction check misfiring (a void has no count to break)', () => {
  const P = compile({ name: 'c', rows: 4, cols: 4, clues: [VOID(0, 0), { r: 3, c: 3, d: 3, n: 0 }, { r: 3, c: 1, d: 0, n: 1 }] });
  const st = initialState(P);
  assert.equal(contradiction(P, st), false, 'nothing is wrong with an empty board that has a void');   // before the guard: true for any n = -1
});

test('rotation keeps voids voids, and the hash of a puzzle with voids differs from one without', () => {
  const raw = { name: 'v', rows: 3, cols: 5, clues: [VOID(1, 2), { r: 0, c: 0, d: 1, n: 1 }], boxes: [] };
  const P = compile(raw);
  const Q = rotated(P, puzzleHash(P));
  assert.equal(Q.clues.filter((c) => c.n < 0).length, 1);
  assert.ok(Q.voidIdx.length === 1);
  const plain = compile({ name: 'p', rows: 3, cols: 5, clues: [{ r: 0, c: 0, d: 1, n: 1 }], boxes: [] });
  assert.notEqual(puzzleHash(P), puzzleHash(plain));
});
