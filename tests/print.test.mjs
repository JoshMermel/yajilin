import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, compile, decodeSolution, SHADED, E_ON } from '../js/logic.js';
import { parseSelection, layoutFor, planPrint, boardSvg, SIZES, PAGE, SITE_URL, SITE_TEXT, MAX_PRINT } from '../js/print.js';

const root = new URL('..', import.meta.url).pathname;
const load = (id) => parseCsv(fs.readFileSync(`${root}data/${id}.csv`, 'utf8')).map(compile);

test('parseSelection: ranges, lists, spaces around dashes, and clear errors', () => {
  assert.deepEqual(parseSelection('1-3, 7', 10).ids, [1, 2, 3, 7]);
  assert.deepEqual(parseSelection('5 - 6 2', 10).ids, [2, 5, 6]);
  assert.deepEqual(parseSelection('3,3,3-4', 10).ids, [3, 4]);
  assert.match(parseSelection('', 10).error, /Enter the puzzles/);
  assert.match(parseSelection('abc', 10).error, /isn't a puzzle number/);
  assert.match(parseSelection('0', 10).error, /1 to 10/);
  assert.match(parseSelection('9-11', 10).error, /1 to 10/);
  assert.match(parseSelection('5-3', 10).error, /backwards/);
  assert.match(parseSelection(`1-${MAX_PRINT + 1}`, MAX_PRINT + 5).error, /at most/);
});

test('the site is named in the booklet: the header link goes to the real play URL, and so does the README', () => {
  assert.equal(SITE_URL, 'https://joshmermelstein.com/yajilin/');
  assert.equal(SITE_TEXT, 'joshmermelstein.com/yajilin');
  assert.ok(fs.readFileSync(`${root}README.md`, 'utf8').includes(SITE_URL));
});

test('layout: boards are placed by cell size, and bigger boards mean fewer per page', () => {
  const small = layoutFor(load('bonus-intro').slice(0, 4), SIZES.comfortable.puzzle);         // 5x5 boards
  const big = layoutFor(load('bonus-longway').slice(0, 4), SIZES.comfortable.puzzle);         // 10x10 and up
  assert.ok(small.perPage > big.perPage, `${small.perPage} vs ${big.perPage}`);
  assert.ok(layoutFor(load('bonus-longway').slice(0, 4), SIZES.compact.puzzle).perPage >= big.perPage);
  assert.equal(small.cols * small.rows, small.perPage);
});

test('every puzzle of every shipped book fits on a page at both sizes, with cells big enough to read', () => {
  const manifest = JSON.parse(fs.readFileSync(`${root}data/manifest.json`, 'utf8'));
  for (const b of manifest.books) {
    const ps = load(b.id);
    // the biggest board of the book on its own (the layout is set by the biggest board)
    const biggest = ps.reduce((m, p) => (p.rows * p.cols > m.rows * m.cols ? p : m));
    for (const size of Object.keys(SIZES)) {
      const L = layoutFor([biggest], SIZES[size].puzzle);
      assert.ok(L.cellMm >= 3.9, `${b.id} ${size}: cells ${L.cellMm.toFixed(2)} mm`);
      assert.ok(L.cols >= 1 && L.rows >= 1 && L.perPage >= 1);
      assert.ok(biggest.cols * L.cellMm <= PAGE.w + 1e-6 && biggest.rows * L.cellMm <= PAGE.h - PAGE.head + 1e-6, `${b.id} ${size}: does not fit`);
    }
  }
});

test('planPrint counts the pages of the puzzles and of the answer key', () => {
  const ps = load('bonus-intro');
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  const none = planPrint({ puzzles: ps, ids, keyIds: [], size: 'comfortable' });
  assert.equal(none.keyPages, 0);
  assert.equal(none.puzzlePages, Math.ceil(30 / none.perPage));
  const withKey = planPrint({ puzzles: ps, ids, keyIds: ids, size: 'comfortable' });
  assert.ok(withKey.keyPerPage >= withKey.perPage, 'answers are drawn smaller, so at least as many fit');
  assert.equal(withKey.keyPages, Math.ceil(30 / withKey.keyPerPage));
});

test('boardSvg: every clue has its number and an arrow; the answer adds the boxes and exactly the loop', () => {
  for (const P of load('bonus-longway').slice(0, 3).concat(load('bonus-skinny').slice(0, 2))) {
    const blank = boardSvg(P);
    assert.equal((blank.match(/class="num"/g) || []).length, P.clues.length);
    assert.equal((blank.match(/class="arrow"/g) || []).length, P.clues.length);
    assert.equal((blank.match(/class="clue"/g) || []).length, P.clues.length);
    assert.ok(!/class="loop"/.test(blank), 'the puzzle itself shows no loop');
    const sol = decodeSolution(P, P.solution);
    const ans = boardSvg(P, sol);
    let boxes = 0, segs = 0;
    for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && sol.cell[i] === SHADED) boxes++;
    for (let x = 0; x < P.numEdges; x++) if (sol.e[x] === E_ON) segs++;
    assert.equal((ans.match(/class="box"/g) || []).length, boxes);
    assert.equal((ans.match(/class="loop"/g) || []).length, segs);
    for (const n of P.clues.map((c) => c.n)) assert.ok(blank.includes(`>${n}</text>`));
    assert.ok(blank.startsWith('<svg') && blank.endsWith('</svg>'));
  }
});

test('pre-placed boxes are drawn on the puzzle itself, not only in the answer', () => {
  const P = compile({ name: 'x', rows: 4, cols: 4, clues: [{ r: 0, c: 0, d: 1, n: 0 }], boxes: [{ r: 2, c: 2 }] });
  assert.equal((boardSvg(P).match(/class="box"/g) || []).length, 1);
});

test('a void cell prints as a darker cell with a cross, no number and no arrow, and it is not counted as a clue', () => {
  const P = compile({ name: 'v', rows: 3, cols: 4, clues: [{ r: 0, c: 0, d: 1, n: 1 }, { r: 1, c: 2, d: 0, n: -1 }] });
  const svg = boardSvg(P);
  assert.equal((svg.match(/class="void"/g) || []).length, 1);
  assert.equal((svg.match(/class="void-x"/g) || []).length, 1);
  assert.equal((svg.match(/class="clue"/g) || []).length, 1, 'only the real arrow is a clue cell');
  assert.equal((svg.match(/class="num"/g) || []).length, 1);
  assert.equal((svg.match(/class="arrow"/g) || []).length, 1);
});
