import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, solve, encodeSolution, decodeSolution, checkSolved, toCsv, parseCsv, puzzleHash,
  DR, DC, E_ON, E_OFF,
} from '../js/logic.js';
import { referenceCount } from './reference_solver.mjs';

// Small deterministic PRNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function randomPuzzle(rand, rows, cols, nClues) {
  const cells = [];
  for (let i = 0; i < rows * cols; i++) cells.push(i);
  const clues = [];
  for (let k = 0; k < nClues; k++) {
    const i = cells.splice((rand() * cells.length) | 0, 1)[0];
    const r = (i / cols) | 0, c = i % cols;
    const d = (rand() * 4) | 0;
    // clue number: 0..2, biased to what the ray can hold
    clues.push({ r, c, d, n: (rand() * 3) | 0 });
  }
  return compile({ name: 'rand', rows, cols, clues });
}

test('solver agrees with the brute-force reference on random small boards', () => {
  const rand = rng(12345);
  const histogram = { 0: 0, 1: 0, many: 0 };
  for (let t = 0; t < 300; t++) {
    const rows = 3 + ((rand() * 2) | 0), cols = 3 + ((rand() * 3) | 0); // up to 4x5: the reference is exponential
    const P = randomPuzzle(rand, rows, cols, 1 + ((rand() * 4) | 0));
    const want = referenceCount(P);
    const { count } = solve(P, { limit: 1000 });
    assert.equal(count, want, `puzzle ${JSON.stringify(P.clues)} on ${rows}x${cols}`);
    histogram[want > 1 ? 'many' : want]++;
  }
  // The sample must actually exercise unique, impossible and ambiguous puzzles.
  assert.ok(histogram[1] > 5 && histogram[0] > 5 && histogram.many > 5, JSON.stringify(histogram));
});

test('solutions pass checkSolved, and breaking them does not', () => {
  const rand = rng(777);
  let checked = 0;
  for (let t = 0; t < 300 && checked < 20; t++) {
    const P = randomPuzzle(rand, 5, 5, 3);
    const { solutions } = solve(P, { limit: 3 });
    for (const st of solutions) {
      const shaded = new Uint8Array(P.N);
      for (let i = 0; i < P.N; i++) shaded[i] = st.cell[i] === 1 ? 1 : 0;
      const edges = Int8Array.from(st.e, (v) => (v === E_ON ? 1 : 0));
      assert.ok(checkSolved(P, shaded, edges));
      // Remove a loop segment: no longer a cycle.
      const x = edges.findIndex((v) => v === 1);
      const broken = edges.slice(); broken[x] = 0;
      assert.ok(!checkSolved(P, shaded, broken));
      // Shade a loop cell: breaks clue counts or the cycle.
      const li = [...st.cell].findIndex((v) => v === 2);
      const sh2 = shaded.slice(); sh2[li] = 1;
      assert.ok(!checkSolved(P, sh2, edges));
      checked++;
    }
  }
  assert.ok(checked >= 5);
});

test('encode/decode solution round trip', () => {
  const rand = rng(99);
  let n = 0;
  for (let t = 0; t < 200 && n < 10; t++) {
    const P = randomPuzzle(rand, 4, 5, 2);
    const { solutions } = solve(P, { limit: 1 });
    if (!solutions.length) continue;
    const s = encodeSolution(P, solutions[0]);
    const st = decodeSolution(P, s);
    assert.equal(encodeSolution(P, st), s);
    n++;
  }
  assert.ok(n > 0);
});

test('CSV round trip and puzzle hash', () => {
  const P = compile({
    name: 'a', rows: 4, cols: 4,
    clues: [{ r: 0, c: 1, d: 2, n: 1 }, { r: 2, c: 3, d: 3, n: 0 }],
    solution: '', tier: 'Easy', score: 7,
  });
  const [q] = parseCsv(toCsv([P]));
  assert.deepEqual(q.clues, P.clues);
  assert.equal(q.rows, 4);
  assert.equal(q.tier, 'Easy');
  assert.equal(q.score, 7);
  assert.equal(puzzleHash(q), puzzleHash(P));
  assert.notEqual(puzzleHash(q), puzzleHash({ ...q, clues: [] }));
});
