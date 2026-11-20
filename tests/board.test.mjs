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

test('hovering an arrow, or tapping it on a touch screen, tints the cells it counts in; open cells stronger than decided ones', () => {
  const P = compile(parseCsv(fs.readFileSync(`${root}data/bonus-intro.csv`, 'utf8'))[2]);
  const k = P.clues.findIndex((c) => c.n >= 0 && P.rays[P.clues.indexOf(c)].length >= 2);
  const cell = P.clues[k].r * P.cols + P.clues[k].c, ray = P.rays[k];
  const el = stubEl(), b = new Board(el, {});
  b.setPuzzle(P);
  const marks = { cells: new Uint8Array(P.N), edges: new Uint8Array(P.numEdges), auto: new Uint8Array(P.N) };
  const draw = () => { b.render(marks, { clueState: clueStates(P, marks), badShaded: new Set() }); return el.innerHTML; };
  assert.equal(count(draw(), /class="hover-ray/g), 0, 'nothing tinted at rest');
  b.hoverCell = cell;
  assert.equal(count(draw(), /class="hover-ray"/g), ray.length, 'hover: every open cell of the line');
  b.hoverCell = -1;
  marks.cells[ray[0]] = 1;
  b.pinned = cell;
  const s = draw();
  assert.equal(count(s, /class="hover-ray decided"/g), 1, 'a box in the line is tinted fainter');
  assert.equal(count(s, /class="hover-ray"/g), ray.length - 1);
  // tap or click: the arrow pins it, again clears, a tap outside the line clears
  b.pinned = -1;
  b.pinArrow({ start: cell, mouse: true });
  assert.equal(b.pinned, cell, 'a mouse click pins too (hover shows it only while the pointer is there)');
  b.pinArrow({ start: cell, mouse: true });
  assert.equal(b.pinned, -1, 'and a second click clears it');
  b.pinArrow({ start: cell, mouse: false });
  assert.equal(b.pinned, cell);
  b.pinArrow({ start: ray[0], mouse: false });
  assert.equal(b.pinned, cell, 'tapping a cell of the line keeps it');
  const outside = [...Array(P.N).keys()].find((i) => P.clueAt[i] < 0 && !ray.includes(i));
  b.pinArrow({ start: outside, mouse: false });
  assert.equal(b.pinned, -1, 'tapping a cell outside the line clears it');
  b.pinArrow({ start: cell, mouse: false });
  b.pinArrow({ start: cell, mouse: false });
  assert.equal(b.pinned, -1, 'tapping the arrow again clears it');
});
