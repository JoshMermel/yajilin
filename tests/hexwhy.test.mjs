import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, compile, initialState, cloneState, propagate, colName, UNKNOWN, SHADED, LOOP, E_ON, E_OFF } from '../js/logic.js';
import { hexNextStep, applyHexStep, describeHexStep } from '../js/hexhint.js';
import { explainImagine } from '../js/hexwhy.js';

const root = new URL('..', import.meta.url).pathname;
const load = (id, k) => compile(parseCsv(fs.readFileSync(`${root}data/${id}.csv`, 'utf8'))[k]);
const nameOf = (P) => (i) => `${colName(i % P.cols)}${((i / P.cols) | 0) + 1}`;
/** The position the hint works from: every cell a segment touches is on the loop. */
function normalised(P, st) {
  const b = cloneState(st);
  for (let x = 0; x < P.numEdges; x++) if (b.e[x] === E_ON) for (const i of [P.edgeA[x], P.edgeB[x]]) if (b.cell[i] === UNKNOWN) b.cell[i] = LOOP;
  return b;
}

test('the explainer never invents a contradiction, and finds nearly every one propagation finds (every undecided cell, both values, at several points of play)', () => {
  let found = 0, sound = 0, missed = 0;
  for (const [id, k] of [['hex-6x6', 30], ['hex-7x7', 60], ['hex-8x8', 20], ['hex-10x10', 40]]) {
    const P = load(id, k), st = initialState(P), name = nameOf(P);
    for (let round = 0; round < 40; round++) {
      const base = normalised(P, st);
      for (let i = 0; i < P.N; i++) {
        if (P.clueAt[i] >= 0 || base.cell[i] !== UNKNOWN) continue;
        for (const v of [SHADED, LOOP]) {
          const u = cloneState(base); u.cell[i] = v;
          const breaks = !propagate(P, u);
          const why = explainImagine(P, base, { kind: 'cell', i, v }, name);
          if (why) { assert.ok(breaks, `${id}: the explainer found a contradiction that propagation does not (${i}, ${v}): ${why.text}`); sound++; }
          if (breaks) { found++; if (!why) missed++; }
        }
      }
      const s = hexNextStep(P, st);
      if (!s) break;
      applyHexStep(st, s);
    }
  }
  assert.ok(found > 100, `a sample of contradictions: ${found}`);
  assert.ok(missed <= 0.05 * found, `the explainer missed ${missed} of ${found}`);
  assert.ok(sound > 0.9 * found);
});

test('an explained imagine step reads as a story: it names the imagined mark, ends in the verdict, and its arrows and trouble spots are marked', () => {
  let seen = 0;
  for (const [id, k] of [['hex-6x6', 114], ['hex-7x7', 50], ['hex-8x8', 70]]) {
    const P = load(id, k), st = initialState(P), name = nameOf(P);
    for (let n = 0; n < 400; n++) {
      const s = hexNextStep(P, st);
      if (!s) break;
      if (s.kind === 'imagine' && s.explain) {
        seen++;
        const text = describeHexStep(s, name);
        assert.equal(text, s.explain.text);
        assert.ok(text.startsWith('Imagine '), text);
        assert.ok(/ So /.test(text) && text.endsWith('.'), text);
        assert.ok(/ would /.test(text), 'it says what would happen');
        assert.ok(s.explain.roles.problem.length > 0, 'something is marked as the trouble');
        for (const i of s.explain.roles.clue) assert.ok(P.clueAt[i] >= 0, 'a highlighted arrow is an arrow');
        assert.ok(text.length < 1100, `a long chain is shortened: ${text.length}`);
        const im = s.explain.imagined;      // what the move forces is drawn as a what-if: only undecided cells, never the imagined cell itself
        for (const i of [...im.shaded, ...im.loop]) assert.ok(st.cell[i] === 0 && !s.focus.includes(i), `imagined cell ${i} is undecided and not the focus`);
        if (/since boxes never touch/.test(text)) assert.ok(im.loop.length > 0, 'the forced dots are shown');
        if (/, so (?:a box|boxes)|would all be boxes|would be a box/.test(text)) assert.ok(im.shaded.length > 0, 'the forced boxes are shown');
      }
      applyHexStep(st, s);
    }
  }
  assert.ok(seen >= 5, `${seen}`);
});
