import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../js/logic.js';
import { clueStates } from '../js/clues.js';

// one row, 6 cells: a clue at column 0 pointing right with n boxes
const P = (n) => compile({ name: 't', rows: 1, cols: 6, clues: [{ r: 0, c: 0, d: 1, n }] });
const marks = (P, cells, edges = []) => { const e = new Uint8Array(P.numEdges); for (const x of edges) e[x] = 1; return { cells: Uint8Array.from(cells), edges: e }; };

test('a clue is bad when too many boxes, or when everything it points at is filled in and there are too few', () => {
  const p = P(2);
  assert.deepEqual(clueStates(p, marks(p, [0, 0, 0, 0, 0, 0])), ['']);          // nothing decided
  assert.deepEqual(clueStates(p, marks(p, [0, 1, 0, 1, 0, 0])), ['ok']);        // two boxes
  assert.deepEqual(clueStates(p, marks(p, [0, 1, 0, 1, 0, 1])), ['bad']);       // three boxes
  assert.deepEqual(clueStates(p, marks(p, [0, 1, 2, 2, 2, 2])), ['bad']);       // one box and every other cell is a dot
  assert.deepEqual(clueStates(p, marks(p, [0, 1, 2, 2, 2, 0])), ['']);          // one cell still open
  // a cell a segment passes through counts as filled in (it cannot be a box)
  assert.deepEqual(clueStates(p, marks(p, [0, 1, 2, 0, 2, 2], [2 * 2, 2 * 3])), ['bad']);   // segments 2-3, 3-4 fill cell 3
});

test('a 0 clue is ok from the start, and a blocked clue says nothing', () => {
  const p = P(0);
  assert.deepEqual(clueStates(p, marks(p, [0, 0, 0, 0, 0, 0])), ['ok']);
  assert.deepEqual(clueStates(p, marks(p, [0, 0, 1, 0, 0, 0])), ['bad']);
});

// ---- an arrow another arrow already covers (option { covered: true })
// A K-arrow with a (K - X)-arrow further along its line pointing the same way: once X boxes stand between them, the K-arrow's
// count is guaranteed by the other arrow, so it has nothing more to say and turns green (state 'ok').
// one row of 9 cells: arrow A at column 0 (right, n = 3), arrow B at column 4 (right, n = 1); cells 1-3 lie between them
const AB = (a = 3, b = 1, bd = 1) => compile({ name: 't', rows: 1, cols: 9, clues: [{ r: 0, c: 0, d: 1, n: a }, { r: 0, c: 4, d: bd, n: b }] });
const cov = { covered: true };
const row = (p, boxes, dots = []) => marks(p, Array.from({ length: 9 }, (_, i) => (boxes.includes(i) ? 1 : dots.includes(i) ? 2 : 0)));

test('covered: the K-arrow goes green when K - n boxes stand between it and the same-way arrow of n', () => {
  const p = AB();
  const m = row(p, [1, 3]);                                          // 2 boxes between, and 3 - 1 = 2
  assert.deepEqual(clueStates(p, m), ['', ''], 'off by default: only its own count turns an arrow green');
  assert.deepEqual(clueStates(p, m, cov), ['ok', '']);               // the 1-arrow itself still has to see its box
  assert.deepEqual(clueStates(p, row(p, [1]), cov), ['', ''], 'one box between is not yet enough');
  assert.deepEqual(clueStates(p, row(p, []), cov), ['', '']);
});

test('covered: the same number is covered from the start (0 boxes between), as a 0-arrow is green from the start', () => {
  const p = AB(2, 2);
  assert.deepEqual(clueStates(p, row(p, []), cov), ['ok', '']);
  assert.deepEqual(clueStates(p, row(p, []), { covered: false }), ['', '']);
});

test('covered: the arrow must point the same way, and the other one must be the smaller', () => {
  assert.deepEqual(clueStates(AB(3, 1, 3), row(AB(3, 1, 3), [1, 3]), cov)[0], '', 'B points the other way');
  const q = AB(2, 3);                                                // A says 2, B says 3: B cannot cover A (one box between, A still needs more)
  assert.equal(clueStates(q, row(q, [1]), cov)[0], '');
});

test('covered: a red arrow stays red, and an arrow with a wrong count between is not covered', () => {
  const p = AB(3, 1);
  assert.equal(clueStates(p, row(p, [1, 3, 5, 7]), cov)[0], 'bad', 'too many boxes in its whole line');
  assert.equal(clueStates(p, row(p, [1, 6]), cov)[0], '', 'one box between and one beyond: 1 is not 3 - 1, so no cover (and its own count is not met)');
  assert.equal(clueStates(p, row(p, [1, 3, 6]), cov)[0], 'ok', 'two between and the third beyond: it is ok by its own count too');
});

test('covered: arrows pointing other ways in between are skipped, and any same-way arrow further on can cover', () => {
  // A (right, 4) at column 0, a down-arrow at column 2 (a clue cell, not counted), B (right, 2) at column 6; between: cells 1, 3, 4, 5
  const p = compile({ name: 't', rows: 2, cols: 9, clues: [{ r: 0, c: 0, d: 1, n: 4 }, { r: 0, c: 2, d: 2, n: 0 }, { r: 0, c: 6, d: 1, n: 2 }] });
  const m = marks(p, Array.from({ length: 18 }, (_, i) => ([1, 4].includes(i) ? 1 : 0)));        // boxes at columns 1 and 4: 2 between = 4 - 2
  assert.equal(clueStates(p, m, cov)[0], 'ok');
});
