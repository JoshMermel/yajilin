import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, solve } from '../js/logic.js';
import { rate, RULE_IDS } from '../js/rating.js';
import { explainStep, describeMarks } from '../js/explain.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

test('every step of every rated puzzle can be explained', () => {
  const rand = rng(31337);
  const seen = new Set();
  let puzzles = 0;
  for (let t = 0; t < 30000 && puzzles < 60; t++) {
    const rows = 4 + ((rand() * 2) | 0), cols = 4 + ((rand() * 3) | 0), n = 2 + ((rand() * 5) | 0);
    const cells = [...Array(rows * cols).keys()], clues = [];
    for (let k = 0; k < n; k++) {
      const i = cells.splice((rand() * cells.length) | 0, 1)[0];
      clues.push({ r: (i / cols) | 0, c: i % cols, d: (rand() * 4) | 0, n: (rand() * 3) | 0 });
    }
    const P = compile({ name: 'x', rows, cols, clues });
    if (solve(P, { limit: 2 }).count !== 1) continue;
    puzzles++;
    for (const step of rate(P).steps) {
      if (step.info && step.info.bookkeeping) continue;   // bookkeeping is charged but has nothing to show
      const e = explainStep(P, step);
      seen.add(step.rule);
      assert.ok(e.text.length > 20 && !/undefined|NaN/.test(e.text), `${step.rule}: ${e.text}`);
      assert.ok(describeMarks(e.targets).length > 0, `${step.rule} marks nothing`);
      assert.ok(e.sourceCells.every((c) => c >= 0 && c < P.N), step.rule);
    }
  }
  assert.ok(puzzles >= 30, `only ${puzzles} puzzles`);
  // the common rules must all have been explained at least once
  for (const id of ['clueDone', 'clueFull', 'shadedNeighbor', 'deadEnd', 'forcedExits', 'deadEndNeighbor', 'noEarlyClose']) {
    assert.ok(seen.has(id), `${id} never occurred`);
  }
  assert.ok(RULE_IDS.length > 0);
});

test('a lookahead step says how many lines the box forces and hands the board those lines to draw dashed', async () => {
  const { compile, initialState, cluesFromString } = await import('../js/logic.js');
  const { nextStep, applySets } = await import('../js/rating.js');
  // (a book puzzle that still needs a short chain after the Medium rules)
  const P = compile({ name: 'sfl', rows: 8, cols: 8, clues: cluesFromString('1:5:U:0;2:5:L:1;2:7:D:1;3:0:U:0;3:2:U:0;3:3:U:1;4:0:R:1;5:2:U:1;6:4:D:0;6:5:R:0;7:0:R:0;7:7:L:0') });
  const st = initialState(P);
  let seen = null;
  for (let g = 0; g < 200 && !seen; g++) {
    const step = nextStep(P, st);
    if (!step) break;
    if (step.rule === 'shadeShortChain') seen = { step, at: JSON.parse(JSON.stringify({ ...st, cell: Array.from(st.cell), e: Array.from(st.e) })) };
    else applySets(st, step.sets);
  }
  assert.ok(seen, 'the puzzle needs a short-chain step');
  const e = explainStep(P, seen.step, { ...st, cell: Uint8Array.from(seen.at.cell), e: Int8Array.from(seen.at.e) });
  assert.match(e.text, /would force \d+ line segments? \(dashed\)/);
  assert.ok(e.chain.length > 0 && e.chain.every((x) => x >= 0 && x < P.numEdges));
  assert.equal(explainStep(P, seen.step).chain.length, 0, 'without a position there is nothing to draw');
});

test('boxStarvesClueByLines talks about the lines the box forces, dashed', async () => {
  const { compile, initialState, LOOP } = await import('../js/logic.js');
  const { RULES } = await import('../js/rating.js');
  // a 1-arrow pointing left along the bottom row of a 3x5 board, with B3 on the loop: a box at B2 would force A3-B3 and B3-C3
  const P = compile({ name: 'bsc2', rows: 3, cols: 5, clues: [{ r: 2, c: 3, d: 3, n: 1 }] });
  const st = initialState(P); st.cell[2 * 5 + 1] = LOOP;
  const f = RULES.find((r) => r.id === 'boxStarvesClueByLines').find(P, st, {}).find((x) => x.info.cell === 1 * 5 + 1);
  const e = explainStep(P, { rule: 'boxStarvesClueByLines', info: f.info, sets: f.sets }, st);
  assert.match(e.text, /^A box at B2 would force the dashed lines, which violates the 1← clue at D3\.$/);
  assert.ok(e.chain.length >= 2 && e.chain.every((x) => x >= 0 && x < P.numEdges));
});

test('a box whose forced lines give a cell three lines draws just those lines: A4 gives B5 three lines', async () => {
  const fs = await import('node:fs');
  const { compile, parseCsv, initialState, edgeCells, SHADED, LOOP, E_ON } = await import('../js/logic.js');
  const { nextMarkableStep } = await import('../js/hintstep.js');
  const raw = parseCsv(fs.readFileSync(new URL('../data/sparse-8x8-both.csv', import.meta.url), 'utf8')).find((p) => p.name === 'SPARSE-8X8-BOTH-29');
  const P = compile(raw);
  const cells = new Uint8Array(P.N), edges = new Uint8Array(P.numEdges);
  for (const i of P.boxIdx) cells[i] = 1;
  let text = null, c2 = null;
  for (let n = 0; n < 300 && !(text && c2); n++) {                    // press Hint and mark the first firing, as a player does
    const st = initialState(P);
    for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) { if (cells[i] === 1) st.cell[i] = SHADED; else if (cells[i] === 2) st.cell[i] = LOOP; }
    for (let x = 0; x < P.numEdges; x++) if (edges[x]) st.e[x] = E_ON;
    const nx = nextMarkableStep(P, st);
    if (!nx) break;
    const f = nx.res.firings[0];
    const e = explainStep(P, { rule: nx.res.rule, tier: nx.res.tier, weight: nx.res.weight, sets: f.sets, info: f.info }, st);
    if (/^A box at C2 would force/.test(e.text)) c2 = e;
    if (/^A box at A4 would force/.test(e.text)) { text = e.text; 
      const names = e.chain.map((x) => edgeCells(P, x).map((c) => `${'ABCDEFGH'[c % 8]}${((c / 8) | 0) + 1}`).sort().join('-')).sort();
      assert.deepEqual(names, ['A5-B5', 'B4-B5'], 'only the two lines into B5: the partner lines of B4 and A5 are not needed');
      assert.deepEqual(e.roles.problem, [P.cols * 4 + 1], 'B5 is the trouble spot'); }
    for (const [k, i, v] of f.sets) { if (k === 'c') cells[i] = v === SHADED ? 1 : 2; else if (v === E_ON) edges[i] = 1; }
  }
  assert.ok(text, 'the A4 hint comes up');
  assert.ok(c2, 'the C2 hint comes up');
  // C2 forces nine segments, but the contradiction (A2 and B3 full, so A3 has one way out) rests on four of them: only those are drawn
  assert.match(c2.text, /^A box at C2 would force 4 line segments \(dashed\), which would put two lines in A2 and B3\. A3 could not join them/);
  assert.equal(c2.chain.length, 4);
  assert.match(text, /would force 2 line segments \(dashed\), which would give B5 three lines\.$/);
});

test('boxStarvesClueByPlacements says what the clue still needs against the room its line has, and draws the forced lines dashed', async () => {
  const { RULES, closure, FIRST_LOOKAHEAD } = await import('../js/rating.js');
  const { initialState, cluesFromString } = await import('../js/logic.js');
  const S = '0:0:V:-1;0:1:V:-1;0:2:D:0;0:3:V:-1;0:4:V:-1;0:5:D:3;0:6:V:-1;0:7:V:-1;0:8:D:2;0:9:V:-1;1:0:V:-1;1:1:V:-1;1:9:V:-1;2:0:R:2;2:9:L:2;3:0:V:-1;3:5:V:-1;3:9:V:-1;4:0:V:-1;4:1:V:-1;4:4:V:-1;4:7:V:-1;4:9:V:-1;5:0:R:2;5:8:V:-1;5:9:L:2;6:0:V:-1;6:9:V:-1;7:0:V:-1;7:2:V:-1;7:9:V:-1;8:0:R:0;8:5:V:-1;8:9:L:0;9:0:V:-1;9:1:V:-1;9:2:U:0;9:3:V:-1;9:4:V:-1;9:5:U:3;9:6:V:-1;9:7:V:-1;9:8:U:2;9:9:V:-1';
  const P = compile({ name: 's', rows: 10, cols: 10, clues: cluesFromString(S) });
  const rule = RULES.find((r) => r.id === 'boxStarvesClueByPlacements');
  const st = initialState(P);
  closure(P, st, RULES.slice(0, FIRST_LOOKAHEAD).filter((r) => r.id !== rule.id).map((r) => r.id));
  const f = rule.find(P, st, {})[0];
  const ex = explainStep(P, { rule: rule.id, info: f.info, sets: f.sets }, st);
  assert.match(ex.text, /^A box at I2 would force the dashed lines, and then the 2→ clue at A3 could not fit its boxes: it would still need 2 more boxes, but only D3 is left open on its line\.$/);
  assert.ok(ex.chain.length > 0, 'the forced lines are drawn dashed');
  assert.deepEqual(ex.roles.focus, [f.info.cell]);
});
