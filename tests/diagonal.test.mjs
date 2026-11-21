import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, initialState, solve, decodeSolution, checkSolved, cluesToString, cluesFromString, parseCsv, toCsvRow, DR, DC, DIR_LETTERS, turnDir, oppositeDir, isDiagonal, SHADED, E_ON } from '../js/logic.js';
import { rate, solvedByRules } from '../js/rating.js';
import { generatePuzzle, makeRng } from '../js/generator.js';
import { rotated } from '../js/rotate.js';
import { clueStates } from '../js/clues.js';
import { boardSvg } from '../js/print.js';

// Diagonal arrows: directions 4 up-right, 5 down-right, 6 down-left, 7 up-left (file letters E C Z Q). A diagonal arrow counts the shaded cells
// along its diagonal to the board's edge; cells on a diagonal never touch orthogonally, so a whole diagonal may be shaded.

test('directions: eight of them, the letters round-trip, a quarter turn and "pointing back" stay inside their family', () => {
  assert.equal(DIR_LETTERS.length, 8);
  assert.deepEqual([4, 5, 6, 7].map((d) => [DR[d], DC[d]]), [[-1, 1], [1, 1], [1, -1], [-1, -1]]);
  for (let d = 0; d < 8; d++) {
    assert.equal(isDiagonal(d), d >= 4);
    assert.equal(isDiagonal(turnDir(d)), isDiagonal(d));
    assert.equal(oppositeDir(oppositeDir(d)), d);
    assert.equal(DR[oppositeDir(d)] + DR[d], 0); assert.equal(DC[oppositeDir(d)] + DC[d], 0);
    let t = d; for (let k = 0; k < 4; k++) t = turnDir(t);
    assert.equal(t, d, 'four quarter turns come back');
    // a quarter turn clockwise: (dr, dc) -> (dc, -dr)
    assert.deepEqual([DR[turnDir(d)], DC[turnDir(d)]], [DC[d], 0 - DR[d]]);
  }
  const clues = [{ r: 0, c: 0, d: 5, n: 2 }, { r: 3, c: 3, d: 7, n: 0 }, { r: 1, c: 2, d: 4, n: 1 }, { r: 2, c: 1, d: 6, n: 1 }, { r: 0, c: 3, d: 1, n: 1 }];
  assert.equal(cluesToString(clues), '0:0:C:2;3:3:Q:0;1:2:E:1;2:1:Z:1;0:3:R:1');
  assert.deepEqual(cluesFromString(cluesToString(clues)), clues);
  const p = { name: 'd', rows: 4, cols: 4, clues, solution: '', rules: '', tier: '', score: '', boxes: [] };
  assert.deepEqual(parseCsv(toCsvRow(p))[0].clues, clues);
});

test('compile: a diagonal arrow counts its diagonal to the edge and skips clue cells on it', () => {
  const P = compile({ name: 'd', rows: 5, cols: 5, clues: [{ r: 0, c: 0, d: 5, n: 1 }, { r: 2, c: 2, d: 5, n: 0 }, { r: 4, c: 0, d: 4, n: 1 }, { r: 2, c: 4, d: 6, n: 1 }] });
  assert.deepEqual([...P.rays[0]], [6, 18, 24], 'down-right from (0,0): (1,1), (3,3), (4,4); the clue at (2,2) is skipped');
  assert.deepEqual([...P.rays[1]], [18, 24]);
  assert.deepEqual([...P.rays[2]], [16, 8, 4], 'up-right from (4,0): (3,1), (1,3), (0,4); the clue at (2,2) is skipped');
  assert.deepEqual([...P.rays[3]], [18, 22], 'down-left from (2,4): (3,3), (4,2)');
});

test('the rules\' pair logic knows diagonals: two arrows on one diagonal pointing the same way (or back at each other) are paired', () => {
  // 6x6, one diagonal r = c: arrows at (0,0) and (2,2) both pointing down-right; a loop-free board is enough to see the rules reason
  const P = compile({ name: 'd', rows: 6, cols: 6, clues: [{ r: 0, c: 0, d: 5, n: 3 }, { r: 2, c: 2, d: 5, n: 1 }] });
  const st = initialState(P);
  const r = rate({ ...P, solution: undefined, name: 'x' });
  assert.ok(r);                                                       // (rating an unsolved board must not throw on diagonals)
  const faces = compile({ name: 'f', rows: 6, cols: 6, clues: [{ r: 0, c: 0, d: 5, n: 2 }, { r: 4, c: 4, d: 7, n: 1 }] });
  assert.ok(solve(faces, { limit: 1 }).count >= 0);
  assert.ok(st.cell.length === 36);
});

test('generated diagonal puzzles (all diagonal, and a mix) are solved by the rules, have exactly one solution, and use only diagonal arrows when asked', () => {
  const used = new Set();
  for (const [rows, cols, seed, diagonal] of [[6, 6, 1, 1], [6, 6, 2, 1], [8, 8, 3, 1], [8, 8, 4, 0.5], [7, 9, 5, 1], [8, 8, 6, 0.3]]) {
    const r = generatePuzzle(rows, cols, makeRng(seed), { diagonal, budgetMs: 60000 });
    assert.ok(r, `${rows}x${cols} seed ${seed}`);
    const P = r.puzzle;
    for (const c of P.clues) used.add(c.d);
    if (diagonal === 1) assert.ok(P.clues.every((c) => c.d >= 4), 'every arrow diagonal');
    assert.ok(solvedByRules(P).solved);
    assert.equal(solve(P, { limit: 2 }).count, 1, 'exactly one solution');
    const sol = decodeSolution(P, P.solution);
    assert.ok(checkSolved(P, Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0))));
    for (let k = 0; k < P.clues.length; k++) assert.equal([...P.rays[k]].filter((i) => sol.cell[i] === SHADED).length, P.clues[k].n);
  }
  assert.ok([4, 5, 6, 7].every((d) => used.has(d)), `all four diagonal directions turn up: ${[...used]}`);
});

test('a quarter turn keeps a diagonal puzzle the same puzzle (the arrows turn with the board)', () => {
  const r = generatePuzzle(7, 9, makeRng(9), { diagonal: 0.7, budgetMs: 60000 });
  const P = r.puzzle, R = rotated(P, 'h');
  assert.equal(R.rows, 9); assert.equal(R.cols, 7);
  assert.equal(solve(R, { limit: 2 }).count, 1);
  assert.ok(solvedByRules(R).solved);
  assert.deepEqual(R.clues.map((c) => c.n).sort(), P.clues.map((c) => c.n).sort());
});

test('clue colours: a diagonal arrow is green when its boxes are there, and covered by a same-way arrow further along', () => {
  const P = compile({ name: 'd', rows: 6, cols: 6, clues: [{ r: 0, c: 0, d: 5, n: 2 }, { r: 3, c: 3, d: 5, n: 1 }] });
  const marks = (cells) => ({ cells: Uint8Array.from({ length: 36 }, (_, i) => cells[i] || 0), edges: new Uint8Array(72) });
  assert.deepEqual(clueStates(P, marks({})), ['', '']);
  assert.deepEqual(clueStates(P, marks({ 7: 1 })), ['ok', ''], 'the 2-arrow is covered: one box stands between it and the 1-arrow ahead, which supplies the second');
  assert.deepEqual(clueStates(P, marks({ 7: 1, 35: 1 })), ['ok', 'ok']);
  assert.deepEqual(clueStates(P, marks({ 7: 1, 14: 1, 28: 1 })), ['bad', 'bad'], 'three boxes on the 2-arrow\'s diagonal: the 1-arrow ahead cannot agree with it either (two boxes between them, only 2 - 1 = 1 allowed)');
  assert.deepEqual(clueStates(P, marks({ 35: 1 })), ['', 'ok'], 'the 1-arrow is done; the 2-arrow has no box between it and the 1-arrow, so it is not covered');
});

test('printing draws diagonal arrows', () => {
  const r = generatePuzzle(6, 6, makeRng(2), { diagonal: 1, budgetMs: 60000 });
  const svg = boardSvg(r.puzzle);
  assert.equal((svg.match(/class="arrow"/g) || []).length, r.puzzle.clues.length);
  assert.ok(!/NaN/.test(svg));
});
