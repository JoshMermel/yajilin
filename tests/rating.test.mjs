import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, solve, initialState, SHADED, LOOP, E_ON, E_OFF, UNKNOWN } from '../js/logic.js';
import { rate, RULES, RULE_IDS, nextStep, closure, contradiction, TIERS, rangeDeduce, oddOpenEnds } from '../js/rating.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function randomPuzzle(rand, rows, cols, nClues, maxN = 3, oneRow = false) {
  const cells = [];
  for (let i = 0; i < rows * cols; i++) if (!oneRow || ((i / cols) | 0) === (rows >> 1)) cells.push(i);
  nClues = Math.min(nClues, cells.length);
  const clues = [];
  for (let k = 0; k < nClues; k++) {
    const i = cells.splice((rand() * cells.length) | 0, 1)[0];
    clues.push({ r: (i / cols) | 0, c: i % cols, d: (rand() * 4) | 0, n: (rand() * maxN) | 0 });
  }
  return compile({ name: 'rand', rows, cols, clues });
}

/** Random puzzles with exactly one solution, with that solution. */
function uniquePuzzles(seed, count, rows, cols, nClues) {
  const rand = rng(seed);
  const out = [];
  for (let t = 0; t < 20000 && out.length < count; t++) {
    const P = randomPuzzle(rand, rows, cols, nClues);
    const { count: c, solutions } = solve(P, { limit: 2 });
    if (c === 1) out.push({ P, sol: solutions[0] });
  }
  return out;
}

test('rule table is well formed', () => {
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
  for (const r of RULES) {
    assert.ok(TIERS.includes(r.tier), r.id);
    assert.ok(r.weight >= 0 && typeof r.find === 'function' && r.label, r.id);
    if (r.free) assert.equal(r.weight, 0, r.id);
  }
  // easiest first: tiers never go down the table
  const tiers = RULES.map((r) => TIERS.indexOf(r.tier));
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
});

test('every step the rules take agrees with the unique solution (soundness)', () => {
  const puzzles = [
    ...uniquePuzzles(11, 25, 5, 5, 5),
    ...uniquePuzzles(22, 25, 6, 6, 7),
  ];
  assert.ok(puzzles.length >= 20, `only ${puzzles.length} unique puzzles found`);
  let solvedCount = 0, steps = 0;
  const used = new Set();
  for (const { P, sol } of puzzles) {
    const r = rate(P);
    for (const s of r.steps) {
      used.add(s.rule); steps++;
      for (const [kind, idx, v] of s.sets) {
        if (kind === 'c') assert.equal(sol.cell[idx], v, `${s.rule} sets cell ${idx} wrongly in ${JSON.stringify(P.clues)}`);
        else assert.equal(sol.e[idx] === E_ON ? E_ON : E_OFF, v, `${s.rule} sets edge ${idx} wrongly in ${JSON.stringify(P.clues)}`);
      }
    }
    if (r.solved) {
      solvedCount++;
      for (let i = 0; i < P.N; i++) assert.equal(r.state.cell[i], sol.cell[i]);
    } else {
      assert.equal(r.rules, 'unsolved');
      assert.equal(r.tier, 'Expert');
    }
  }
  assert.ok(solvedCount >= puzzles.length * 0.5, `only ${solvedCount}/${puzzles.length} solved by the rules`);
  assert.ok(steps > 100, `only ${steps} steps`);
  console.log(`    ${puzzles.length} unique puzzles, ${solvedCount} solved by the rules, ${steps} steps checked, rules used: ${[...used].join(' ')}`);
  assert.ok(used.has('clueDone') && used.has('forcedExits'));
});

test('lookahead only claims contradictions that are real', () => {
  // Every contradiction found while assuming the wrong value must disagree with the unique solution.
  for (const { P, sol } of uniquePuzzles(33, 10, 5, 5, 4)) {
    const st = initialState(P);
    for (let i = 0; i < P.N; i++) {
      if (st.cell[i] !== UNKNOWN) continue;
      const wrong = sol.cell[i] === SHADED ? LOOP : SHADED;
      const st2 = { cell: st.cell.slice(), e: st.e.slice(), cycle: false };
      st2.cell[i] = wrong;
      const r = closure(P, st2);
      // the true value must never be refuted
      const right = sol.cell[i];
      const st3 = { cell: st.cell.slice(), e: st.e.slice(), cycle: false };
      st3.cell[i] = right;
      assert.equal(closure(P, st3).contradiction, false, `true value refuted at cell ${i}`);
      void r;
    }
  }
});

test('single rules do what they say', () => {
  // A 0 clue pointing down on a 3x3: the two cells below it are loop cells (clueDone).
  const P = compile({ name: 't', rows: 3, cols: 3, clues: [{ r: 0, c: 1, d: 2, n: 0 }] });
  const st = initialState(P);
  const step = nextStep(P, st);
  assert.equal(step.rule, 'clueDone');
  assert.deepEqual(step.sets.map(([k, i, v]) => [k, i, v]).sort(), [['c', 4, LOOP], ['c', 7, LOOP]]);

  // A clue that needs all its open cells: clueFull. (1 clue pointing right, row of 2 open cells on a 1x3... needs 1 of 2? no)
  const Q = compile({ name: 'u', rows: 1, cols: 3, clues: [{ r: 0, c: 0, d: 1, n: 1 }] });
  // 1 of 2 open cells: neither rule fires on the clue; dead ends (cells with < 2 exits) shade everything open
  const first = nextStep(Q, initialState(Q));
  assert.equal(first.rule, 'deadEnd');

  // contradiction(): two adjacent shaded cells
  const R = compile({ name: 'v', rows: 2, cols: 2, clues: [] });
  const s2 = initialState(R);
  s2.cell[0] = SHADED; s2.cell[1] = SHADED;
  assert.ok(contradiction(R, s2));
  // a lone loop cell in a corner of a 2x2 has two exits: fine
  const s3 = initialState(R);
  s3.cell[0] = LOOP;
  assert.ok(!contradiction(R, s3));
  // a shaded cell with a segment through it is impossible
  const s4 = initialState(R);
  s4.cell[0] = SHADED; s4.e[0] = E_ON;
  assert.ok(contradiction(R, s4));
  assert.equal(E_OFF, 2);
});

// ---------------------------------------------------------------- patterns from play-testing

const ruleSets = (id, P, st = initialState(P)) => {
  const rule = RULES.find((r) => r.id === id);
  return rule.find(P, st, { upto: RULE_IDS.indexOf('tryCell') }).flatMap((f) => f.sets);
};
const asMap = (sets) => Object.fromEntries(sets.map(([k, i, v]) => [`${k}${i}`, v]));
const row = (cols, clues) => compile({ name: 'row', rows: 1, cols, clues: clues.map(([c, d, n]) => ({ r: 0, c, d, n })) });
const [R, L] = [1, 3];

test('pattern: every placement of the clue\'s boxes contains / avoids a cell (cluePlacements)', () => {
  // 3 open cells, 2 boxes that cannot touch: the two ends are boxes, the middle is loop
  const P = row(4, [[0, R, 2]]);
  assert.deepEqual(asMap(ruleSets('cluePlacements', P)), { c1: SHADED, c2: LOOP, c3: SHADED });
  // 5 open cells, 2 boxes: no cell is in every placement or in none: nothing to say
  assert.deepEqual(ruleSets('cluePlacements', row(6, [[0, R, 2]])), []);
  // a known loop cell splits the stretch into [1 cell] and [2 cells]; 2 boxes need one from each, and the single cell is certain
  const Q = row(5, [[0, R, 2]]);
  const st = initialState(Q); st.cell[2] = LOOP;
  assert.deepEqual(asMap(ruleSets('cluePlacements', Q, st)), { c1: SHADED });
});

test('pattern: shading a cell would leave a neighbour with one exit (deadEndNeighbor): corners and one-cell gaps', () => {
  // corner: the cells next to a corner cell must be loop, or the corner would have a single exit
  const corner = compile({ name: 'c', rows: 3, cols: 3, clues: [] });
  assert.equal(asMap(ruleSets('deadEndNeighbor', corner)).c1, LOOP);
  assert.equal(asMap(ruleSets('deadEndNeighbor', corner)).c3, LOOP);
  // two clue cells with one blank cell between them: the blank's only exits are up and down, so both are loop
  const gap = compile({ name: 'g', rows: 3, cols: 3, clues: [{ r: 1, c: 0, d: 0, n: 1 }, { r: 1, c: 2, d: 0, n: 1 }] });
  const m = asMap(ruleSets('deadEndNeighbor', gap));
  assert.equal(m.c1, LOOP);
  assert.equal(m.c7, LOOP);
});

test('pattern: clues pointing the same way share a range with a known box count (rangeSame)', () => {
  // A (col 0, right, 3) and B (col 4, right, 1): the 3 cells between hold 3 - 1 = 2 boxes, so the ends are boxes
  const P = row(9, [[0, R, 3], [4, R, 1]]);
  assert.deepEqual(asMap(ruleSets('rangeSame', P)), { c1: SHADED, c2: LOOP, c3: SHADED });
  // and the other way round, pointing left
  const Q = row(9, [[8, L, 3], [4, L, 1]]);
  assert.deepEqual(asMap(ruleSets('rangeSame', Q)), { c7: SHADED, c6: LOOP, c5: SHADED });
  // different numbers in the wrong order say nothing
  assert.deepEqual(ruleSets('rangeSame', row(9, [[0, R, 1], [4, R, 3]])), []);
});

test('pattern: clues pointing at each other give two ranges of known box count (rangeFacing)', () => {
  // A (col 1, right, 3) and B (col 4, left, 2) on 8 cells. Between them: 2 cells, at most 1 box. The cells right of B
  // hold at most 2, so A needs >= 1 of its 3 from between: exactly 1 between, so exactly 2 right of B (cols 5 and 7,
  // col 6 loop) and, for B, 1 left of A (col 0).
  const P = row(8, [[1, R, 3], [4, L, 2]]);
  const m = asMap(ruleSets('rangeFacing', P));
  assert.equal(m.c0, SHADED);
  assert.equal(m.c5, SHADED);
  assert.equal(m.c6, LOOP);
  assert.equal(m.c7, SHADED);
});

test('every rule is sound on random partial positions of true solutions', () => {
  const rand = rng(2024);
  const upto = RULE_IDS.indexOf('tryCell');
  const fired = {};
  let positions = 0, lookPositions = 0;
  for (let t = 0; t < 30000 && positions < 600; t++) {
    const rows = 4 + ((rand() * 3) | 0), cols = 4 + ((rand() * 3) | 0);
    const oneRow = t % 3 === 0; // a third of the puzzles keep their clues in the middle row, so clues share lines
    const P = randomPuzzle(rand, oneRow ? 3 : rows, oneRow ? 6 : cols, oneRow ? 2 + ((rand() * 3) | 0) : 3 + ((rand() * 6) | 0), oneRow ? 3 : 4, oneRow);
    const first = solve(P, { limit: 1 });
    if (!first.count) continue;
    const sol = first.solutions[0];
    const st = initialState(P);
    for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN && rand() < 0.25) st.cell[i] = sol.cell[i];
    for (let x = 0; x < P.numEdges; x++) {
      const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
      if (b >= P.N || (!(x & 1) && b % P.cols === 0) || P.clueAt[a] >= 0 || P.clueAt[b] >= 0) continue;
      if (rand() < 0.15) st.e[x] = sol.e[x] === E_ON ? E_ON : E_OFF;
    }
    const consistent = solve(P, { limit: 200, state: st }).solutions;
    assert.ok(consistent.length >= 1);
    positions++;
    const doLookahead = rows * cols <= 30 && lookPositions < 40;
    if (doLookahead) lookPositions++;
    for (let r = 0; r < RULES.length; r++) {
      const rule = RULES[r];
      if (rule.lookahead && !doLookahead) continue;
      for (const f of rule.find(P, st, { upto })) {
        fired[rule.id] = (fired[rule.id] || 0) + 1;
        for (const [kind, idx, v] of f.sets) {
          for (const sol2 of consistent) {
            const actual = kind === 'c' ? sol2.cell[idx] : (sol2.e[idx] === E_ON ? E_ON : E_OFF);
            assert.equal(actual, v, `${rule.id} sets ${kind}${idx}=${v} but a solution has ${actual}: ${JSON.stringify(P.clues)} ${P.rows}x${P.cols}`);
          }
        }
      }
    }
  }
  console.log(`    ${positions} positions; firings: ${JSON.stringify(fired)}`);
  for (const id of ['cluePlacements', 'rangeSame', 'rangeFacing', 'deadEndNeighbor', 'shadeForcesLines']) {
    assert.ok(fired[id] > 0, `${id} never fired in the sample`);
  }
});

test('pattern: imagine a box, add the forced lines, a cell gets three lines (shadeForcesLines)', () => {
  // A 5x4 puzzle with two clues whose solve needs this rule (and nothing harder), found by search.
  const P = compile({ name: 'sfl', rows: 5, cols: 4, clues: [{ r: 1, c: 2, d: 2, n: 1 }, { r: 0, c: 0, d: 2, n: 0 }] });
  assert.equal(solve(P, { limit: 2 }).count, 1);
  const r = rate(P);
  assert.ok(r.solved);
  assert.ok(r.counts.shadeForcesLines >= 1, JSON.stringify(r.counts));
  assert.equal(r.rules, 'shadeForcesLines');
  assert.equal(r.tier, 'Hard');
});

// Brute force over all subsets: the slow, obviously right version of rangeDeduce.
function rangeDeduceReference(P, st, cells, kmin, kmax) {
  let s = 0; const elig = [];
  for (const i of cells) {
    if (st.cell[i] === SHADED) s++;
    else if (st.cell[i] === UNKNOWN && !(P.nb.slice(i * 4, i * 4 + 4).some((j) => j >= 0 && st.cell[j] === SHADED))) elig.push(i);
  }
  const touching = (a, b) => (Math.abs(a - b) === 1 && ((a / P.cols) | 0) === ((b / P.cols) | 0)) || Math.abs(a - b) === P.cols;
  let total = 0; const inAll = new Array(elig.length).fill(0);
  for (let m = 0; m < (1 << elig.length); m++) {
    let k = s, ok = true;
    for (let p = 0; p < elig.length && ok; p++) {
      if (!(m >> p & 1)) continue;
      k++;
      if (p > 0 && (m >> (p - 1) & 1) && touching(elig[p - 1], elig[p])) ok = false;
    }
    if (!ok || k < kmin || k > kmax) continue;
    total++;
    for (let p = 0; p < elig.length; p++) if (m >> p & 1) inAll[p]++;
  }
  if (!total) return [];
  const sets = [];
  elig.forEach((i, p) => { if (inAll[p] === total) sets.push(['c', i, SHADED]); else if (inAll[p] === 0) sets.push(['c', i, LOOP]); });
  return sets;
}

test('rangeDeduce (counting) agrees with brute-force enumeration, and handles a 36-cell line instantly', () => {
  const rand = rng(404);
  for (let t = 0; t < 300; t++) {
    const cols = 5 + ((rand() * 8) | 0);
    const P = compile({ name: 'r', rows: 2, cols, clues: [] });
    const st = initialState(P);
    // a random scattering of known cells on row 0 (never two touching shaded cells)
    for (let c = 0; c < cols; c++) {
      const x = rand();
      if (x < 0.15 && !(c > 0 && st.cell[c - 1] === SHADED)) st.cell[c] = SHADED;
      else if (x < 0.3) st.cell[c] = LOOP;
    }
    const cells = Array.from({ length: cols }, (_, c) => c);
    const kmin = (rand() * 4) | 0, kmax = kmin + ((rand() * 3) | 0);
    const got = rangeDeduce(P, st, cells, kmin, kmax), want = rangeDeduceReference(P, st, cells, kmin, kmax);
    assert.deepEqual(got.map(String).sort(), want.map(String).sort(), `cols=${cols} k=${kmin}..${kmax} ${[...st.cell.slice(0, cols)]}`);
  }
  // 36 open cells in a row, 12 boxes: the old enumeration needed millions of steps
  const P = compile({ name: 'big', rows: 1, cols: 37, clues: [{ r: 0, c: 0, d: 1, n: 12 }] });
  const t0 = Date.now();
  const sets = rangeDeduce(P, initialState(P), P.rays[0], 12, 12);
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  assert.equal(sets.length, 0); // slack, so nothing is forced
  // 18 boxes in 36 cells: exactly two ways to alternate... nothing forced; 19 boxes in 37 cells: every other cell, forced
  const Q = compile({ name: 'full', rows: 1, cols: 38, clues: [{ r: 0, c: 0, d: 1, n: 19 }] });
  const forced = rangeDeduce(Q, initialState(Q), Q.rays[0], 19, 19);
  assert.equal(forced.length, 37);
});

test('pattern: two of a loop cell\'s three exits lead to one path, so it uses the third (sameSegmentExits)', () => {
  // 3x3. A U-shaped path (1,0)-(0,0)-(0,1)-(0,2)-(1,2). The middle cell C=(1,1) is loop with exits left, right, down:
  // left and right are the two ends of that path, so joining both would close the loop with (2,1) still outside.
  const P = compile({ name: 's', rows: 3, cols: 3, clues: [] });
  const st = initialState(P);
  for (const i of [0, 1, 2, 3, 5, 4, 7]) st.cell[i] = LOOP;
  for (const x of [1, 0, 2, 5]) st.e[x] = E_ON;   // (1,0)-(0,0), (0,0)-(0,1), (0,1)-(0,2), (0,2)-(1,2)
  st.e[3] = E_OFF;                                  // (0,1) is full: no segment down to C
  const fs = RULES.find((r) => r.id === 'sameSegmentExits').find(P, st, {});
  assert.equal(fs.length, 1);
  assert.deepEqual(fs[0].sets, [['e', 9, E_ON]]);   // the segment C-(2,1)
  assert.equal(fs[0].info.cell, 4);
  // if (2,1) is not on the loop, closing the U would finish it: no deduction
  const st2 = initialState(P);
  for (const i of [0, 1, 2, 3, 5, 4]) st2.cell[i] = LOOP;
  for (const x of [1, 0, 2, 5]) st2.e[x] = E_ON;
  st2.e[3] = E_OFF;
  assert.deepEqual(RULES.find((r) => r.id === 'sameSegmentExits').find(P, st2, {}), []);
});

test('pattern: a cell with only one way out cannot be on the loop and is shaded (deadEnd)', () => {
  // a corner whose two neighbours are clue cells has no ways out at all; one clue cell leaves one way out
  const P = compile({ name: 'd', rows: 3, cols: 3, clues: [{ r: 0, c: 1, d: 2, n: 0 }, { r: 1, c: 0, d: 1, n: 0 }] });
  const sets = ruleSets('deadEnd', P);
  // (0,0) has no way out, (0,2) and (2,0) have one each: all three are shaded
  assert.deepEqual(asMap(sets), { c0: SHADED, c2: SHADED, c6: SHADED });
  // a cell that has lost an exit to a ruled-out segment
  const Q = compile({ name: 'e', rows: 3, cols: 3, clues: [] });
  const st = initialState(Q);
  st.e[0] = E_OFF; // (0,0)-(0,1) off: the corner now has one way out
  assert.equal(asMap(ruleSets('deadEnd', Q, st)).c0, SHADED);
});

test('pattern: a neighbour with only two possible neighbours of its own (tightCell): corners, diagonal clues, a one-cell gap', () => {
  // corner of an empty board: (0,0) has two neighbours, so (0,1) and (1,0) are loop, at a glance
  const corner = compile({ name: 'c', rows: 3, cols: 3, clues: [] });
  const m = asMap(ruleSets('tightCell', corner));
  assert.equal(m.c1, LOOP); assert.equal(m.c3, LOOP);
  // two clue cells touching at a corner: (0,1) and (1,0) are clues, so (0,0) has no neighbours and (1,1) has only (1,2) and (2,1)
  const diag = compile({ name: 'd', rows: 3, cols: 3, clues: [{ r: 0, c: 1, d: 2, n: 0 }, { r: 1, c: 0, d: 1, n: 0 }] });
  const dm = asMap(ruleSets('tightCell', diag));
  assert.equal(dm.c5, LOOP); assert.equal(dm.c7, LOOP);
  // a blank between two clues: its only neighbours are above and below
  const gap = compile({ name: 'g', rows: 3, cols: 3, clues: [{ r: 1, c: 0, d: 0, n: 1 }, { r: 1, c: 2, d: 0, n: 1 }] });
  assert.equal(asMap(ruleSets('tightCell', gap)).c7, LOOP);
  // an interior cell of an empty board has four neighbours: the structural rule says nothing about its neighbours' neighbours
  const big = compile({ name: 'b', rows: 5, cols: 5, clues: [] });
  assert.equal(asMap(ruleSets('tightCell', big)).c12, undefined);
  // it is a cheaper rule than deadEndNeighbor, in the same tier
  const w = (id) => RULES.find((r) => r.id === id).weight;
  assert.ok(w('tightCell') < w('deadEndNeighbor'));
});

test('forcedExits records whether the cell already has a line', () => {
  const P = compile({ name: 'f', rows: 3, cols: 3, clues: [] });
  const st = initialState(P);
  st.cell[0] = LOOP; // corner: exactly two ways out, no lines yet
  let f = RULES.find((r) => r.id === 'forcedExits').find(P, st, {});
  assert.equal(f[0].info.on, 0);
  st.e[0] = E_ON; st.cell[1] = LOOP; // one line already: the other way out is the only one left
  f = RULES.find((r) => r.id === 'forcedExits').find(P, st, {});
  assert.equal(f.find((x) => x.info.cell === 0).info.on, 1);
});

test('pattern: groups of cells that can still be joined need an even number of open ends (parity)', () => {
  // A row of 5: a segment between cells 0 and 1 leaves cell 0 an open end with nothing to join: one open end, odd.
  const row5 = compile({ name: 'r', rows: 1, cols: 5, clues: [] });
  const bad = initialState(row5);
  bad.cell[0] = LOOP; bad.cell[1] = LOOP; bad.e[0] = E_ON;
  assert.ok(oddOpenEnds(row5, bad), 'an odd group should be reported');
  assert.ok(contradiction(row5, bad));
  // 2x3, a segment between (0,0) and (1,0): open ends 0 and 3 can still join through the rest: even, fine
  const P = compile({ name: 'p', rows: 2, cols: 3, clues: [] });
  const st = initialState(P);
  st.cell[0] = LOOP; st.cell[3] = LOOP; st.e[1] = E_ON;
  assert.equal(oddOpenEnds(P, st), null);
  assert.ok(!contradiction(P, st));
  // shading (0,1) would leave open end 0 alone: odd, so (0,1) must be loop
  const sets = asMap(ruleSets('parityForces', P, st));
  assert.equal(sets.c1, LOOP);
  // and ruling out the segment (1,0)-(1,1) would leave open end 3 alone: that segment is on
  assert.equal(sets.e6, E_ON);
});

test('pattern: a cell whose only two ways out would close the loop early is a box (closingCell)', () => {
  // 3x3, a U-shaped path (1,0)-(0,0)-(0,1)-(0,2)-(1,2). The middle cell has exits left and right only (up is full, down ruled out):
  // both are ends of that path, so using them would close the loop while (2,1) is still outside.
  const P = compile({ name: 'cc', rows: 3, cols: 3, clues: [] });
  const st = initialState(P);
  for (const i of [0, 1, 2, 3, 5, 7]) st.cell[i] = LOOP;
  for (const x of [1, 0, 2, 5]) st.e[x] = E_ON;
  st.e[3] = E_OFF; st.e[9] = E_OFF; // no segment from (0,1) down to the middle, none from the middle down to (2,1)
  const sets = asMap(ruleSets('closingCell', P, st));
  assert.equal(sets.c4, SHADED);
  // with nothing else on the loop, closing it would finish it: no deduction
  const st2 = initialState(P);
  for (const i of [0, 1, 2, 3, 5]) st2.cell[i] = LOOP;
  for (const x of [1, 0, 2, 5]) st2.e[x] = E_ON;
  st2.e[3] = E_OFF; st2.e[9] = E_OFF;
  assert.deepEqual(ruleSets('closingCell', P, st2), []);
});

test('pattern: the loop crosses the border of any rectangle an even number of times (crossingParity)', () => {
  // 2x3, no clues. The left column is a rectangle with two crossings (the segments from (0,0) and (1,0) to their right neighbours).
  // One is drawn, so the other is too.
  const P = compile({ name: 'cp', rows: 2, cols: 3, clues: [] });
  const st = initialState(P);
  st.e[0] = E_ON;
  const sets = asMap(ruleSets('crossingParity', P, st));
  assert.equal(sets.e6, E_ON);
  // two drawn crossings: the rest are off
  const st2 = initialState(P);
  st2.e[0] = E_ON; st2.e[6] = E_ON; // both crossings of the left column drawn: even, nothing to force there
  assert.equal(asMap(ruleSets('crossingParity', P, st2)).e6, undefined);
  // a clue next to the rectangle removes a crossing: (1,0) is a clue, so the left column has only one live crossing
  const Q = compile({ name: 'cq', rows: 2, cols: 3, clues: [{ r: 1, c: 0, d: 0, n: 0 }] });
  const s3 = initialState(Q);
  // the rectangle {(0,0)} has crossings (0,0)-(0,1) only (the cell below is a clue): the loop cannot cross it once, so it is off
  assert.equal(asMap(ruleSets('crossingParity', Q, s3)).e0, E_OFF);
});
