import test from 'node:test';
import assert from 'node:assert/strict';
import { makeColorKeeper, assignPathColors } from '../js/pathcolors.js';

// a 1 x 12 strip: edge x joins cell x and cell x+1
const N = 12;
const recolor = (keeper, on) => {
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a]; return a; };
  on.forEach((v, x) => { if (v) { const a = find(x), b = find(x + 1); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); } });
  const colorOf = assignPathColors(keeper, on, (x) => find(x), 8);
  return (x) => colorOf.get(find(x));
};
const draw = (on, ...xs) => { for (const x of xs) on[x] = 1; };

test('a new line does not recolor existing lines', () => {
  const k = makeColorKeeper(N), on = new Uint8Array(N);
  draw(on, 0, 1); let c = recolor(k, on);
  const a = c(0);
  draw(on, 5); c = recolor(k, on);
  const b = c(5);
  assert.notEqual(a, b);
  draw(on, 8, 9); c = recolor(k, on);
  assert.equal(c(0), a); assert.equal(c(5), b);
  assert.ok(new Set([c(0), c(5), c(8)]).size === 3);
  // growing a line (even one that was started later) leaves every color alone
  draw(on, 6); c = recolor(k, on);
  assert.equal(c(0), a); assert.equal(c(5), b);
});

test('joining two lines keeps the color of the one that was started first', () => {
  const k = makeColorKeeper(N), on = new Uint8Array(N);
  draw(on, 5); recolor(k, on);          // the first line: cells 5-6
  draw(on, 1); let c = recolor(k, on);  // the second: cells 1-2
  const first = c(5), second = c(1);
  assert.notEqual(first, second);
  draw(on, 2, 3, 4); c = recolor(k, on); // join them by drawing 2-3, 3-4, 4-5
  assert.equal(c(1), first); assert.equal(c(5), first);
  // and the other way round: the line on the left was started first
  const k2 = makeColorKeeper(N), on2 = new Uint8Array(N);
  draw(on2, 1); recolor(k2, on2);
  draw(on2, 5); let c2 = recolor(k2, on2);
  const left = c2(1);
  draw(on2, 2, 3, 4); c2 = recolor(k2, on2);
  assert.equal(c2(5), left);
});

test('erasing a segment splits a line into two colors, and reset starts afresh', () => {
  const k = makeColorKeeper(N), on = new Uint8Array(N);
  draw(on, 1, 2, 3, 4); let c = recolor(k, on);
  const col = c(1);
  on[3] = 0; c = recolor(k, on);          // cells 1-2-3 and 4-5 are separate now
  assert.equal(c(1), col);
  assert.notEqual(c(4), col);
  on.fill(0); recolor(k, on);
  draw(on, 7); c = recolor(k, on);
  assert.equal(c(7), 0);
});

test('merging or splitting lines never recolors a line that was not touched (random strips, including a palette too small for the lines)', () => {
  // regression for "merging two lines recolors an unrelated one": once colors had to be shared the old keeper reshuffled them
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const M = 60;
  for (const palette of [3, 8]) {
    for (let trial = 0; trial < 200; trial++) {
      const keeper = makeColorKeeper(M), on = new Uint8Array(M);
      const lines = () => {
        const parent = Array.from({ length: M }, (_, i) => i);
        const find = (a) => { while (parent[a] !== a) a = parent[a]; return a; };
        on.forEach((v, x) => { if (v) { const a = find(x), b = find(x + 1); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); } });
        const colorOf = assignPathColors(keeper, on, (x) => find(x), palette);
        const m = new Map();
        on.forEach((v, x) => { if (v) { const r = find(x); if (!m.has(r)) m.set(r, []); m.get(r).push(x); } });
        return new Map([...m].map(([r, xs]) => [xs.join(','), colorOf.get(r)]));
      };
      let before = lines();
      for (let step = 0; step < 80; step++) {
        const x = (rnd() * (M - 1)) | 0;
        on[x] = on[x] ? 0 : 1;
        const after = lines();
        for (const [key, c] of after) if (before.has(key)) assert.equal(c, before.get(key), `palette ${palette}, trial ${trial}, step ${step}: line ${key} changed color`);
        before = after;
      }
    }
  }
});

// ---- near: a new line takes the color that suits where it is (a rows x cols board; segment x joins cell x >> 1 and the cell after / below it)
const R = 12, C = 12;
const edge = (r1, c1, r2, c2) => ((r1 * C + c1) << 1) | (r2 > r1 ? 1 : 0);   // the segment between two neighboring cells (the first is above / left)
const makeBoard = () => ({ keeper: makeColorKeeper(R * C * 2), on: new Uint8Array(R * C * 2) });
function recolor2d(b, palette, near) {
  const parent = Array.from({ length: R * C }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  b.on.forEach((v, x) => { if (v) { const a = x >> 1, c = (x & 1) ? a + C : a + 1, ra = find(a), rc = find(c); if (ra !== rc) parent[Math.max(ra, rc)] = Math.min(ra, rc); } });
  const colorOf = assignPathColors(b.keeper, b.on, (x) => find(x >> 1), palette, near);
  return (r, c) => colorOf.get(find(r * C + c));
}
const identity = () => ({ cols: C, alike: (i, j) => (i === j ? 1 : 0) });
const grid = (palette, alike) => ({ cols: C, alike });

test('near: with a free color, the lowest free color is still taken (as without near)', () => {
  const b = makeBoard(), near = identity();
  b.on[edge(0, 0, 0, 1)] = 1; let c = recolor2d(b, 6, near);
  assert.equal(c(0, 0), 0);
  b.on[edge(5, 5, 5, 6)] = 1; c = recolor2d(b, 6, near);
  assert.equal(c(5, 5), 1);                 // far away, but a color nobody uses is still better than sharing
});

test('near: when the colors run out, the repeat goes far from the line that has that color', () => {
  const b = makeBoard(), near = identity();
  b.on[edge(0, 0, 0, 1)] = 1; recolor2d(b, 2, near);          // color 0 at the top left
  b.on[edge(0, 4, 0, 5)] = 1; recolor2d(b, 2, near);          // color 1, close to it
  b.on[edge(10, 10, 10, 11)] = 1; let c = recolor2d(b, 2, near);   // a third line, far from both: no color is free
  // color 0 is 10 cells away at the top left, color 1 is 10 cells away at (0,4): equal-ish; now one in between decides
  b.on[edge(0, 2, 1, 2)] = 1; c = recolor2d(b, 2, near);      // a fourth, right between the first two (distance 1 and 2): crowded either way
  assert.ok([0, 1].includes(c(0, 2)));
  // and a fifth beside color 1's line and away from color 0's takes color 0
  b.on[edge(1, 5, 1, 6)] = 1; c = recolor2d(b, 2, near);
  assert.equal(c(1, 5), c(0, 0));
});

test('near: a color that looks like a neighbor\'s is the worse choice among the free ones', () => {
  const alike = (i, j) => (i === j ? 1 : (i + j === 1 ? 0.6 : 0));   // colors 0 and 1 look alike; 2 is different from both
  const b = makeBoard(), near = grid(3, alike);
  b.on[edge(5, 5, 5, 6)] = 1; let c = recolor2d(b, 3, near);
  assert.equal(c(5, 5), 0);
  b.on[edge(5, 8, 5, 9)] = 1; c = recolor2d(b, 3, near);          // 3 cells away: color 1 is free but looks like 0, color 2 is free and different
  assert.equal(c(5, 8), 2);
});

test('near: the other half of a split line gets a color unlike its sibling, and nothing else changes', () => {
  const b = makeBoard(), near = identity();
  for (const [r1, c1, r2, c2] of [[3, 3, 3, 4], [3, 4, 3, 5], [3, 5, 3, 6]]) b.on[edge(r1, c1, r2, c2)] = 1;
  let c = recolor2d(b, 4, near); const col = c(3, 3);
  b.on[edge(5, 0, 5, 1)] = 1; c = recolor2d(b, 4, near); const other = c(5, 0);
  b.on[edge(3, 4, 3, 5)] = 0; c = recolor2d(b, 4, near);          // 3,3-3,4 and 3,5-3,6 are two lines now
  assert.equal(c(3, 3), col); assert.equal(c(5, 0), other);
  assert.notEqual(c(3, 5), col);
  assert.notEqual(c(3, 5), other);                                 // a free color exists, so it is used
});

test('near: on a crowded board with too few colors, lines that touch or nearly touch seldom share a color (and far better than without near)', () => {
  const rng = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  const palette = 5, trials = 30;
  let withNear = 0, without = 0;
  for (let t = 0; t < trials; t++) {
    const segs = [];
    for (let i = 0; i < 26; i++) {                       // 26 short lines at random places, drawn one at a time
      const r = (rng() * R) | 0, c = (rng() * (C - 1)) | 0;
      segs.push(edge(r, c, r, c + 1));
    }
    for (const near of [identity(), null]) {
      const b = makeBoard(); let col;
      for (const x of segs) { b.on[x] = 1; col = recolor2d(b, palette, near); }
      // count pairs of different lines (each a single segment here, or merged) within two cells that share a color
      const cells = [...new Set(segs)].map((x) => [(x >> 1) / C | 0, (x >> 1) % C]);
      let clash = 0;
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
        const [r1, c1] = cells[i], [r2, c2] = cells[j];
        const close = Math.min(...[0, 1].flatMap((d1) => [0, 1].map((d2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 + d1 - c2 - d2)))));
        if (close <= 2 && col(r1, c1) !== undefined && col(r1, c1) === col(r2, c2) && (r1 !== r2 || Math.abs(c1 - c2) > 1)) clash++;
      }
      if (near) withNear += clash; else without += clash;
    }
  }
  console.log(`      near clashes ${withNear} vs ${without} without (over ${trials} boards of 26 lines, 5 colors)`);
  assert.ok(withNear < without * 0.5, `${withNear} should be well below ${without}`);
});

test('near on a hex board: distance follows the six neighbours, and a repeat goes to the far line', async () => {
  const { compile, hexDistance } = await import('../js/logic.js');
  assert.equal(hexDistance(0, 0, 0, 3), 3);
  assert.equal(hexDistance(0, 0, 2, 0), 2);
  const P = compile({ rows: 5, cols: 12, grid: 'hex', clues: [], name: 't' });
  const on = new Uint8Array(P.numEdges), keeper = makeColorKeeper(P.numEdges);
  const edgeBetween = (a, b) => { for (let x = 0; x < P.numEdges; x++) if ((P.edgeA[x] === a && P.edgeB[x] === b) || (P.edgeA[x] === b && P.edgeB[x] === a)) return x; throw new Error('no edge'); };
  const parent = Array.from({ length: P.N }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) a = parent[a]; return a; };
  const near = { cols: P.cols, alike: (i, j) => (i === j ? 1 : 0), ends: (x) => [P.edgeA[x], P.edgeB[x]], dist: hexDistance };
  const draw = (a, b) => { on[edgeBetween(a, b)] = 1; parent[Math.max(find(a), find(b))] = Math.min(find(a), find(b)); return assignPathColors(keeper, on, (x) => find(P.edgeA[x]), 2, near); };
  draw(0, 1);                                     // colour 0 at the top left
  draw(8, 9);                                     // colour 1, 8 cells along the top
  const c = draw(5 * 0 + 12 + 1, 12 + 2);         // row 1: a third line, no colour free; it sits right under the first line
  assert.equal(c.get(find(13)), c.get(find(8)));  // so it takes the colour of the far line
});
