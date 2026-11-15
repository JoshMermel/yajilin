import test from 'node:test';
import assert from 'node:assert/strict';
import { makeGrace } from '../js/grace.js';

const S = (...k) => new Set(k);

test('something newly bad waits instead of showing', () => {
  const g = makeGrace();
  const r = g.update(S('c1'));
  assert.deepEqual([...r.show], []);
  assert.deepEqual([...r.waiting], ['c1']);
  assert.equal(r.fresh, true);
});

test('a double tap: bad after the first tap, fine after the second, so it never shows', () => {
  const g = makeGrace();
  assert.equal(g.update(S('c1')).fresh, true);            // first tap: the wait starts
  const r = g.update(S());                                // second tap: no longer bad
  assert.equal(r.waiting.size, 0);
  assert.equal(r.show.size, 0);
  g.commit();                                             // (the board cancels its timer here; even if it fired, nothing is waiting)
  assert.equal(g.update(S()).show.size, 0);
});

test('when the wait is over it shows, and stays while it is still bad', () => {
  const g = makeGrace();
  g.update(S('c1', 's4'));
  g.commit();
  const r = g.update(S('c1', 's4'));
  assert.deepEqual([...r.show].sort(), ['c1', 's4']);
  assert.equal(r.waiting.size, 0);
  assert.equal(g.update(S('c1', 's4')).fresh, false);
});

test('clearing red is immediate', () => {
  const g = makeGrace();
  g.update(S('c1', 'c2')); g.commit();
  const r = g.update(S('c2'));
  assert.deepEqual([...r.show], ['c2']);
});

test('the same waiting set keeps its wait (a re-render with nothing new must not restart the clock); a different one restarts it', () => {
  const g = makeGrace();
  assert.equal(g.update(S('c1')).fresh, true);
  assert.equal(g.update(S('c1')).fresh, false);           // e.g. the mouse moved over another cell: the board re-rendered
  assert.equal(g.update(S('c1', 'c2')).fresh, true);      // something else went bad: wait again
  assert.equal(g.update(S('c1', 'c2')).fresh, false);
});

test('a red item stays red while a new one waits', () => {
  const g = makeGrace();
  g.update(S('c1')); g.commit();
  const r = g.update(S('c1', 'c2'));
  assert.deepEqual([...r.show], ['c1']);
  assert.deepEqual([...r.waiting], ['c2']);
});

test('immediate: a puzzle that has just been opened shows its red at once; reset forgets everything', () => {
  const g = makeGrace();
  const r = g.update(S('c1'), true);
  assert.deepEqual([...r.show], ['c1']);
  assert.equal(r.waiting.size, 0);
  g.reset();
  assert.equal(g.update(S('c1')).waiting.size, 1);
});
