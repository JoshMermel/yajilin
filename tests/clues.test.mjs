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
