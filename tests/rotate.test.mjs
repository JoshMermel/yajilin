import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, solve, encodeSolution, decodeSolution, puzzleHash, checkSolved, parseCsv } from '../js/logic.js';
import { cellMap, edgeMap, rotated } from '../js/rotate.js';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

test('rotating a puzzle gives a puzzle with the rotated solution, the same identity, and the same loop', () => {
  const raw = parseCsv(fs.readFileSync(`${root}data/bonus-intro.csv`, 'utf8')).concat(parseCsv(fs.readFileSync(`${root}data/bonus-tall.csv`, 'utf8')).slice(0, 3));
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
