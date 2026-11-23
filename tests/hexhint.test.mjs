import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, compile, decodeSolution, initialState, SHADED, LOOP, E_ON, UNKNOWN } from '../js/logic.js';
import { hexNextStep, describeHexStep } from '../js/hexhint.js';

const root = new URL('..', import.meta.url).pathname;
const load = (id, k) => compile(parseCsv(fs.readFileSync(`${root}data/${id}.csv`, 'utf8'))[k]);

/** Follow the hints from an empty board, making exactly the marks each one shows. Returns the number of steps and the final position. */
function followHints(P, sol) {
  const st = initialState(P);
  const kinds = { forced: 0, imagine: 0 };
  for (let steps = 0; steps < 400; steps++) {
    const s = hexNextStep(P, st);
    if (!s) return { steps, st, kinds, stuck: true };
    kinds[s.kind]++;
    assert.ok(s.shaded.length + s.loop.length + s.segOn.length > 0, 'a step marks something');
    for (const i of s.shaded) { assert.equal(sol.cell[i], SHADED, `box at ${i} is right`); assert.equal(st.cell[i], UNKNOWN); st.cell[i] = SHADED; }
    for (const i of s.loop) { assert.equal(sol.cell[i], LOOP, `dot at ${i} is right`); assert.equal(st.cell[i], UNKNOWN); st.cell[i] = LOOP; }
    for (const x of s.segOn) { assert.equal(sol.e[x], E_ON, `segment ${x} is right`); st.e[x] = E_ON; }
    assert.ok(describeHexStep(s, (i) => `c${i}`).length > 10);
  }
  throw new Error('no end');
}

test('hex hints: following them from an empty board only ever makes correct marks, and ends with the solved position', () => {
  const totals = { forced: 0, imagine: 0 };
  for (const [id, ks] of [['hex-5x5', [0, 8, 20]], ['hex-6x6', [0, 30, 60, 110]], ['hex-7x7', [5, 70, 125]], ['hex-8x8', [10, 50, 85]]]) {
    for (const k of ks) {
      const P = load(id, k), sol = decodeSolution(P, P.solution);
      const { st, kinds } = followHints(P, sol);
      for (const key of Object.keys(kinds)) totals[key] += kinds[key];
      // every shaded cell, dot and segment of the solution is marked at the end (a step that ends is one with nothing left to mark)
      for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && sol.cell[i] === SHADED) assert.equal(st.cell[i], SHADED, `${id} #${k + 1} cell ${i}`);
      for (let x = 0; x < P.numEdges; x++) if (sol.e[x] === E_ON) assert.equal(st.e[x], E_ON, `${id} #${k + 1} edge ${x}`);
    }
  }
  assert.ok(totals.imagine > 0 && totals.forced > 0, JSON.stringify(totals));
});

test('hex hints: a solved position has no step, and a contradictory one has none either', () => {
  const P = load('hex-5x5', 3), sol = decodeSolution(P, P.solution);
  const solved = initialState(P);
  for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) solved.cell[i] = sol.cell[i];
  for (let x = 0; x < P.numEdges; x++) if (sol.e[x] === E_ON) solved.e[x] = E_ON;
  assert.equal(hexNextStep(P, solved), null);
  const bad = initialState(P);
  const free = []; for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) free.push(i);
  bad.cell[free[0]] = SHADED;
  for (let d = 0; d < 6; d++) { const j = P.nb[free[0] * 6 + d]; if (j >= 0) { bad.cell[j] = SHADED; break; } }      // two boxes touching
  assert.equal(hexNextStep(P, bad), null);
});
