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
  for (const id of ['clueDone', 'clueFull', 'shadedNeighbor', 'deadEnd', 'forcedExits', 'imagine', 'noEarlyClose']) {
    assert.ok(seen.has(id), `${id} never occurred`);
  }
  assert.ok(RULE_IDS.length > 0);
});

test('a lookahead step says how many lines the box forces and hands the board those lines to draw dashed', async () => {
  const { compile, initialState, cluesFromString } = await import('../js/logic.js');
  const { nextStep, applySets, RULES } = await import('../js/rating.js');
  // (a book puzzle that still needs a chain after the Medium rules: the position where the solver first has to imagine something; the old
  // short-chain rule, still in the table for the generator's solvability check, finds a firing there)
  const P = compile({ name: 'sfl', rows: 8, cols: 8, clues: cluesFromString('1:5:U:0;2:5:L:1;2:7:D:1;3:0:U:0;3:2:U:0;3:3:U:1;4:0:R:1;5:2:U:1;6:4:D:0;6:5:R:0;7:0:R:0;7:7:L:0') });
  const st = initialState(P);
  for (let g = 0; g < 300; g++) {
    const step = nextStep(P, st);
    if (!step || step.rule.startsWith('imagine')) break;
    applySets(st, step.sets);
  }
  const f = RULES.find((r) => r.id === 'shadeShortChain').find(P, st, {})[0];
  assert.ok(f, 'the puzzle needs a short-chain step');
  const step = { rule: 'shadeShortChain', info: f.info, sets: f.sets };
  const e = explainStep(P, step, st);
  assert.match(e.text, /would force \d+ line segments? \(dashed\)/);
  assert.ok(e.chain.length > 0 && e.chain.every((x) => x >= 0 && x < P.numEdges));
  assert.equal(explainStep(P, step).chain.length, 0, 'without a position there is nothing to draw');
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

test('an imagined box or dot is told step by step, the lines it forces are drawn dashed, and the chain ends in what breaks', async () => {
  const fs = await import('node:fs');
  const { compile, parseCsv, initialState, SHADED, LOOP, E_ON } = await import('../js/logic.js');
  const { nextMarkableStep } = await import('../js/hintstep.js');
  const raw = parseCsv(fs.readFileSync(new URL('../data/sparse-8x8-both.csv', import.meta.url), 'utf8')).find((p) => p.name === 'SPARSE-8X8-BOTH-29');
  const P = compile(raw);
  const cells = new Uint8Array(P.N), edges = new Uint8Array(P.numEdges);
  for (const i of P.boxIdx) cells[i] = 1;
  const imagined = [];
  for (let n = 0; n < 300; n++) {                                     // press Hint and mark the first firing, as a player does
    const st = initialState(P);
    for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) { if (cells[i] === 1) st.cell[i] = SHADED; else if (cells[i] === 2) st.cell[i] = LOOP; }
    for (let x = 0; x < P.numEdges; x++) if (edges[x]) st.e[x] = E_ON;
    const nx = nextMarkableStep(P, st);
    if (!nx) break;
    const f = nx.res.firings[0];
    const e = explainStep(P, { rule: nx.res.rule, tier: nx.res.tier, weight: nx.res.weight, sets: f.sets, info: f.info }, st);
    if (nx.res.rule.startsWith('imagine')) imagined.push({ e, f });
    for (const [k, i, v] of f.sets) { if (k === 'c') cells[i] = v === SHADED ? 1 : 2; else if (v === E_ON) edges[i] = 1; }
  }
  assert.ok(imagined.length > 0, 'the puzzle needs an imagined box or dot');
  for (const { e, f } of imagined) {
    const word = f.info.hyp === 'box' ? 'a box' : 'a dot';
    assert.match(e.text, new RegExp(`^Imagine ${word} at [A-Z]\\d+(: .+)?, and then .+\\. So [A-Z]\\d+ is a ${f.info.hyp === 'box' ? 'dot' : 'box'}\\.$`), e.text);
    assert.deepEqual(e.roles.focus, [f.info.cell]);
    assert.ok(e.chain.every((x) => x >= 0 && x < P.numEdges));
    if (/\(dashed\)/.test(e.text)) assert.ok(e.chain.length > 0, 'the dashed lines are handed to the board');
  }
});

test('boxStarvesClueByPlacements says what the clue still needs against the room its line has, and draws the forced lines dashed', async () => {
  const { RULES, closure, FIRST_LOOKAHEAD } = await import('../js/rating.js');
  const { initialState, cluesFromString } = await import('../js/logic.js');
  const S = '0:0:V:-1;0:1:V:-1;0:2:D:0;0:3:V:-1;0:4:V:-1;0:5:D:3;0:6:V:-1;0:7:V:-1;0:8:D:2;0:9:V:-1;1:0:V:-1;1:1:V:-1;1:9:V:-1;2:0:R:2;2:9:L:2;3:0:V:-1;3:5:V:-1;3:9:V:-1;4:0:V:-1;4:1:V:-1;4:4:V:-1;4:7:V:-1;4:9:V:-1;5:0:R:2;5:8:V:-1;5:9:L:2;6:0:V:-1;6:9:V:-1;7:0:V:-1;7:2:V:-1;7:9:V:-1;8:0:R:0;8:5:V:-1;8:9:L:0;9:0:V:-1;9:1:V:-1;9:2:U:0;9:3:V:-1;9:4:V:-1;9:5:U:3;9:6:V:-1;9:7:V:-1;9:8:U:2;9:9:V:-1';
  const P = compile({ name: 's', rows: 10, cols: 10, clues: cluesFromString(S) });
  const rule = RULES.find((r) => r.id === 'boxStarvesClueByPlacements');
  const st = initialState(P);
  const NEW_RULES = ['dotShortChain', 'dotForcesLines', 'twoEndsJoin', 'shadeFewLines', 'segmentShortChain', 'parityPocket', 'segmentStarvesClue', 'chokepoint', 'chokepointArea'];   // (they would get there first)
  closure(P, st, RULES.slice(0, FIRST_LOOKAHEAD).filter((r) => r.id !== rule.id && !NEW_RULES.includes(r.id)).map((r) => r.id));
  const f = rule.find(P, st, {})[0];
  const ex = explainStep(P, { rule: rule.id, info: f.info, sets: f.sets }, st);
  assert.match(ex.text, /^A box at I2 would force the dashed lines, and then the 2→ clue at A3 could not fit its boxes: it would still need 2 more boxes, but only D3 is left open on its line\.$/);
  assert.ok(ex.chain.length > 0, 'the forced lines are drawn dashed');
  assert.deepEqual(ex.roles.focus, [f.info.cell]);
});
