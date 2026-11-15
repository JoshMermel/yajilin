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
