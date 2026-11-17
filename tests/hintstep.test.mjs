import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, compile, initialState, decodeSolution, checkSolved, SHADED, LOOP, E_ON } from '../js/logic.js';
import { nextSteps, applySets } from '../js/rating.js';
import { nextMarkableStep, isMarkable } from '../js/hintstep.js';

const root = new URL('..', import.meta.url).pathname;
const load = (id) => parseCsv(fs.readFileSync(`${root}data/${id}.csv`, 'utf8')).map(compile);

// the player's marks as a solver position, the way main.js builds it: shaded, dot and segment only (there is no "no segment" mark)
const marksToState = (P, m) => {
  const st = initialState(P);
  for (let i = 0; i < P.N; i++) { if (P.clueAt[i] >= 0) continue; if (m.cells[i] === 1) st.cell[i] = SHADED; else if (m.cells[i] === 2) st.cell[i] = LOOP; }
  for (let x = 0; x < P.numEdges; x++) if (m.edges[x]) st.e[x] = E_ON;
  return st;
};
const blank = (P) => ({ cells: new Uint8Array(P.N), edges: new Uint8Array(P.numEdges) });
// what a player does with the step that is shown: marks the first firing's boxes, dots and segments (the rest of the step they cannot mark)
const follow = (m, firing) => { for (const [kind, idx, v] of firing.sets) { if (kind === 'c') m.cells[idx] = v === SHADED ? 1 : v === LOOP ? 2 : m.cells[idx]; else if (v === E_ON) m.edges[idx] = 1; } };

test('isMarkable: a box, a dot or a segment is something to mark; ruling out a segment alone is not', () => {
  assert.equal(isMarkable({ sets: [['e', 3, 2]] }) || false, false, 'E_OFF only');
  assert.equal(isMarkable({ sets: [['c', 3, SHADED]] }), true);
  assert.equal(isMarkable({ sets: [['c', 3, LOOP]] }), true);
  assert.equal(isMarkable({ sets: [['e', 3, E_ON]] }), true);
  assert.equal(isMarkable({ sets: [['e', 3, 2], ['e', 4, E_ON]] }), true, 'mixed');
});

test('following the hint always makes progress and finishes the puzzle (the old hint repeated a "no segment" step forever)', () => {
  let silentSeen = 0, solved = 0, total = 0;
  for (const P of [...load('bonus-intro').slice(0, 30), ...load('8x8').slice(0, 25)]) {
    total++;
    const m = blank(P);
    let done = false;
    for (let step = 0; step < 600 && !done; step++) {
      const st = marksToState(P, m);
      const first = nextSteps(P, marksToState(P, m));
      const r = nextMarkableStep(P, st);
      assert.ok(r, `${P.name}: the hint has a step while the puzzle is unfinished`);
      if (first && !first.firings.some(isMarkable)) silentSeen++;
      assert.ok(r.res.firings.every(isMarkable), 'only steps with something to mark are shown');
      const before = JSON.stringify([...m.cells, ...m.edges]);
      follow(m, r.res.firings[0]);
      assert.notEqual(JSON.stringify([...m.cells, ...m.edges]), before, `${P.name}: the hint made no progress`);
      done = checkSolved(P, Uint8Array.from(m.cells, (v) => (v === 1 ? 1 : 0)), m.edges);
    }
    if (done) solved++;
  }
  assert.ok(silentSeen > 0, 'the test must meet at least one cheapest-step-is-silent position, or it proves nothing');
  assert.equal(solved, total, `${solved} of ${total} solved by following the hints`);
});

test('a silent step is skipped, reported as background, and the step that follows is shown', () => {
  let found = 0;
  outer: for (const P of load('bonus-intro').concat(load('8x8').slice(0, 40))) {
    const m = blank(P);
    for (let step = 0; step < 300; step++) {
      const probe = marksToState(P, m);
      const raw = nextSteps(P, probe);
      if (!raw) break;
      const st = marksToState(P, m);
      const r = nextMarkableStep(P, st);
      if (!r) break;
      if (!raw.firings.some(isMarkable)) {
        found++;
        assert.ok(r.background.length >= 1);
        assert.match(r.background[0].text, /./);
        assert.ok(r.background.every((b) => b.targets.segOn.length === 0 && b.targets.shaded.length === 0 && b.targets.loop.length === 0), 'background steps are silent ones only');
        assert.notEqual(r.res.rule + JSON.stringify(r.res.firings[0].sets), raw.rule + JSON.stringify(raw.firings[0].sets));
        break outer;
      }
      assert.equal(r.background.length, 0, 'nothing skipped when the cheapest step is markable');
      assert.equal(r.res.rule, raw.rule);
      follow(m, r.res.firings[0]);
    }
  }
  assert.equal(found, 1, 'found a position where the cheapest step is silent');
});

test('when there is nothing left to say (a finished board) there is no step', () => {
  const P = load('8x8')[0];
  const sol = decodeSolution(P, P.solution);
  const st = initialState(P);
  for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) st.cell[i] = sol.cell[i];
  for (let x = 0; x < P.numEdges; x++) st.e[x] = sol.e[x];
  assert.equal(nextSteps(P, st), null, 'precondition: the solver has nothing to add either');
  assert.equal(nextMarkableStep(P, st), null);
});

test('reliesOn names only the skipped facts a step needs, not every fact passed on the way', async () => {
  const { reliesOn } = await import('../js/hintstep.js');
  let withBackground = 0, kept = 0, dropped = 0, total = 0;
  for (const P of load('8x8').slice(0, 25).concat(load('voidsonly-corpus').slice(0, 20))) {
    const m = blank(P);
    for (let step = 0; step < 400; step++) {
      const st = marksToState(P, m);
      const r = nextMarkableStep(P, st);
      if (!r) break;
      for (const f of r.res.firings) {
        const used = reliesOn(P, st, r.res.rule, f, r.background);
        assert.ok(used.every((b) => r.background.includes(b)), 'only skipped facts are named');
        if (r.background.length) { withBackground++; kept += used.length; dropped += r.background.length - used.length; }
      }
      total++;
      follow(m, r.res.firings[0]);
    }
  }
  assert.ok(withBackground > 0, 'met steps that come after skipped facts');
  assert.ok(dropped > 0, `some skipped facts are not needed by the step shown (kept ${kept}, dropped ${dropped} over ${total} steps)`);
});
