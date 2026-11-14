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
