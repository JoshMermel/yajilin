import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, solve, decodeSolution, checkSolved, toCsvRow, parseCsv, SHADED, E_ON } from '../js/logic.js';
import { generatePuzzle, randomLoop, makeRng } from '../js/generator.js';
import { solvedByRules, ratePuzzle } from '../js/rating.js';

test('randomLoop: one cycle through every cell that is not a hole', () => {
  const rng = makeRng(1);
  let made = 0;
  for (let t = 0; t < 40 && made < 10; t++) {
    const rows = 4 + (t % 4) * 2, cols = 4 + ((t >> 1) % 3) * 2;
    const loop = randomLoop(rows, cols, rng, { density: 0.25 });
    if (!loop) continue;
    made++;
    const N = rows * cols;
    const deg = new Array(N).fill(0);
    const adj = Array.from({ length: N }, () => []);
    for (let x = 0; x < 2 * N; x++) {
      if (!loop.edges[x]) continue;
      const a = x >> 1, b = (x & 1) ? a + cols : a + 1;
      assert.ok(b < N && ((x & 1) || b % cols !== 0), 'segment off the board');
      deg[a]++; deg[b]++; adj[a].push(b); adj[b].push(a);
    }
    let loopCells = 0;
    for (let i = 0; i < N; i++) {
      if (loop.holes[i]) assert.equal(deg[i], 0, `hole ${i} has a segment`);
      else { assert.equal(deg[i], 2, `cell ${i} should have two segments`); loopCells++; }
    }
    // walk it: one cycle covering all loop cells
    const start = loop.holes.findIndex((h) => !h);
    let prev = -1, cur = start, steps = 0;
    do { const next = adj[cur].find((j) => j !== prev) ?? adj[cur][0]; prev = cur; cur = next; steps++; } while (cur !== start && steps <= N);
    assert.equal(steps, loopCells);
  }
  assert.ok(made >= 5, `only ${made} loops`);
});

test('generatePuzzle: valid solution, exactly one solution (complete exhaustive search), rated, reproducible', () => {
  const made = [];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const r = generatePuzzle(8, 8, makeRng(seed), { name: `t${seed}`, budgetMs: 20000 });
    if (!r) continue;
    const P = r.puzzle;
    made.push(P);
    // the stored solution is valid under the real checker
    const sol = decodeSolution(P, P.solution);
    const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
    const edges = Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0));
    assert.ok(checkSolved(P, shaded, edges), 'stored solution is invalid');
    // exactly one solution, by a search that finished
    const u = solve(P, { limit: 2, maxNodes: 5000000 });
    assert.equal(u.exceeded, false);
    assert.equal(u.count, 1);
    // the human-style solver rates it (and, for these small boards, finishes it)
    const rating = ratePuzzle(P);
    assert.ok(rating.solved, `${P.name} not solved by the rules`);
    // survives the CSV round trip as the same puzzle
    const [q] = parseCsv(toCsvRow(P));
    assert.deepEqual(q.clues, P.clues);
    assert.equal(q.solution, P.solution);
  }
  assert.ok(made.length >= 3, `only ${made.length} puzzles generated`);
  // same seed, same puzzle
  const again = generatePuzzle(8, 8, makeRng(1), { name: 't1', budgetMs: 20000 });
  const first = generatePuzzle(8, 8, makeRng(1), { name: 't1', budgetMs: 20000 });
  assert.equal(again.puzzle.solution, first.puzzle.solution);
});

test('solvedByRules only claims puzzles the rules really solve', () => {
  // a board with no clues is ambiguous: the rules must not claim to solve it
  const P = compile({ name: 'empty', rows: 4, cols: 4, clues: [] });
  assert.equal(solvedByRules(P).solved, false);
});

import { makeLoopBuilder, crossingChords, tightLoop, loopIsUnique } from '../js/generator.js';

test('crossing chords: a loop with a crossing pair is never unique; tightLoop builds loops that are', () => {
  const rng = makeRng(9);
  let sawCrossing = 0, sawClean = 0;
  for (let t = 0; t < 40; t++) {
    const rows = 6 + 2 * (t % 3), cols = 6 + 2 * ((t >> 1) % 3);
    const b = makeLoopBuilder(rows, cols, rng);
    if (!b.init()) continue;
    const N = rows * cols;
    let holes = 0;
    for (let k = 0; k < 400 && holes < Math.round(N * 0.3 / 2) * 2; k++) { const c1 = (rng() * N) | 0, c2 = (rng() * N) | 0; if (b.okCell(c1, 0.5) && b.okCell(c2, 0.5) && b.tryHoles(c1, c2)) holes += 2; }
    const { pos, length } = b.positions();
    const { crossings } = crossingChords(rows, cols, b.hole, pos, length);
    const unique = loopIsUnique(rows, cols, b.hole);
    if (crossings > 0) { sawCrossing++; assert.equal(unique, false, `a loop with ${crossings} crossing pair(s) cannot be unique`); } else sawClean++;
  }
  assert.ok(sawCrossing > 3 && sawClean > 3, `sample too one-sided: ${sawCrossing} / ${sawClean}`);
  // tightLoop: unique by construction, at sizes where random loops essentially never are
  for (const [rows, cols] of [[10, 10], [14, 14], [16, 12]]) {
    const r = tightLoop(rows, cols, makeRng(rows * cols), { budgetMs: 20000 });
    assert.ok(r, `no tight loop at ${cols}x${rows}`);
    assert.ok(loopIsUnique(rows, cols, r.holes));
    // every non-hole cell has exactly two segments
    const deg = new Array(rows * cols).fill(0);
    for (let x = 0; x < 2 * rows * cols; x++) if (r.edges[x]) { const a = x >> 1, b2 = (x & 1) ? a + cols : a + 1; deg[a]++; deg[b2]++; }
    for (let i = 0; i < rows * cols; i++) assert.equal(deg[i], r.holes[i] ? 0 : 2);
  }
});

test('odd boards: 7x7 and 5x7 puzzles are valid, unique and rule-solved', () => {
  let made = 0;
  for (const [rows, cols, seed] of [[7, 7, 1], [7, 7, 2], [5, 7, 3], [7, 5, 4], [9, 9, 5]]) {
    const r = generatePuzzle(rows, cols, makeRng(seed), { name: `odd${seed}`, budgetMs: 20000 });
    if (!r) continue;
    made++;
    const P = r.puzzle;
    const sol = decodeSolution(P, P.solution);
    assert.ok(checkSolved(P, Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0))));
    if (rows * cols <= 49) { const u = solve(P, { limit: 2, maxNodes: 5000000 }); assert.equal(u.exceeded, false); assert.equal(u.count, 1); }
    assert.ok(ratePuzzle(P).solved);
  }
  assert.ok(made >= 3, `only ${made} odd-board puzzles`);
});

import { plantTightArrows } from '../js/generator.js';

test('plantTightArrows: arrows with exactly 2n-1 cells to the wall, boxes on every other cell, no touching', () => {
  const rng = makeRng(77);
  for (let t = 0; t < 30; t++) {
    const rows = 12, cols = 12;
    const plan = plantTightArrows(rows, cols, rng, 4);
    const boxes = new Set(plan.boxes);
    for (const [cell, d] of plan.clues) {
      const r = (cell / cols) | 0, c = cell % cols;
      const dr = [-1, 0, 1, 0][d], dc = [0, 1, 0, -1][d];
      const ray = [];
      for (let rr = r + dr, cc = c + dc; rr >= 0 && cc >= 0 && rr < rows && cc < cols; rr += dr, cc += dc) ray.push(rr * cols + cc);
      assert.equal(ray.length % 2, 1, 'the cells to the wall number 2n-1');
      ray.forEach((i, q) => assert.equal(boxes.has(i), q % 2 === 0, `cell ${q} of the ray`));        // boxes on the 1st, 3rd, ... cell
      ray.forEach((i, q) => { if (q % 2 === 1) assert.ok(plan.between.has(i)); });                     // dots between them
    }
    for (const b of plan.boxes) for (const j of [b - 1, b + 1, b - cols, b + cols]) if (!(j === b - 1 && b % cols === 0) && !(j === b + 1 && (b + 1) % cols === 0)) assert.ok(!boxes.has(j), 'boxes never touch');
  }
});

test('generatePuzzle with planted tight arrows is valid, unique, and has tight arrows', () => {
  let made = 0, tight = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = generatePuzzle(10, 10, makeRng(seed), { name: `tight${seed}`, budgetMs: 20000, tightArrows: 2, edgeBias: 0.8, shadeShare: 0.7 });
    if (!r) continue;
    made++;
    const P = r.puzzle;
    const u = solve(P, { limit: 2, maxNodes: 5000000 });
    assert.equal(u.exceeded, false); assert.equal(u.count, 1);
    P.clues.forEach((c, k) => { if (c.n >= 2 && P.rays[k].filter((i) => P.clueAt[i] < 0).length === 2 * c.n - 1) tight++; });
  }
  assert.ok(made >= 2 && tight >= 2, `${made} puzzles, ${tight} tight arrows`);
});
