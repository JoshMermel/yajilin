import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, initialState, solve, decodeSolution, checkSolved, cluesToString, cluesFromString, parseCsv, toCsv, toCsvRow, puzzleHash, SHADED, LOOP, UNKNOWN } from '../js/logic.js';
import { rate, solvedByRules, regionDeduce } from '../js/rating.js';
import { generateRegional, growRegions, makeRng } from '../js/generator.js';

// Regional puzzles (experiment): no arrows, no clue cells; the board is cut into regions (`regions`, one id per cell) and a region clue
// ({r, c, n, region: true}, written r:c:G:n) counts the shaded cells of the region its cell lies in. The cell is an ordinary cell.

const G = (r, c, n) => ({ r, c, d: 0, n, region: true });
//  4x4 regions:  0 0 1 1
//                0 2 2 1
//                3 2 2 4
//                3 3 4 4
const REGIONS = [0, 0, 1, 1, 0, 2, 2, 1, 3, 2, 2, 4, 3, 3, 4, 4];

test('the file token: a region clue is r:c:G:n, and the regions column round-trips through the CSV', () => {
  const clues = [G(0, 0, 1), G(1, 3, 2)];
  assert.equal(cluesToString(clues), '0:0:G:1;1:3:G:2');
  assert.deepEqual(cluesFromString('0:0:G:1;1:3:G:2'), clues);
  const p = { name: 'g', rows: 4, cols: 4, clues, regions: REGIONS, solution: '', rules: '', tier: '', score: '', boxes: [] };
  const q = parseCsv(toCsvRow(p))[0];
  assert.deepEqual(q.clues, clues);
  assert.deepEqual(q.regions, REGIONS);
  assert.notEqual(puzzleHash(p), puzzleHash({ ...p, regions: undefined }), 'the regions are part of a puzzle\'s identity');
  assert.ok(toCsv([p]).split('\n')[0].endsWith(',regions'));
  assert.equal(parseCsv(toCsv([{ ...p, regions: undefined, clues: [{ r: 0, c: 0, d: 1, n: 1 }] }]))[0].regions, undefined, 'an arrow puzzle has no regions column');
});

test('compile: a region clue counts its whole region, and its cell stays an ordinary cell', () => {
  const P = compile({ name: 'g', rows: 4, cols: 4, clues: [G(0, 0, 1), G(1, 3, 2)], regions: REGIONS });
  assert.ok(P.regional);
  assert.deepEqual([...P.rays[0]].sort((a, b) => a - b), [0, 1, 4]);
  assert.deepEqual([...P.rays[1]].sort((a, b) => a - b), [2, 3, 7]);
  assert.equal(P.clueAt[0], -1, 'not a clue cell');
  assert.equal(P.labelAt[0], 0);
  assert.equal(P.nb[0 * 4 + 1], 1, 'the loop may pass through the numbered cell');
  assert.equal(initialState(P).cell[0], UNKNOWN);
  assert.throws(() => compile({ name: 'x', rows: 4, cols: 4, clues: [G(0, 0, 1), G(0, 1, 1)], regions: REGIONS }), /two clues in region/);
  assert.throws(() => compile({ name: 'x', rows: 4, cols: 4, clues: [G(0, 0, 1)] }), /needs regions/);
});

// every way to put between kmin and kmax shaded cells in `cells` with no two touching, by brute force
function bruteDeduce(P, st, cells, k) {
  const free = cells.filter((i) => st.cell[i] === UNKNOWN);
  const fixed = cells.filter((i) => st.cell[i] === SHADED).length;
  const touching = (i, j) => P.nb.slice(i * 4, i * 4 + 4).includes(j);
  const hits = new Map(free.map((i) => [i, 0]));
  let total = 0;
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const pick = free.filter((_, b) => mask & (1 << b));
    if (fixed + pick.length !== k) continue;
    if (pick.some((i, a) => pick.some((j, b) => a < b && touching(i, j)))) continue;
    if (pick.some((i) => P.nb.slice(i * 4, i * 4 + 4).some((j) => j >= 0 && st.cell[j] === SHADED))) continue;
    total++; for (const i of pick) hits.set(i, hits.get(i) + 1);
  }
  const out = [];
  if (!total) return out;
  for (const i of free) {
    if (P.nb.slice(i * 4, i * 4 + 4).some((j) => j >= 0 && st.cell[j] === SHADED)) continue;      // touches a box: not a candidate
    if (hits.get(i) === total) out.push([i, SHADED]); else if (hits.get(i) === 0) out.push([i, LOOP]);
  }
  return out;
}

test('regionDeduce agrees with brute force on random regions and partly filled boards', () => {
  const rng = makeRng(7);
  let compared = 0;
  for (let t = 0; t < 300; t++) {
    const rows = 5, cols = 5;
    const owner = growRegions(rows, cols, rng, 3 + ((rng() * 3) | 0), 12);
    const P = compile({ name: 'g', rows, cols, clues: [G(0, 0, 0)].map((c) => ({ ...c, r: (owner.indexOf(owner[0]) / cols) | 0 })), regions: Array.from(owner) });
    const st = initialState(P);
    const cells = P.regionCells[owner[0]];
    for (const i of cells) { const x = rng(); if (x < 0.15) st.cell[i] = SHADED; else if (x < 0.3) st.cell[i] = LOOP; }
    for (let k = 0; k <= cells.length; k++) {
      const got = regionDeduce(P, st, cells, k, k).map((s) => [s[1], s[2]]).sort((a, b) => a[0] - b[0]);
      const want = bruteDeduce(P, st, cells, k).sort((a, b) => a[0] - b[0]);
      assert.deepEqual(got, want, `region ${cells} state ${[...st.cell]} count ${k}`);
      compared++;
    }
  }
  assert.ok(compared > 500);
});

test('generated regional puzzles are solved by the rules, have exactly one solution, and a numbered cell can be a box', () => {
  for (const [rows, cols, seed] of [[6, 6, 1], [6, 6, 2], [6, 6, 3], [8, 8, 1], [8, 8, 2]]) {
    const r = generateRegional(rows, cols, makeRng(seed), { avgSize: 4, budgetMs: 60000 });
    assert.ok(r, `${rows}x${cols} seed ${seed}`);
    const P = r.puzzle;
    assert.ok(P.regional && P.clues.every((c) => c.region));
    assert.ok(solvedByRules(P).solved, 'the rules solve it');
    const all = solve(P, { limit: 2 });
    assert.equal(all.count, 1, 'the exhaustive solver finds exactly one solution');
    assert.equal(rate(P).solved, true);
    const sol = decodeSolution(P, P.solution);
    const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
    assert.ok(checkSolved(P, shaded, sol.e), 'the stored solution is valid');
    for (let k = 0; k < P.clues.length; k++) assert.equal([...P.rays[k]].filter((i) => shaded[i]).length, P.clues[k].n, 'each number counts its region');
    for (let i = 0; i < P.N; i++) if (shaded[i]) for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; assert.ok(j < 0 || !shaded[j], 'boxes never touch'); }
  }
});

import fs from 'node:fs';
import { rotated } from '../js/rotate.js';
import { clueStates } from '../js/clues.js';
import { boardSvg } from '../js/print.js';
import { explainStep } from '../js/explain.js';
import { nextSteps } from '../js/rating.js';

const book = () => parseCsv(fs.readFileSync(new URL('../data/regional-corpus.csv', import.meta.url), 'utf8')).map((p) => compile(p));

test('a quarter turn keeps a regional puzzle the same puzzle: regions turn with the board, and the rotated board is solved by the same rules', () => {
  for (const P of book().filter((_, i) => i % 6 === 0)) {
    const R = rotated(P, 'h');
    assert.ok(R.regional && R.rows === P.cols && R.cols === P.rows);
    assert.equal(R.regionCells.length, P.regionCells.length);
    assert.deepEqual(R.clues.map((c) => c.n).sort(), P.clues.map((c) => c.n).sort());
    assert.equal(rate(R).solved, true, "rated solvable, trial rules included");
    assert.equal(solve(R, { limit: 2 }).count, 1);
  }
});

test('a region clue shows green when its boxes are all there, red when there are too many or it has no room left, and nothing before that', () => {
  const P = compile({ name: 'g', rows: 4, cols: 4, clues: [G(0, 0, 1)], regions: REGIONS });     // region 0 = cells 0, 1, 4
  const marks = (cells) => ({ cells: Uint8Array.from({ length: 16 }, (_, i) => cells[i] || 0), edges: new Uint8Array(32) });
  assert.deepEqual(clueStates(P, marks({})), ['']);
  assert.deepEqual(clueStates(P, marks({ 1: 1 })), ['ok']);
  assert.deepEqual(clueStates(P, marks({ 0: 1, 4: 1 })), ['bad']);
  assert.deepEqual(clueStates(P, marks({ 0: 2, 1: 2, 4: 2 })), ['bad'], 'every cell is a dot and the number is still missing');
});

test('hints and printing know regions', () => {
  const P = book()[13];
  const st = initialState(P);
  const step = nextSteps(P, st);
  assert.ok(step);
  const text = step.firings.map((f) => explainStep(P, { rule: step.rule, tier: step.tier, weight: step.weight, sets: f.sets, info: f.info }, st).text).join(' ');
  assert.match(text, /region/);
  assert.ok(!/undefined|NaN/.test(text));
  const svg = boardSvg(P, decodeSolution(P, P.solution));
  assert.match(svg, /class="region-line"/);
  assert.equal((svg.match(/class="num"/g) || []).length, P.clues.length, 'one number per numbered region');
  assert.ok(!svg.includes('class="clue"'), 'no grey clue cells');
});
