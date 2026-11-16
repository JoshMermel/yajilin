import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, compile, decodeSolution, SHADED, E_ON } from '../js/logic.js';
import { clueStates } from '../js/clues.js';

// Board draws into an element's innerHTML; a stub element is enough to look at the markup it produces.
globalThis.document = globalThis.document || { createElementNS: () => ({}) };
const { Board } = await import('../js/board.js');

const root = new URL('..', import.meta.url).pathname;
const stubEl = () => ({ innerHTML: '', addEventListener() {}, querySelector() { return null; }, getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; } });

function markup(P, solved = false) {
  const el = stubEl(), b = new Board(el, {});
  b.setPuzzle(P);
  const marks = { cells: new Uint8Array(P.N), edges: new Uint8Array(P.numEdges), auto: new Uint8Array(P.N) };
  if (solved) {
    const sol = decodeSolution(P, P.solution);
    for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && sol.cell[i] === SHADED) marks.cells[i] = 1;
    for (let x = 0; x < P.numEdges; x++) if (sol.e[x] === E_ON) marks.edges[x] = 1;
  }
  b.render(marks, { clueState: clueStates(P, marks), badShaded: new Set() });
  return el.innerHTML;
}
const count = (s, re) => (s.match(re) || []).length;

test('the board has one background rect, not one per blank cell, and still one rect per clue cell', () => {
  const P = compile(parseCsv(fs.readFileSync(`${root}data/20x36.csv`, 'utf8'))[0]);
  const s = markup(P);
  assert.equal(count(s, /class="cell-bg"/g), 1);
  assert.equal(count(s, /class="clue-bg/g), P.clues.length);
  // the one rect covers exactly the grid
  assert.match(s, /<rect class="cell-bg" x="4" y="4" width="880" height="1584"\/>/);
  assert.ok(s.length < 100 * 1024, `20x36 markup is ${Math.round(s.length / 1024)} KB`);
});

test('a drawn solution still has every segment and box', () => {
  const P = compile(parseCsv(fs.readFileSync(`${root}data/12x12.csv`, 'utf8'))[0]);
  const sol = decodeSolution(P, P.solution);
  let segs = 0, boxes = 0;
  for (let x = 0; x < P.numEdges; x++) if (sol.e[x] === E_ON) segs++;
  for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && sol.cell[i] === SHADED) boxes++;
  const s = markup(P, true);
  assert.equal(count(s, /class="seg"/g), segs);
  assert.equal(count(s, /class="shaded/g), boxes);
});
