import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, hexStep, decodeSolution, SHADED, E_ON } from '../js/logic.js';
import { clueStates } from '../js/clues.js';
import { makeRng } from '../js/generator.js';
import { generateHex } from '../js/generator_hex.js';

globalThis.document = globalThis.document || { createElementNS: () => ({}) };
const { Board } = await import('../js/board.js');
const stubEl = () => ({ innerHTML: '', addEventListener() {}, querySelector() { return null; }, getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; } });
const count = (s, re) => (s.match(re) || []).length;

const P = compile({ name: 'h', grid: 'hex', rows: 5, cols: 4, clues: [{ r: 1, c: 1, d: 5, n: 1 }, { r: 3, c: 2, d: 3, n: 0 }, { r: 0, c: 3, d: 0, n: -1 }] });

test('hex board: the cell under the centre of every hexagon is that cell, and a point far outside is none', () => {
  const b = new Board(stubEl(), {});
  b.setPuzzle(P);
  for (let r = 0; r < P.rows; r++) for (let c = 0; c < P.cols; c++) {
    const [x, y] = b.hexCenter(r, c);
    assert.equal(b.hexCellAt(x, y), r * P.cols + c);
    // a point a little off the centre (still well inside the hexagon) is the same cell
    assert.equal(b.hexCellAt(x + 6, y - 5), r * P.cols + c);
  }
  assert.equal(b.hexCellAt(-30, -30), -1);
  assert.equal(b.hexCellAt(1000, 1000), -1);
});

test('hex board: adjacent() is exactly the six neighbours (and does not wrap round the edge of a row)', () => {
  const b = new Board(stubEl(), {});
  b.setPuzzle(P);
  for (let a = 0; a < P.N; a++) {
    const want = new Set();
    for (let d = 0; d < 6; d++) { const [r, c] = hexStep((a / P.cols) | 0, a % P.cols, d); if (r >= 0 && c >= 0 && r < P.rows && c < P.cols) want.add(r * P.cols + c); }
    for (let z = 0; z < P.N; z++) assert.equal(b.adjacent(a, z), want.has(z), `${a} - ${z}`);
  }
});

test('hex board: the markup has a hexagon per cell, per clue, per box, and a line per segment', () => {
  const el = stubEl(), b = new Board(el, {});
  b.setPuzzle(P);
  const marks = { cells: new Uint8Array(P.N), edges: new Uint8Array(P.numEdges), auto: new Uint8Array(P.N) };
  marks.cells[0] = 1; marks.cells[7] = 1; marks.cells[17] = 2;
  const edge = P.ed[8 * 6 + 0];                               // cell 8 (a loop cell): its east segment
  marks.edges[edge] = 1;
  b.render(marks, { clueState: clueStates(P, marks), badShaded: new Set() });
  const s = el.innerHTML;
  assert.equal(count(s, /<polygon class="clue-bg/g), 2, 'two arrows');
  assert.equal(count(s, /<polygon class="void-bg/g), 1, 'one void');
  assert.equal(count(s, /<polygon class="shaded/g), 2);
  assert.equal(count(s, /<circle class="dot/g), 1);
  assert.equal(count(s, /<line class="seg"/g), 1);
  assert.equal(count(s, /class="axis-label/g), P.rows + P.cols);
  assert.ok(/class="frame"/.test(s));
});

test('hex generator: a 6x6 puzzle has one solution, falls to propagation plus lookahead, and its solution passes the checker', async () => {
  const { solve, checkSolved } = await import('../js/logic.js');
  const { probe } = await import('../js/generator_hex.js');
  let made = 0;
  for (let k = 1; k <= 4 && made < 2; k++) {
    const g = generateHex(6, 6, makeRng(k), { budgetMs: 30000 });
    if (g.fail) continue;
    made++;
    const Q = g.puzzle;
    const r = solve(Q, { limit: 2 });
    assert.equal(r.count, 1);
    assert.ok(probe(Q).level >= 0, 'solvable by propagation and one-step lookahead');
    const sol = decodeSolution(Q, Q.solution);
    assert.ok(checkSolved(Q, Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0)), sol.e));
    assert.ok(g.arrows.size >= 1 && g.holes.size > g.arrows.size - 1);
    assert.ok([...Q.solution].every((ch) => ch !== undefined));
    assert.equal([...Q.solution].filter((ch) => ch === '#').length, g.arrows.size);
    // no two boxes touch, and no arrow cell is a box
    const boxes = [...Q.solution].map((ch, i) => (ch === 'x' ? i : -1)).filter((i) => i >= 0);
    for (const i of boxes) for (let d = 0; d < 6; d++) assert.ok(!boxes.includes(Q.nb[i * 6 + d]));
  }
  assert.ok(made >= 1, 'at least one of four seeds makes a puzzle');
});
