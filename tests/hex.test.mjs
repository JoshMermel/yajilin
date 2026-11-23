import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compile, solve, encodeSolution, decodeSolution, checkSolved, toCsv, parseCsv, puzzleHash, hexStep, edgeCells,
  CSV_HEADER_HEX, SHADED, LOOP, initialState,
} from '../js/logic.js';
import { referenceCount } from './reference_solver.mjs';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

// offset (odd-r) -> cube coordinates, so the geometry is checked against something other than hexStep itself
const cube = (r, c) => { const q = c - ((r - (r & 1)) >> 1); return [q, r, -q - r]; };
const sub = (a, b) => a.map((v, k) => v - b[k]);

test('hexStep: six distinct neighbours, each direction undone by its opposite, and every step has the unit length in cube coordinates', () => {
  for (let r = 3; r < 6; r++) for (let c = 3; c < 6; c++) {
    const seen = new Set();
    for (let d = 0; d < 6; d++) {
      const [nr, nc] = hexStep(r, c, d);
      seen.add(`${nr},${nc}`);
      assert.deepEqual(hexStep(nr, nc, (d + 3) % 6), [r, c], `opposite of ${d} from ${r},${c}`);
      const v = sub(cube(nr, nc), cube(r, c));
      assert.equal(Math.max(...v.map(Math.abs)), 1);
    }
    assert.equal(seen.size, 6);
  }
});

test('hexStep: a direction is the same cube vector from every cell, so a ray is a straight line', () => {
  for (let d = 0; d < 6; d++) {
    let want = null;
    for (let r = 2; r < 7; r++) for (let c = 2; c < 7; c++) {
      const [nr, nc] = hexStep(r, c, d);
      const v = sub(cube(nr, nc), cube(r, c)).join(',');
      if (want === null) want = v; else assert.equal(v, want, `direction ${d} at ${r},${c}`);
    }
  }
});

test('compile (hex): 3 edges per cell, every edge joins two neighbours, and neighbours are mutual', () => {
  const P = compile({ name: 't', grid: 'hex', rows: 5, cols: 4, clues: [] });
  assert.equal(P.K, 6);
  assert.equal(P.numEdges, 3 * 20);
  let edges = 0;
  for (let x = 0; x < P.numEdges; x++) {
    const [a, b] = edgeCells(P, x);
    if (a < 0) continue;
    edges++;
    const ra = (a / 4) | 0, ca = a % 4;
    const nbs = [0, 1, 2, 3, 4, 5].map((d) => hexStep(ra, ca, d)).filter(([r, c]) => r >= 0 && c >= 0 && r < 5 && c < 4).map(([r, c]) => r * 4 + c);
    assert.ok(nbs.includes(b), `edge ${x} joins ${a} and ${b}`);
  }
  // 5x4 hex board: 5 rows of 3 horizontal edges, and 4 row gaps; the gap below an even row has 4 + 3 links, below an odd row 4 + 3 as well
  assert.equal(edges, 15 + 4 * 7);
  for (let i = 0; i < 20; i++) {
    let deg = 0;
    for (let d = 0; d < 6; d++) if (P.nb[i * 6 + d] >= 0) { deg++; assert.equal(P.nb[P.nb[i * 6 + d] * 6 + (d + 3) % 6], i); }
    assert.ok(deg >= 2 && deg <= 6);     // a corner of the rectangle touches only two cells
  }
});

function randomHexPuzzle(rand, rows, cols, nClues) {
  const cells = [];
  for (let i = 0; i < rows * cols; i++) cells.push(i);
  const clues = [];
  for (let k = 0; k < nClues; k++) {
    const i = cells.splice((rand() * cells.length) | 0, 1)[0];
    clues.push({ r: (i / cols) | 0, c: i % cols, d: (rand() * 6) | 0, n: (rand() * 3) | 0 });
  }
  return compile({ name: 'rand', grid: 'hex', rows, cols, clues });
}

test('hex solver agrees with the brute-force reference on random small boards', () => {
  const rand = rng(777);
  const seen = { 0: 0, 1: 0, many: 0 };
  for (let t = 0; t < 250; t++) {
    const rows = 3 + ((rand() * 2) | 0), cols = 3 + ((rand() * 2) | 0);
    const P = randomHexPuzzle(rand, rows, cols, 1 + ((rand() * 4) | 0));
    const want = referenceCount(P);
    const { count } = solve(P, { limit: 1000 });
    assert.equal(count, want, `puzzle ${JSON.stringify(P.clues)} on ${rows}x${cols}`);
    seen[want > 1 ? 'many' : want]++;
  }
  assert.ok(seen[0] > 5 && seen.many > 5, JSON.stringify(seen));
});

/** A hex puzzle with a known solution: a random independent set of holes, a loop through the rest (found by the solver), some holes as arrows. */
function consistentHexPuzzle(rand, rows, cols) {
  const N = rows * cols;
  const order = Array.from({ length: N }, (_, i) => i).sort(() => rand() - 0.5);
  const probe = compile({ name: 'p', grid: 'hex', rows, cols, clues: [] });
  const holes = new Set();
  for (const i of order) {
    if (holes.size >= 3 + ((rand() * 4) | 0)) break;
    if ([0, 1, 2, 3, 4, 5].every((d) => !holes.has(probe.nb[i * 6 + d]))) holes.add(i);
  }
  const voidP = compile({ name: 'v', grid: 'hex', rows, cols, clues: [...holes].map((i) => ({ r: (i / cols) | 0, c: i % cols, d: 0, n: -1 })) });
  const st = initialState(voidP);
  for (let i = 0; i < N; i++) if (!holes.has(i)) st.cell[i] = LOOP;                       // the loop runs through every cell that is not a hole
  if (!solve(voidP, { limit: 1, state: st }).count) return null;
  const clueCells = [...holes].filter(() => rand() < 0.85);
  if (!clueCells.length) return null;
  const isClue = new Set(clueCells);
  const clues = clueCells.map((i) => {
    const d = (rand() * 6) | 0;
    let [r, c] = hexStep((i / cols) | 0, i % cols, d), n = 0;
    while (r >= 0 && c >= 0 && r < rows && c < cols) { const j = r * cols + c; if (holes.has(j) && !isClue.has(j)) n++; [r, c] = hexStep(r, c, d); }
    return { r: (i / cols) | 0, c: i % cols, d, n };
  });
  return compile({ name: 'cons', grid: 'hex', rows, cols, clues });
}

test('hex solver agrees with the reference on boards built around a real solution (so unique ones are common)', () => {
  const rand = rng(4242);
  let unique = 0, built = 0;
  for (let t = 0; t < 300; t++) {
    const P = consistentHexPuzzle(rand, 3 + ((rand() * 2) | 0), 3 + ((rand() * 2) | 0));
    if (!P) continue;
    built++;
    const want = referenceCount(P);
    assert.ok(want >= 1, 'the built solution must be a solution');
    assert.equal(solve(P, { limit: want + 1 }).count, want);
    if (want === 1) unique++;
  }
  assert.ok(built > 40 && unique > 5, `built ${built}, unique ${unique}`);
});

test('hex: found solutions pass checkSolved and survive an encode/decode round trip', () => {
  const rand = rng(99);
  let checked = 0;
  for (let t = 0; t < 60 && checked < 15; t++) {
    const P = randomHexPuzzle(rand, 4, 4, 3);
    const { solutions } = solve(P, { limit: 3 });
    for (const st of solutions) {
      const shaded = Uint8Array.from(st.cell, (v) => (v === SHADED ? 1 : 0));
      assert.ok(checkSolved(P, shaded, st.e));
      const str = encodeSolution(P, st);
      assert.equal(str.length, P.N);
      const back = decodeSolution(P, str);
      assert.equal(encodeSolution(P, back), str);
      assert.ok(checkSolved(P, Uint8Array.from(back.cell, (v) => (v === SHADED ? 1 : 0)), back.e));
      checked++;
    }
  }
  assert.ok(checked >= 5);
});

test('hex: the CSV keeps the grid and the six arrow letters, and a hex puzzle hashes differently from a square one', () => {
  const clues = [{ r: 0, c: 1, d: 5, n: 2 }, { r: 2, c: 2, d: 3, n: 0 }, { r: 1, c: 0, d: 0, n: -1 }];
  const hexP = { name: 'h1', grid: 'hex', rows: 4, cols: 4, clues, solution: '', rules: '', tier: '', score: null, boxes: [] };
  const sqP = { name: 's1', rows: 4, cols: 4, clues: [{ r: 0, c: 1, d: 1, n: 2 }], solution: '', rules: '', tier: '', score: null, boxes: [] };
  const text = toCsv([hexP, sqP]);
  assert.ok(text.startsWith(CSV_HEADER_HEX));
  const back = parseCsv(text);
  assert.equal(back[0].grid, 'hex');
  assert.deepEqual(back[0].clues, clues.map((c) => (c.n < 0 ? { r: c.r, c: c.c, d: 0, n: -1 } : c)));
  assert.equal(back[1].grid, undefined);
  assert.notEqual(puzzleHash(hexP), puzzleHash({ ...hexP, grid: undefined }));
  for (const line of text.trim().split('\n')) assert.equal(line.split(',').length, 11, line);
});
