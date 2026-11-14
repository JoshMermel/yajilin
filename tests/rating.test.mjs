import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, solve, initialState, SHADED, LOOP, E_ON, E_OFF, UNKNOWN } from '../js/logic.js';
import { rate, RULES, RULE_IDS, nextStep, closure, contradiction, TIERS } from '../js/rating.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function randomPuzzle(rand, rows, cols, nClues, maxN = 3) {
  const cells = [];
  for (let i = 0; i < rows * cols; i++) cells.push(i);
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
