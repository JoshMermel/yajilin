import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, UNKNOWN, LOOP, E_OFF, compile, solve, checkSolved, decodeSolution, cluesToString, cluesFromString, parseCsv, toCsv, puzzleHash, symmetryKey, SHADED, E_ON } from '../js/logic.js';
import { RULES, RULE_IDS } from '../js/rating.js';
import { generatePuzzle, makeRng } from '../js/generator.js';
import { boardSvg } from '../js/print.js';
import { explainStep } from '../js/explain.js';
import { rate } from '../js/rating.js';
import { referenceCount } from './reference_solver.mjs';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const OPS = ['=', '>=', '<=', '!='];

function randomPuzzle(rand, rows, cols, nClues, hex = false) {
  const cells = Array.from({ length: rows * cols }, (_, i) => i), clues = [];
  for (let k = 0; k < nClues; k++) {
    const i = cells.splice((rand() * cells.length) | 0, 1)[0];
    const op = OPS[(rand() * 4) | 0];
    clues.push({ r: (i / cols) | 0, c: i % cols, d: (rand() * (hex ? 6 : 4)) | 0, n: (rand() * 3) | 0, ...(op === '=' ? {} : { op }) });
  }
  return compile({ name: 'rand', rows, cols, clues, ...(hex ? { grid: 'hex' } : {}) });
}

test('the solver agrees with the brute-force reference when clues say at least, at most or not n', () => {
  const rand = rng(4242), seen = { 0: 0, 1: 0, many: 0 };
  for (let t = 0; t < 400; t++) {
    const rows = 3 + ((rand() * 2) | 0), cols = 3 + ((rand() * 3) | 0);
    const P = randomPuzzle(rand, rows, cols, 1 + ((rand() * 4) | 0));
    const want = referenceCount(P), { count } = solve(P, { limit: 1000 });
    assert.equal(count, want, `${cluesToString(P.clues)} on ${rows}x${cols}`);
    seen[want > 1 ? 'many' : want]++;
  }
  assert.ok(seen[0] > 5 && seen[1] > 5 && seen.many > 5, JSON.stringify(seen));
});

test('the same on a hex board', () => {
  const rand = rng(99), seen = { 0: 0, 1: 0, many: 0 };
  for (let t = 0; t < 200; t++) {
    const P = randomPuzzle(rand, 3, 3 + ((rand() * 2) | 0), 1 + ((rand() * 3) | 0), true);
    const want = referenceCount(P), { count } = solve(P, { limit: 1000 });
    assert.equal(count, want, cluesToString(P.clues, true));
    seen[want > 1 ? 'many' : want]++;
  }
  assert.ok(seen[0] > 3 && seen[1] > 3, JSON.stringify(seen));
});

test('checkSolved judges each operator against a real solution', () => {
  // a 4x4 board, one clue at the corner looking down the left column: take a solution, then ask what each operator says about it
  const base = compile({ name: 't', rows: 4, cols: 4, clues: [{ r: 0, c: 0, d: 2, n: 1 }] });
  const sol = solve(base, { limit: 1 }).solutions[0];
  const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
  let have = 0; for (const i of base.rays[0]) have += shaded[i];
  const check = (op, n) => checkSolved(compile({ name: 't', rows: 4, cols: 4, clues: [{ r: 0, c: 0, d: 2, n, ...(op ? { op } : {}) }] }), shaded, sol.e);
  assert.equal(have, 1);
  assert.ok(check(null, 1) && check('>=', 1) && check('>=', 0) && check('<=', 1) && check('<=', 2) && check('!=', 0) && check('!=', 2));
  assert.ok(!check(null, 0) && !check('>=', 2) && !check('<=', 0) && !check('!=', 1));
});

test('clue strings, CSV, hashes and symmetry keys carry the operator', () => {
  const clues = [{ r: 0, c: 1, d: 1, n: 2, op: '>=' }, { r: 1, c: 0, d: 0, n: 1, op: '<=' }, { r: 2, c: 2, d: 3, n: 0, op: '!=' }, { r: 3, c: 3, d: 2, n: 1 }];
  const text = cluesToString(clues);
  assert.match(text, /^0:1:\w:>=2;1:0:\w:<=1;2:2:\w:!=0;3:3:\w:1$/);
  assert.deepEqual(cluesFromString(text), clues);
  const P = { name: 'x', rows: 4, cols: 4, clues, solution: '', rules: '', tier: '', score: null, boxes: [] };
  assert.deepEqual(parseCsv(toCsv([P]))[0].clues, clues);
  const plain = { ...P, clues: clues.map(({ op, ...rest }) => rest) };
  assert.notEqual(puzzleHash(P), puzzleHash(plain));
  assert.notEqual(symmetryKey(P), symmetryKey(plain));
  assert.throws(() => cluesFromString('0:0:U:>>2'));
  assert.throws(() => compile({ name: 'v', rows: 2, cols: 2, clues: [{ r: 0, c: 0, d: 0, n: -1, op: '>=' }] }));
});

test('every human rule is sound on partial positions of puzzles with at-least, at-most and not clues', () => {
  const rand = rng(31337), upto = RULE_IDS.indexOf('tryCell'), fired = {};
  let positions = 0, lookPositions = 0;
  for (let t = 0; t < 20000 && positions < 500; t++) {
    const rows = 4 + ((rand() * 3) | 0), cols = 4 + ((rand() * 3) | 0), oneRow = t % 3 === 0;
    const P = oneRow ? randomPuzzle(rand, 3, 6, 2 + ((rand() * 3) | 0)) : randomPuzzle(rand, rows, cols, 3 + ((rand() * 6) | 0));
    const first = solve(P, { limit: 1 });
    if (!first.count) continue;
    const sol = first.solutions[0], st = initialState(P);
    for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN && rand() < 0.25) st.cell[i] = sol.cell[i];
    for (let x = 0; x < P.numEdges; x++) {
      const a = P.edgeA[x], b = P.edgeB[x];
      if (P.clueAt[a] >= 0 || P.clueAt[b] >= 0) continue;
      if (rand() < 0.15) st.e[x] = sol.e[x] === E_ON ? E_ON : E_OFF;
    }
    const consistent = solve(P, { limit: 200, state: st }).solutions;
    assert.ok(consistent.length >= 1);
    positions++;
    const doLookahead = P.N <= 30 && lookPositions < 40;
    if (doLookahead) lookPositions++;
    for (const rule of RULES) {
      if (rule.lookahead && !doLookahead) continue;
      for (const f of rule.find(P, st, { upto })) {
        fired[rule.id] = (fired[rule.id] || 0) + 1;
        for (const [kind, idx, v] of f.sets) {
          for (const sol2 of consistent) {
            const actual = kind === 'c' ? sol2.cell[idx] : (sol2.e[idx] === E_ON ? E_ON : E_OFF);
            assert.equal(actual, v, `${rule.id} sets ${kind}${idx}=${v} but a solution has ${actual}: ${cluesToString(P.clues)} ${P.rows}x${P.cols}`);
          }
        }
      }
    }
  }
  console.log(`    ${positions} positions; firings: ${JSON.stringify(fired)}`);
  for (const id of ['clueDone', 'clueFull', 'clueNot', 'cluePlacements']) assert.ok(fired[id] > 0, `${id} never fired in the sample`);
});

test('the generator makes unique puzzles with at-least, at-most and not clues, and they rate, print and explain', () => {
  let made = 0;
  for (let seed = 1; seed <= 6 && made < 3; seed++) {
    const g = generatePuzzle(6, 6, makeRng(seed), { name: `i${seed}`, ops: { ge: 0.3, le: 0.3, ne: 0.2 }, minOps: 2, budgetMs: 20000 });
    if (!g) continue;
    const P = g.puzzle;
    made++;
    assert.ok(P.clues.filter((c) => c.op).length >= 2);
    assert.equal(solve(P, { limit: 2 }).count, 1, 'unique');
    const sol = decodeSolution(P, P.solution);
    assert.ok(checkSolved(P, Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0))));
    const svg = boardSvg(P, sol);
    for (const c of P.clues) if (c.op) assert.ok(svg.includes({ '>=': '≥', '<=': '≤', '!=': '≠' }[c.op]), 'the sign is printed');
    const r = rate(P);
    assert.ok(r.solved);
    let st = initialState(P);
    for (const step of r.steps) { assert.ok(explainStep(P, step, st).text); if (step.sets) for (const [kind, idx, v] of step.sets) { if (kind === 'c') st.cell[idx] = v; else st.e[idx] = v; } }
  }
  assert.ok(made >= 2, 'the generator produced puzzles');
});
