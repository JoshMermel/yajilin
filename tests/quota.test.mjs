import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBySize, sizeKey, normSize } from '../tools/quota.mjs';

const mk = (rows, cols, score, tag) => ({ rows, cols, score, tag });
const pool = (rows, cols, n) => Array.from({ length: n }, (_, i) => mk(rows, cols, i * 10, `${rows}x${cols}#${i}`));
const count = (ps, key) => ps.filter((p) => sizeKey(p) === key).length;

test('sizes are compared whichever way round they are written', () => {
  assert.equal(normSize('36x4'), '4x36');
  assert.equal(sizeKey(mk(36, 4)), '4x36');
});

test('an even share from each wanted size; other sizes are ignored', () => {
  const ps = [...pool(10, 10, 50), ...pool(12, 12, 50), ...pool(14, 14, 50), ...pool(9, 11, 50)];
  const got = pickBySize(ps, ['10x10', '12x12', '14x14'], 99);
  assert.equal(got.length, 99);
  for (const k of ['10x10', '12x12', '14x14']) assert.equal(count(got, k), 33);
  assert.equal(count(got, '9x11'), 0);
});

test('a size that is short hands its unused share to the others', () => {
  const ps = [...pool(10, 10, 9), ...pool(12, 12, 46), ...pool(14, 14, 20)];
  const got = pickBySize(ps, ['10x10', '12x12', '14x14'], 100);
  assert.equal(got.length, 75);                      // 9 + 46 + 20: not enough, and the book says so rather than padding
  const big = pickBySize([...ps, ...pool(12, 12, 40)], ['10x10', '12x12', '14x14'], 100);
  assert.equal(big.length, 100);
  assert.equal(count(big, '10x10'), 9);
  assert.equal(count(big, '14x14'), 20);
  assert.equal(count(big, '12x12'), 71);
});

test('thinning inside a size keeps the spread of scores and never repeats a puzzle', () => {
  const got = pickBySize(pool(10, 10, 40), ['10x10'], 10);
  assert.equal(new Set(got.map((p) => p.tag)).size, 10);
  const scores = got.map((p) => p.score);
  assert.ok(scores[0] <= 50 && scores[9] >= 300, scores.join(','));
});
