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

// ---- the ring on both ends of the line under the pointer (js/lineends.js)
{
  const { otherEnd } = await import('../js/lineends.js');
  // a 4x4 board with no clues: edge 2a joins cell a to the right, 2a+1 joins it to the one below
  const P = { cols: 4, rows: 4, N: 16, numEdges: 32 };
  const draw = (...pairs) => { const e = new Uint8Array(32); for (const [a, b] of pairs) e[b === a + 1 ? 2 * a : 2 * a + 1] = 1; return e; };

  test('otherEnd: the far end of a plain line, from either end', () => {
    const e = draw([0, 1], [1, 2], [2, 6], [6, 10]);      // 0 - 1 - 2, down to 6, down to 10
    assert.equal(otherEnd(P, e, 0), 10);
    assert.equal(otherEnd(P, e, 10), 0);
  });
  test('otherEnd: nothing for the middle of a line, a lone cell, a closed loop or an empty board', () => {
    const e = draw([0, 1], [1, 2]);
    assert.equal(otherEnd(P, e, 1), -1);
    assert.equal(otherEnd(P, e, 5), -1);
    assert.equal(otherEnd(P, draw([0, 1], [1, 5], [4, 5], [0, 4]), 0), -1);
    assert.equal(otherEnd(P, new Uint8Array(32), 0), -1);
  });
  test('otherEnd: nothing when the line branches (more than two ends)', () => {
    const e = draw([0, 1], [1, 2], [1, 5]);               // a T: three ends
    for (const end of [0, 2, 5]) assert.equal(otherEnd(P, e, end), -1);
  });
  test('the board rings both ends under the pointer, and nothing during a drag or on a branch', () => {
    const el = stubEl(), b = new Board(el, {});
    b.setPuzzle(P);
    const marks = { cells: new Uint8Array(16), edges: draw([0, 1], [1, 2]), auto: new Uint8Array(16) };
    const info = { clueState: [], badShaded: new Set() };
    P.clueAt = new Int32Array(16).fill(-1); P.clues = []; P.rays = [];
    b.render(marks, info);
    assert.equal(count(el.innerHTML, /class="line-end"/g), 0);
    b.hoverCell = 0; b.render(marks, info);
    assert.equal(count(el.innerHTML, /class="line-end"/g), 2);
    b.hoverCell = 1; b.render(marks, info);
    assert.equal(count(el.innerHTML, /class="line-end"/g), 0);
    b.hoverCell = 0; b.gesture = {}; b.render(marks, info);
    assert.equal(count(el.innerHTML, /class="line-end"/g), 0);
    b.gesture = null; marks.edges = draw([0, 1], [1, 2], [1, 5]); b.render(marks, info);
    assert.equal(count(el.innerHTML, /class="line-end"/g), 0);
  });
}
