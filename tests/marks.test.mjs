import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMark, EMPTY, BOX, DOT, reconcile, applyAutoDots } from '../js/marks.js';
import { compile } from '../js/logic.js';

test('an unlined cell cycles empty -> dot -> box -> empty', () => {
  assert.equal(nextMark(EMPTY, false), DOT);
  assert.equal(nextMark(DOT, false), BOX);
  assert.equal(nextMark(BOX, false), EMPTY);
});

test('a lined cell skips the dot, whether or not a dot was there before the line', () => {
  assert.equal(nextMark(EMPTY, true), BOX);
  assert.equal(nextMark(DOT, true), BOX);
});

// ---- the automatic-dots switch (applyAutoDots)
// 5x5, an arrow at A1 pointing right and saying 1; a box at D1 satisfies it. D1's neighbours (C1, E1, D2) and the rest of the arrow's
// line (B1, C1, E1) then have reasons to be dots.
const puzzle = () => compile({ name: 't', rows: 5, cols: 5, clues: [{ r: 0, c: 0, d: 1, n: 1 }], boxes: [{ r: 3, c: 3 }] });
const blank = (P) => { const m = { cells: new Uint8Array(P.N), edges: new Uint8Array(P.numEdges), auto: new Uint8Array(P.N) }; for (const i of P.boxIdx) m.cells[i] = BOX; return m; };
const cell = (r, c) => r * 5 + c;
const dotsOf = (m) => [...m.cells].map((v, i) => (v === DOT ? i : -1)).filter((i) => i >= 0);

test('switching automatic dots ON fills in dots for what is already on the board, marked as automatic', () => {
  const P = puzzle(), m = blank(P);
  m.cells[cell(0, 3)] = BOX;                                          // satisfies the arrow
  const changed = applyAutoDots(P, m, true);
  const expected = [cell(0, 1), cell(0, 2), cell(0, 4), cell(1, 3),   // the arrow's line and D1's neighbours
    cell(2, 3), cell(4, 3), cell(3, 2), cell(3, 4)].sort((a, b) => a - b);   // the pre-placed box at D4 has neighbours too
  assert.deepEqual(dotsOf(m), expected);
  assert.equal(changed, expected.length);
  for (const i of expected) assert.equal(m.auto[i], 1, 'automatic');
  assert.equal(m.cells[cell(0, 3)], BOX);
});

test('switching automatic dots OFF removes the automatic dots and keeps the ones the player placed', () => {
  const P = puzzle(), m = blank(P);
  m.cells[cell(0, 3)] = BOX;
  m.cells[cell(4, 0)] = DOT;                                          // the player's own dot (auto 0), far from any reason
  m.cells[cell(0, 1)] = DOT;                                          // the player's own dot on a cell that also has a reason
  applyAutoDots(P, m, true);
  assert.equal(m.auto[cell(0, 1)], 0, 'a dot the player placed is never taken over');
  const changed = applyAutoDots(P, m, false);
  assert.deepEqual(dotsOf(m), [cell(0, 1), cell(4, 0)].sort((a, b) => a - b));
  assert.ok(changed > 0);
  assert.equal(m.cells[cell(0, 3)], BOX, 'boxes are never touched');
  assert.equal(m.cells[cell(3, 3)], BOX);
  assert.ok(m.auto.every((v) => v === 0));
});

test('on then off gives back the board you started with (when you had no dots of your own)', () => {
  const P = puzzle(), m = blank(P);
  m.cells[cell(0, 3)] = BOX;
  const start = { cells: Uint8Array.from(m.cells), auto: Uint8Array.from(m.auto) };
  applyAutoDots(P, m, true);
  applyAutoDots(P, m, false);
  assert.deepEqual([...m.cells], [...start.cells]);
  assert.deepEqual([...m.auto], [...start.auto]);
});

test('switching ON again changes nothing more, and nothing happens when there is nothing to do', () => {
  const P = puzzle(), m = blank(P);
  m.cells[cell(0, 3)] = BOX;
  applyAutoDots(P, m, true);
  assert.equal(applyAutoDots(P, m, true), 0);
  const empty = blank(compile({ name: 'e', rows: 3, cols: 3, clues: [] }));
  assert.equal(applyAutoDots(compile({ name: 'e', rows: 3, cols: 3, clues: [] }), empty, false), 0);
});

test('a cell that is not blank keeps what it has, and a clue cell never gets a dot', () => {
  const P = puzzle(), m = blank(P);
  m.cells[cell(0, 3)] = BOX;
  m.cells[cell(0, 4)] = BOX;                                          // (a wrong box: next to the first; the dots logic does not judge)
  applyAutoDots(P, m, true);
  assert.equal(m.cells[cell(0, 4)], BOX);
  assert.equal(m.cells[cell(0, 0)], EMPTY, 'the clue cell');
});

test('reconcile with the switch off still lets automatic dots go when their reasons do, but places none', () => {
  const P = puzzle(), m = blank(P);
  m.cells[cell(0, 3)] = BOX;
  applyAutoDots(P, m, true);
  const prev = { cells: Uint8Array.from(m.cells), auto: Uint8Array.from(m.auto), edges: m.edges };
  m.cells[cell(0, 3)] = EMPTY;                                        // the box comes off
  reconcile(P, prev, m, false);
  assert.ok(!dotsOf(m).includes(cell(0, 2)), 'its dots go');
  m.cells[cell(2, 2)] = BOX;                                          // a new box while the switch is off: no new dots
  const before = dotsOf(m).length;
  reconcile(P, { cells: Uint8Array.from(m.cells.map((v, i) => (i === cell(2, 2) ? 0 : v))), auto: m.auto, edges: m.edges }, m, false);
  assert.equal(dotsOf(m).length, before);
});
