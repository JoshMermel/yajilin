import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, solve, initialState, cluesFromString, SHADED, LOOP, E_ON, E_OFF, UNKNOWN } from '../js/logic.js';
import { rate, RULES, RULE_IDS, SHORT_CHAIN, nextStep, closure, contradiction, TIERS, rangeDeduce, oddOpenEnds, solvedByRules, lineRoom } from '../js/rating.js';

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
    assert.ok(Number.isInteger(r.weight) && r.weight > 0 && typeof r.find === 'function' && r.label, `${r.id}: every rule has an integer cost above zero`);
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

test('pattern: placements that strand a neighbour are thrown out (placementDeadEnd): the edge example', () => {
  // the right-hand column of a 12 x 2 board; a 2-arrow at the top pointing down, and only rows 3, 5 and 9 are open for its boxes.
  // Boxes at rows 3 and 5 would leave the edge cell between them (row 4) with a single way out, so one box must be in row 9.
  const P = compile({ name: 'e', rows: 12, cols: 2, clues: [{ r: 0, c: 1, d: 2, n: 2 }] });
  const st = initialState(P);
  for (const r of [1, 2, 4, 6, 7, 8, 10, 11]) st.cell[r * 2 + 1] = LOOP;
  assert.deepEqual(ruleSets('cluePlacements', P, st), []);                       // plain placements: nothing is forced
  assert.deepEqual(asMap(ruleSets('placementDeadEnd', P, st)), { c19: SHADED });  // row 9, right column
  assert.ok(RULES.find((r) => r.id === 'placementDeadEnd').weight > RULES.find((r) => r.id === 'cluePlacements').weight);
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

test('pattern: a box would turn neighbours into dots and leave a clue no room (boxStarvesClue)', () => {
  // a 1-arrow pointing down-right with two cells in its line, (2,5) and (3,6); the two cells that touch both would leave it with none
  const P = compile({ name: 'bsc', rows: 4, cols: 7, clues: [{ r: 1, c: 4, d: 5, n: 1 }] });
  const m = asMap(ruleSets('boxStarvesClue', P));
  assert.equal(m[`c${2 * 7 + 6}`], LOOP);                              // G3
  assert.equal(m[`c${3 * 7 + 5}`], LOOP);                              // F4
  assert.equal(m[`c${2 * 7 + 5}`], undefined, 'a box in the line itself is the arrow\'s box');
  const f = RULES.find((r) => r.id === 'boxStarvesClue').find(P, initialState(P), {}).find((x) => x.info.cell === 2 * 7 + 6);
  assert.deepEqual(f.info.dots, [2 * 7 + 5, 3 * 7 + 6]);
  assert.equal(f.info.most, 0);
  // with room to spare nothing fires
  assert.deepEqual(ruleSets('boxStarvesClue', compile({ name: 'ok', rows: 4, cols: 7, clues: [{ r: 0, c: 0, d: 5, n: 1 }] })), []);
});

test('boxStarvesClueByLines (Hard) follows a neighbour left with two ways out; boxStarvesClue (Medium) does not', () => {
  // a 1-arrow pointing left along the bottom row of a 3x5 board; (2,1) is on the loop. A box at (1,1) would leave (2,1) with only
  // (2,0) and (2,2) as ways out, so both become dots and the arrow has nothing left to shade.
  const P = compile({ name: 'bsc2', rows: 3, cols: 5, clues: [{ r: 2, c: 3, d: 3, n: 1 }] });
  const st = initialState(P);
  st.cell[2 * 5 + 1] = LOOP;
  assert.ok(!RULES.find((r) => r.id === 'boxStarvesClue').find(P, st, {}).some((x) => x.info.cell === 1 * 5 + 1), 'the dots next to the box are not enough');
  const fs = RULES.find((r) => r.id === 'boxStarvesClueByLines').find(P, st, {});
  const f = fs.find((x) => x.info.cell === 1 * 5 + 1);
  assert.ok(f, 'a box above the dot is ruled out');
  assert.deepEqual(f.info.dots, [2 * 5 + 0, 2 * 5 + 2]);
  assert.deepEqual(f.info.chain, [2 * 5 + 0, 2 * 5 + 2]);
  assert.deepEqual(f.info.through, [1 * 5 + 0, 2 * 5 + 1]);                  // the left-edge neighbour (1,0) forces (2,0) too
  // (2,1) is a dot-to-be even when unknown, since it touches the box; the same chain then shows without the starting dot
  const g = RULES.find((r) => r.id === 'boxStarvesClueByLines').find(P, initialState(P), {}).find((x) => x.info.cell === 1 * 5 + 1);
  assert.deepEqual(g.info.dots, [2 * 5 + 0, 2 * 5 + 1, 2 * 5 + 2]);
  assert.equal(RULES.find((r) => r.id === 'boxStarvesClue').tier, 'Medium');
  assert.equal(RULES.find((r) => r.id === 'boxStarvesClueByLines').tier, 'Hard');
});

test('lookahead hints: the shortest chain comes first, and shadeShortChain only takes short ones', () => {
  const P = compile({ name: 'sfl', rows: 5, cols: 4, clues: [{ r: 1, c: 2, d: 2, n: 1 }, { r: 0, c: 0, d: 2, n: 0 }] });
  const rule = (id) => RULES.find((r) => r.id === id);
  let checked = 0;
  for (const id of ['shadeForcesLines', 'shadeClosesLoop']) {
    const f = rule(id).find(P, initialState(P), {});
    for (let i = 1; i < f.length; i++) assert.ok(f[i - 1].info.forced < f[i].info.forced || (f[i - 1].info.forced === f[i].info.forced && f[i - 1].info.cell < f[i].info.cell), `${id}: shortest first`);
    checked += f.length;
  }
  const near = rule('shadeShortChain').find(P, initialState(P), {});
  assert.ok(near.every((f) => f.info.forced <= SHORT_CHAIN));
  // the capped rule is the unlimited ones restricted to short chains: every firing it has, one of them has too
  const all = ['shadeForcesLines', 'shadeClosesLoop'].flatMap((id) => rule(id).find(P, initialState(P), {})).map((f) => f.info.cell);
  for (const f of near) assert.ok(all.includes(f.info.cell));
  assert.ok(checked + near.length > 0);
  assert.ok(rule('shadeShortChain').weight < rule('shadeForcesLines').weight);
  // a chain you can follow by eye is a Medium-tier step, tried before boxStarvesClue
  assert.equal(rule('shadeShortChain').tier, 'Medium');
  assert.ok(HUMAN_ORDER.findIndex((r) => r.id === 'shadeShortChain') < HUMAN_ORDER.findIndex((r) => r.id === 'boxStarvesClue'));
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

test('pattern: facing clues with a part of known size fix the other parts (rangeFacingKnown)', () => {
  // A (col 1, right, 2) and B (col 5, left, 1) on 9 cells. The part right of B (cols 6-8) already holds a box at col 8 and
  // col 7 is its neighbour, so it holds exactly 1 (col 6 could hold one too, but then col 8 makes 2 and A's 2 needs the rest:
  // here we simply pre-place boxes so the right part is exact).
  const P = row(9, [[1, R, 2], [5, L, 1]]);
  const st = initialState(P);
  st.cell[7] = SHADED; st.cell[6] = LOOP; st.cell[8] = LOOP;      // right part holds exactly 1
  const m = asMap(ruleSets('rangeFacingKnown', P, st));
  // A needs 2 = between + 1, so between holds 1; B needs 1 = between + left, so nothing is left of A (col 0 is loop)
  assert.equal(m.c0, LOOP);
  assert.deepEqual(ruleSets('rangeFacing', P, st), [], 'the bounds version leaves exact cases to rangeFacingKnown');
  // and with nothing known, the bounds rule (not the known one) does the work
  const Q = row(8, [[1, R, 3], [4, L, 2]]);
  assert.deepEqual(ruleSets('rangeFacingKnown', Q), []);
  assert.ok(ruleSets('rangeFacing', Q).length > 0);
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
  for (const id of ['cluePlacements', 'placementDeadEnd', 'rangeSame', 'rangeFacingKnown', 'deadEndNeighbor', 'boxStarvesClue', 'boxStarvesClueByLines', 'shadeForcesLines']) {
    assert.ok(fired[id] > 0, `${id} never fired in the sample`);
  }
});

test('pattern: imagine a box, add the forced lines, a cell gets three lines (shadeForcesLines)', () => {
  // A 6x6 puzzle with three clues whose solve needs this rule (and nothing harder; the shorter contradictions go to shadeShortChain), found by search.
  const P = compile({ name: 'sfl', rows: 6, cols: 6, clues: [{ r: 2, c: 0, d: 1, n: 0 }, { r: 2, c: 2, d: 5, n: 1 }, { r: 5, c: 2, d: 0, n: 0 }] });
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

// Two positions where the first version of the solver was stuck (from tools/stuck_report.mjs: a generated puzzle minus one clue).
const stuckPuzzle = (name, rows, cols, clues) => compile({ name, rows, cols, clues: cluesFromString(clues) });
const upto = (id) => RULE_IDS.indexOf(id);
const cellIdx = (P, name) => (+name.slice(1) - 1) * P.cols + (name.charCodeAt(0) - 65);

const CLUES09 = [12, 12, '0:9:D:3;2:3:U:0;2:5:D:1;2:6:R:1;2:9:D:2;3:6:L:1;4:0:D:0;4:7:L:1;4:10:D:2;5:2:D:1;5:4:R:1;6:1:R:0;6:6:U:0;7:1:U:0;7:6:U:0;8:5:L:1;8:10:L:1;9:5:U:2;9:9:U:2;10:1:R:2;10:2:U:2'];
const CLUES23 = [10, 10, '0:2:R:1;0:7:L:1;2:4:R:1;2:5:D:3;3:2:D:2;3:8:L:2;4:5:L:2;4:7:L:2;5:4:R:2;5:9:D:2;7:6:U:0;8:2:U:3'];

test('pattern: a box would turn a neighbour into a dot whose two ways out close the loop early (closingNeighbor)', () => {
  const P = stuckPuzzle('d09', CLUES09[0], CLUES09[1], CLUES09[2]);
  // G10 and I10 are the two ends of one path; a box at H11 would make H10 a dot with just those two ways out
  const r = rate(P);
  assert.ok(r.solved && r.tier !== 'Expert');
  const step = r.steps.find((s) => s.rule === 'closingNeighbor' && s.sets.some(([k, i, v]) => k === 'c' && i === cellIdx(P, 'H11') && v === LOOP));
  assert.ok(step, 'the solver should find H11 with closingNeighbor');
  assert.equal(step.tier, 'Medium');
});

test('pattern: the only two open ends in a sealed-off area join each other (pairedEnds)', () => {
  const P = stuckPuzzle('d23', CLUES23[0], CLUES23[1], CLUES23[2]);
  // E4 and D5 are alone in their area, so they join: D7 and D6 become the ends of one path and cannot be joined
  const r = rate(P);
  assert.ok(r.solved && r.tier !== 'Expert');
  const d6 = cellIdx(P, 'D6');
  const step = r.steps.find((s) => s.rule === 'pairedEnds' && s.sets.some(([k, i, v]) => k === 'e' && i === 2 * d6 + 1 && v === E_OFF));
  assert.ok(step, 'the solver should rule out the segment D6-D7 with pairedEnds');
});

import { parseCsv, decodeSolution } from '../js/logic.js';
import { readFileSync } from 'node:fs';
import { FIRST_LOOKAHEAD } from '../js/rating.js';

test('the newer rules reach the stored solution on real generated puzzles (soundness on whole puzzles)', () => {
  // for each bonus book, its hardest puzzles (by stored score) that are not huge: books get rebuilt, so no names here
  const files = ['data/bonus-skinny.csv', 'data/bonus-longway-12x12.csv', 'data/bonus-nozeros-12x12.csv', 'data/bonus-onedir-12x12.csv'];
  let used = 0, checked = 0;
  for (const file of files) {
    const all = parseCsv(readFileSync(new URL('../' + file, import.meta.url), 'utf8')).filter((p) => p.rows * p.cols <= 260 && p.tier === 'Hard');
    all.sort((a, b) => b.score - a.score);
    for (const raw of all.slice(0, 3)) {
      const P = compile(raw), name = raw.name;
      const r = solvedByRules(P, FIRST_LOOKAHEAD);
      if (!r.solved) continue;          // a puzzle that needs trial and error is not what this test is about
      checked++;
      const sol = decodeSolution(P, raw.solution);
      for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) assert.equal(r.state.cell[i] === SHADED, sol.cell[i] === SHADED, `${name} cell ${i}`);
      for (let x = 0; x < P.numEdges; x++) assert.equal(r.state.e[x] === E_ON, sol.e[x] === E_ON, `${name} edge ${x}`);
      const c = rate(P).counts;
      used += (c.pairedEnds || 0) + (c.closingNeighbor || 0) + (c.segmentForcesLines || 0) + (c.placementDeadEnd || 0);
    }
  }
  assert.ok(checked >= 4, 'the sample should have puzzles in it');
  assert.ok(used > 3, 'the sample should actually use the newer rules');
});

const CLUES06 = [10, 10, '0:4:L:1;0:7:D:1;2:2:R:1;2:4:R:1;2:7:L:0;3:0:D:1;3:5:D:1;4:0:R:2;4:2:R:2;4:5:L:1;4:6:D:0;7:4:R:0;8:1:U:0;8:2:D:0;8:4:R:0;9:7:L:0'];

test('pairedEnds with several open ends: the two lines leaving the sealed-off area end up as one line', () => {
  // A1-D2 has open ends B1, B2 (one little path: they cannot join each other), A2 and D2: whatever the pairing, A2's line and D2's
  // line end up as one line. So its far ends cannot be joined to each other, D6 goes down, F7 and F8 cannot be joined, and H7, whose
  // only two ways out are the (virtual) ends H6 and I7 of one line, is a box.
  const P = stuckPuzzle('d06', CLUES06[0], CLUES06[1], CLUES06[2]);
  const r = rate(P);
  const steps = r.steps.filter((s) => s.rule === 'pairedEnds');
  const sets = steps.flatMap((s) => s.sets.map(([k, i, v]) => `${k}${i}=${v}`));
  const d6 = cellIdx(P, 'D6'), f7 = cellIdx(P, 'F7'), h7 = cellIdx(P, 'H7');
  assert.ok(sets.includes(`e${2 * d6}=${E_OFF}`) || sets.includes(`e${2 * d6 + 1}=${E_ON}`), 'D6 should be sent down');
  assert.ok(sets.includes(`e${2 * f7 + 1}=${E_OFF}`), 'F7-F8 should be ruled out');
  assert.ok(sets.includes(`c${h7}=${SHADED}`), 'H7 should be a box');
});

const CLUES03 = [16, 16, '0:7:R:1;0:10:L:0;0:14:L:0;1:2:D:1;1:3:D:0;1:4:D:2;2:2:R:1;2:13:D:3;3:4:L:1;3:12:L:3;4:2:L:1;4:7:D:4;4:8:L:1;4:13:D:2;4:15:L:1;5:6:R:3;6:4:D:2;6:10:D:1;7:3:R:4;7:8:L:2;7:9:L:2;7:12:D:0;7:14:D:0;8:1:U:1;8:8:U:0;8:11:L:0;10:2:R:1;10:5:U:2;10:13:U:3;11:11:L:2;11:12:U:0;12:2:R:0;12:9:L:0;12:15:U:3;13:4:U:1;13:6:R:0;13:11:L:0;14:9:L:1;15:2:U:1;15:13:U:3'];

test('uniqueness: a pairing that can be drawn two ways is not the real one (uniqueRoute)', () => {
  // A6, B6 above and A8, B8 below the dots A7, B7: joining A7 to B7 (up or down) could be swapped for the other, so A7 and B7 do not
  // join each other and both go up and down instead
  const P = stuckPuzzle('d03', CLUES03[0], CLUES03[1], CLUES03[2]);
  const r = rate(P);
  const step = r.steps.find((s) => s.rule === 'uniqueRoute');
  assert.ok(step, 'uniqueRoute should fire');
  const idx = (a, b) => { const i = cellIdx(P, a), j = cellIdx(P, b); return j === i + 1 ? 2 * i : 2 * i + 1; };
  const sets = Object.fromEntries(step.sets.filter(([k]) => k === 'e').map(([, x, v]) => [x, v]));
  assert.equal(sets[idx('A6', 'A7')], E_ON); assert.equal(sets[idx('A7', 'A8')], E_ON);
  assert.equal(sets[idx('B6', 'B7')], E_ON); assert.equal(sets[idx('B7', 'B8')], E_ON);
  assert.equal(sets[idx('A7', 'B7')], E_OFF);
});

test('rules that assume a unique solution are kept out of everything that treats "solved by the rules" as proof of uniqueness', () => {
  const first = RULE_IDS.indexOf(RULES.find((r) => r.lookahead).id);
  for (const r of RULES.filter((r) => r.assumesUnique)) assert.ok(RULE_IDS.indexOf(r.id) > first, r.id);
});

import { HUMAN_ORDER } from '../js/rating.js';
import { explainStep } from '../js/explain.js';

test('rangeSameOne: two same-direction clues with one cell between them (Beginner); rangeSame keeps the longer gaps', () => {
  // clue at 0 (right, 2) and clue at 2 (right, 1): the one cell between them holds 2 - 1 = 1 box
  assert.deepEqual(asMap(ruleSets('rangeSameOne', row(5, [[0, R, 2], [2, R, 1]]))), { c1: SHADED });
  // equal numbers: it holds none
  assert.deepEqual(asMap(ruleSets('rangeSameOne', row(5, [[0, R, 1], [2, R, 1]]))), { c1: LOOP });
  // two cells between them: that is rangeSame (Medium), not the special case
  assert.deepEqual(ruleSets('rangeSameOne', row(6, [[0, R, 2], [3, R, 1]])), []);
  assert.deepEqual(asMap(ruleSets('rangeSame', row(7, [[0, R, 2], [4, R, 0]]))), { c1: SHADED, c2: LOOP, c3: SHADED });
  assert.equal(RULES.find((r) => r.id === 'rangeSameOne').tier, 'Beginner');
});

test('the order a person meets the rules in: cheapest first, bookkeeping costs something, tiers as reviewed', () => {
  const w = HUMAN_ORDER.map((r) => r.weight);
  assert.deepEqual(w, [...w].sort((a, b) => a - b));
  const pos = (id) => HUMAN_ORDER.findIndex((r) => r.id === id);
  assert.ok(pos('shadedNeighbor') < pos('clueDone'));
  assert.ok(pos('forcedExits') < pos('noEarlyClose') && pos('noEarlyClose') < pos('tightCell'));   // the last Beginner rule
  assert.ok(pos('closingCell') < pos('tightCell') && pos('sameSegmentExits') < pos('tightCell'));   // the "don't close the loop early" rules are Beginner, like Nikoli's easy puzzles use them
  assert.ok(pos('rangeFacing') < pos('crossingParity') && pos('crossingParity') < pos('uniqueRoute') && pos('uniqueRoute') < pos('tryCell'));
  const tier = (id) => RULES.find((r) => r.id === id).tier;
  assert.equal(tier('noEarlyClose'), 'Beginner'); assert.equal(tier('closingCell'), 'Beginner'); assert.equal(tier('sameSegmentExits'), 'Beginner');
  assert.equal(tier('tightCell'), 'Medium'); assert.equal(tier('deadEndNeighbor'), 'Medium'); assert.equal(tier('rangeFacingKnown'), 'Medium');
  assert.equal(RULES.find((r) => r.id === 'forcedExits').weight, RULES.find((r) => r.id === 'deadEnd').weight);
  // every Hard rule costs more than every Medium rule
  const max = (t) => Math.max(...RULES.filter((r) => r.tier === t).map((r) => r.weight)), min = (t) => Math.min(...RULES.filter((r) => r.tier === t).map((r) => r.weight));
  assert.ok(min('Hard') > max('Medium') && min('Medium') > max('Beginner'));
  // bookkeeping shows up in a rating as steps with a price
  const P = compile({ name: 'b', rows: 3, cols: 3, clues: [{ r: 1, c: 1, d: 1, n: 0 }] });
  const r = rate(P);
  const book = r.steps.filter((s) => s.info && s.info.bookkeeping);
  assert.ok(book.length > 0 && book.every((s) => s.weight >= 1));
});

test('shadeClosesLoop and segmentClosesLoop are the "closes the loop early" halves of the forced-lines rules', () => {
  // books get rebuilt, so look for any puzzle in the bonus books that needs one of these rules
  let P = null, r = null;
  search: for (const f of ['bonus-nozeros-12x12', 'bonus-longway-12x12', 'bonus-onedir-12x12', 'bonus-zeros-12x12']) {
    for (const raw of parseCsv(readFileSync(new URL(`../data/${f}.csv`, import.meta.url), 'utf8')).filter((q) => q.rows * q.cols <= 260)) {
      const Q = compile(raw), q = rate(Q);
      if (q.counts.shadeClosesLoop || q.counts.segmentClosesLoop) { P = Q; r = q; break search; }
    }
  }
  assert.ok(P, 'some bonus puzzle should need shadeClosesLoop or segmentClosesLoop');
  const step = r.steps.find((s) => s.rule === 'shadeClosesLoop' || s.rule === 'segmentClosesLoop');
  assert.match(explainStep(P, step).text, /close the loop early/);
  for (const s of r.steps.filter((q) => q.rule === 'shadeForcesLines' || q.rule === 'segmentForcesLines')) assert.doesNotMatch(explainStep(P, s).text, /close the loop early/);
});

test('clueTight: a clue with exactly 2r-1 open cells puts its boxes on every other cell (Beginner)', () => {
  // 3 boxes, 5 cells to the right: boxes on cells 1, 3, 5
  assert.deepEqual(asMap(ruleSets('clueTight', row(6, [[0, R, 3]]))), { c1: SHADED, c2: LOOP, c3: SHADED, c4: LOOP, c5: SHADED });
  // 2 boxes in 4 cells: several placements, nothing forced here (cluePlacements territory)
  assert.deepEqual(ruleSets('clueTight', row(5, [[0, R, 2]])), []);
  // one box already placed at the far end (cells 4-6 are dots): the clue needs 2 more and has exactly 3 open cells left
  const P = row(8, [[0, R, 3]]);
  const st = initialState(P); st.cell[7] = SHADED; for (const i of [4, 5, 6]) st.cell[i] = LOOP;
  assert.deepEqual(asMap(ruleSets('clueTight', P, st)), { c1: SHADED, c2: LOOP, c3: SHADED });
  // several runs: 4 boxes, dots at 4 and 8 leave runs of 3 and 3 cells (room for 2 + 2): boxes on 1, 3, 5, 7
  const Q = row(9, [[0, R, 4]]);
  const stQ = initialState(Q); stQ.cell[4] = LOOP; stQ.cell[8] = LOOP;
  assert.deepEqual(asMap(ruleSets('clueTight', Q, stQ)), { c1: SHADED, c2: LOOP, c3: SHADED, c5: SHADED, c6: LOOP, c7: SHADED });
  // a run of even length is cluePlacements territory
  const E = row(9, [[0, R, 3]]);
  const stE = initialState(E); stE.cell[4] = LOOP;                                  // runs of 3 and 4 cells hold 2 + 2 >= 3: not tight
  assert.deepEqual(ruleSets('clueTight', E, stE), []);
  const r = RULES.find((q) => q.id === 'clueTight');
  assert.equal(r.tier, 'Beginner');
  assert.ok(r.weight < RULES.find((q) => q.id === 'cluePlacements').weight);
});

// ---- boxStarvesClueByPlacements: how many boxes a line has room for, counting the cells a box would starve
test('lineRoom: two cells one apart on a line cannot both be boxes when the cell between them would keep one way out', () => {
  // a 4x3 board: a 2-arrow at the top of the middle column, so its line is (1,1), (2,1), (3,1); a void beside the middle one, at (2,2)
  const P = compile({ name: 'room', rows: 4, cols: 3, clues: [{ r: 0, c: 1, d: 2, n: 2 }, { r: 2, c: 2, d: 0, n: -1 }] });
  assert.equal(lineRoom(P, initialState(P), 0).room, 1, 'rows 1 and 3 would leave (2,1) with only (2,0) as a way out');
  const open = compile({ name: 'open', rows: 4, cols: 3, clues: [{ r: 0, c: 1, d: 2, n: 2 }] });
  assert.equal(lineRoom(open, initialState(open), 0).room, 2, 'without the void the two ends of the line are fine');
});

// A 10x10 lattice-frame puzzle (found by search; arrows only on every third line, the rest of the border voids) where, once every cheaper rule
// has run, a box at I2 and the lines it forces leave a clue without room for its boxes, and nothing cheaper sees it.
const STARVED = '0:0:V:-1;0:1:V:-1;0:2:D:0;0:3:V:-1;0:4:V:-1;0:5:D:3;0:6:V:-1;0:7:V:-1;0:8:D:2;0:9:V:-1;1:0:V:-1;1:1:V:-1;1:9:V:-1;2:0:R:2;2:9:L:2;3:0:V:-1;3:5:V:-1;3:9:V:-1;4:0:V:-1;4:1:V:-1;4:4:V:-1;4:7:V:-1;4:9:V:-1;5:0:R:2;5:8:V:-1;5:9:L:2;6:0:V:-1;6:9:V:-1;7:0:V:-1;7:2:V:-1;7:9:V:-1;8:0:R:0;8:5:V:-1;8:9:L:0;9:0:V:-1;9:1:V:-1;9:2:U:0;9:3:V:-1;9:4:V:-1;9:5:U:3;9:6:V:-1;9:7:V:-1;9:8:U:2;9:9:V:-1';
test('boxStarvesClueByPlacements (Hard): a box and its forced lines leave a clue without room; found only after the cheaper rules stall', () => {
  const P = compile({ name: 'starved', rows: 10, cols: 10, clues: cluesFromString(STARVED) });
  assert.equal(solve(P, { limit: 2 }).count, 1, 'a unique puzzle');
  const rule = RULES.find((r) => r.id === 'boxStarvesClueByPlacements');
  assert.equal(rule.tier, 'Hard');
  const others = RULES.slice(0, FIRST_LOOKAHEAD).filter((r) => r.id !== rule.id).map((r) => r.id);
  const st = initialState(P);
  closure(P, st, others);                                            // every other rule first
  const fs = rule.find(P, st, {});
  assert.ok(fs.length >= 1, 'the rule fires');
  const sol = solve(P, { limit: 1 }).solutions[0];
  for (const f of fs) {
    assert.ok(f.info.need > f.info.room, 'the clue still needs more boxes than the line has room for');
    assert.equal(sol.cell[f.info.cell] === SHADED, false, 'the cell is a dot in the solution');
  }
});
