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
  const { compile, initialState } = await import('../js/logic.js');
  const { nextStep, applySets } = await import('../js/rating.js');
  const P = compile({ name: 'sfl', rows: 5, cols: 4, clues: [{ r: 1, c: 2, d: 2, n: 1 }, { r: 0, c: 0, d: 2, n: 0 }] });
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
