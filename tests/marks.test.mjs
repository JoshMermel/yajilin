import test from 'node:test';
import assert from 'node:assert/strict';
import { nextMark, EMPTY, BOX, DOT } from '../js/marks.js';

test('an unlined cell cycles empty -> dot -> box -> empty', () => {
  assert.equal(nextMark(EMPTY, false), DOT);
  assert.equal(nextMark(DOT, false), BOX);
  assert.equal(nextMark(BOX, false), EMPTY);
});

test('a lined cell skips the dot, whether or not a dot was there before the line', () => {
  assert.equal(nextMark(EMPTY, true), BOX);
  assert.equal(nextMark(DOT, true), BOX);
});
