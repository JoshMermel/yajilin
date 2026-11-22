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

test('pre-placed boxes: shaded from the start, kept by the solver, required by the checker, saved in the CSV', () => {
  // a 3x3 board with a box in the middle: the loop is the ring around it
  const P = compile({ name: 'ring', rows: 3, cols: 3, clues: [], boxes: [{ r: 1, c: 1 }] });
  assert.deepEqual(P.boxIdx, [4]);
  const r = solve(P, { limit: 5 });
  assert.equal(r.count, 1);
  const sol = encodeSolution(P, r.solutions[0]);
  assert.equal(sol[4], 'x');
  // the checker needs the box shaded
  const shaded = new Uint8Array(9); shaded[4] = 1;
  const edges = Int8Array.from(r.solutions[0].e, (v) => (v === E_ON ? 1 : 0));
  assert.ok(checkSolved(P, shaded, edges));
  assert.ok(!checkSolved(P, new Uint8Array(9), edges));
  // CSV round trip keeps them, and the hash tells puzzles with and without them apart
  const [q] = parseCsv(toCsv([{ ...P, solution: sol }]));
  assert.deepEqual(q.boxes, [{ r: 1, c: 1 }]);
  assert.notEqual(puzzleHash(q), puzzleHash({ ...q, boxes: [] }));
  assert.throws(() => compile({ name: 'x', rows: 2, cols: 2, clues: [{ r: 0, c: 0, d: 1, n: 0 }], boxes: [{ r: 0, c: 0 }] }));
});

test('solve reports when it was cut off, so a truncated search never proves uniqueness', () => {
  const P = compile({ name: 'open', rows: 6, cols: 6, clues: [] });
  const cut = solve(P, { limit: 1000, maxNodes: 50 });
  assert.ok(cut.exceeded);
  const full = solve(compile({ name: 'ring', rows: 3, cols: 3, clues: [], boxes: [{ r: 1, c: 1 }] }), { limit: 2 });
  assert.equal(full.count, 1);
  assert.equal(full.exceeded, false);
});

// symmetryKey: one key for a puzzle and all its turned and mirrored copies (books are deduplicated by it)
test('symmetryKey is the same for all eight turns and mirrors of a puzzle, and differs for other puzzles', async () => {
  const { symmetryKey, puzzleHash, parseCsv, DR, DC, DIR_LETTERS } = await import('../js/logic.js');
  const { rotateRaw } = await import('../js/rotate.js');
  const fs = await import('node:fs');
  const root = new URL('..', import.meta.url).pathname;
  const ps = parseCsv(fs.readFileSync(`${root}data/diagonal-mixed-8x8.csv`, 'utf8')).concat(parseCsv(fs.readFileSync(`${root}data/bonus-skyscraper-8x36.csv`, 'utf8')).slice(0, 4));
  const dirOf = (dr, dc) => DR.findIndex((v, d) => v === dr && DC[d] === dc);
  // an independent mirror (left to right) and transpose, written out
  const mirror = (p) => ({ ...p, clues: p.clues.map((c) => (c.n < 0 ? { ...c, c: p.cols - 1 - c.c } : { ...c, c: p.cols - 1 - c.c, d: dirOf(DR[c.d], -DC[c.d]) })) });
  const transpose = (p) => ({ ...p, rows: p.cols, cols: p.rows, clues: p.clues.map((c) => (c.n < 0 ? { ...c, r: c.c, c: c.r } : { ...c, r: c.c, c: c.r, d: dirOf(DC[c.d], DR[c.d]) })) });
  for (const p of ps) {
    const k = symmetryKey(p);
    let q = p;
    for (let t = 0; t < 4; t++) { q = rotateRaw(q); assert.equal(symmetryKey(q), k, `a quarter turn (${t + 1}) of ${p.name}`); }
    assert.equal(symmetryKey(mirror(p)), k, `the mirror of ${p.name}`);
    assert.equal(symmetryKey(transpose(p)), k, `the transpose of ${p.name}`);
    assert.equal(symmetryKey(mirror(transpose(rotateRaw(p)))), k, 'and a mixture');
  }
  const [a, b] = [ps[0], ps[ps.length - 1]];
  assert.notEqual(symmetryKey(a), symmetryKey(b), 'different puzzles differ');
  assert.notEqual(puzzleHash(transpose(ps[0])), puzzleHash(ps[0]), 'the save key still tells a transposed twin apart');
  assert.ok(DIR_LETTERS.length === 8);
});
