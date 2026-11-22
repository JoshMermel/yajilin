import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, solve, encodeSolution, decodeSolution, puzzleHash, checkSolved, parseCsv } from '../js/logic.js';
import { cellMap, edgeMap, rotated, turnMarks, realEdges } from '../js/rotate.js';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

test('rotating a puzzle gives a puzzle with the rotated solution, the same identity, and the same loop', () => {
  const raw = parseCsv(fs.readFileSync(`${root}data/bonus-intro.csv`, 'utf8')).concat(parseCsv(fs.readFileSync(`${root}data/bonus-skyscraper-8x36.csv`, 'utf8')).slice(0, 3));
  for (const p of raw) {
    const P = compile(p), Q = rotated(P, puzzleHash(P));
    assert.equal(Q.rows, P.cols); assert.equal(Q.cols, P.rows);
    assert.equal(puzzleHash(Q), puzzleHash(P));
    // the stored solution rotated is a valid solution of the rotated puzzle...
    const st = decodeSolution(Q, Q.solution);
    const shaded = Uint8Array.from(st.cell, (v) => (v === 1 ? 1 : 0));
    const sol = decodeSolution(P, P.solution);
    const cm = cellMap(P.rows, P.cols), em = edgeMap(P.rows, P.cols);
    for (let i = 0; i < P.N; i++) assert.equal(st.cell[cm[i]], sol.cell[i]);
    for (let x = 0; x < P.numEdges; x++) { const j = em[x]; if (sol.e[x] === 1) assert.equal(st.e[j], 1); }
    const shadedP = Uint8Array.from(sol.cell, (v) => (v === 1 ? 1 : 0));
    assert.ok(checkSolved(P, shadedP, sol.e));
    assert.ok(checkSolved(Q, Uint8Array.from(shaded), st.e));
    assert.equal(encodeSolution(Q, st), Q.solution);
  }
});

// Regression: a board has rows*cols*2 edge SLOTS but fewer real edges (no right edge in the last column, no bottom edge in the last row).
// Slots that are not real edges used to map to edge 0, so turning marks back copied whatever was on edge 0 into all of them ("phantom"
// segments: they fill in cells that are not drawn on, and arrows were flagged wrong), and a real edge that lands on edge 0 was erased.
const marksOf = (rows, cols) => ({ cells: new Uint8Array(rows * cols), edges: new Uint8Array(2 * rows * cols), auto: new Uint8Array(rows * cols) });

test('turning marks to the rotated board and back never invents or loses a segment, whatever the board size', () => {
  let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (const [rows, cols] of [[36, 4], [4, 36], [24, 3], [5, 5], [7, 2], [2, 7], [12, 16], [1, 6]]) {
    const real = realEdges(rows, cols), roundReal = realEdges(cols, rows);
    assert.equal(real.reduce((a, v) => a + v, 0), rows * (cols - 1) + (rows - 1) * cols, `edge count ${rows}x${cols}`);
    for (let trial = 0; trial < 20; trial++) {
      const m = marksOf(rows, cols);
      for (let x = 0; x < m.edges.length; x++) if (real[x] && rnd() < (trial === 0 ? 1 : 0.4)) m.edges[x] = 1;   // trial 0: every real edge drawn
      for (let i = 0; i < m.cells.length; i++) { m.cells[i] = Math.floor(rnd() * 3); m.auto[i] = rnd() < 0.2 ? 1 : 0; }
      const there = turnMarks(m, rows, cols, true);
      there.edges.forEach((v, x) => assert.ok(!v || roundReal[x], `${rows}x${cols}: a segment on a slot that is no edge of the rotated board (${x})`));
      assert.equal(there.edges.reduce((a, v) => a + v, 0), m.edges.reduce((a, v) => a + v, 0), `${rows}x${cols}: segments lost or invented going to the rotated board`);
      const back = turnMarks(there, rows, cols, false);
      assert.deepEqual(back, m, `${rows}x${cols}: not the same after a full turn and back`);
    }
  }
});

test('a segment on the rotated board\'s very first edge does not spread to phantom edges when turned back', () => {
  const rows = 36, cols = 4, real = realEdges(rows, cols);
  const rm = marksOf(rows, cols); rm.edges[0] = 1;                       // top left of the rotated board
  const back = turnMarks(rm, rows, cols, false);
  assert.equal(back.edges.reduce((a, v) => a + v, 0), 1);
  back.edges.forEach((v, x) => assert.ok(!v || real[x]));
  // and the real edge that lands on rotated edge 0 survives the trip there
  const em = edgeMap(rows, cols), src = em.findIndex((v, x) => real[x] && v === 0);
  const om = marksOf(rows, cols); om.edges[src] = 1;
  assert.equal(turnMarks(om, rows, cols, true).edges[0], 1);
});
