// The Hint button on hex boards. The human-style rules (rating.js, explain.js) are written for square boards, so a hex hint is the machine's own
// reasoning, the same two kinds of step the generator uses to promise a hex puzzle can be solved without guessing (js/generator_hex.js):
//
//   * 'forced': marks that follow from the position by propagation alone (the arrows' counts, the loop's degree, boxes never touching, no early
//     close); at most MAX_FORCED of them, the ones nearest the first
//   * 'imagine': nothing is forced directly, so one cell where imagining a box (or a dot) makes the position impossible; the mark that must be
//     right instead, and the lines the imagined box would have forced (the contradiction is found by propagation)
//
// Pure (no DOM). Marks the player can make are boxes, dots and loop segments: a fact that only rules a segment out has nothing to mark, so it is
// never a step by itself.
import { cloneState, initialState, propagate, colName, UNKNOWN, SHADED, LOOP, E_UNKNOWN, E_ON, E_OFF } from './logic.js';
import { explainImagine } from './hexwhy.js';

const MAX_FORCED = 8;

/** The cells and loop segments that `after` decides and `before` did not (only what can be marked: a box, a dot, a segment). */
function newFacts(P, before, after) {
  const shaded = [], loop = [], segOn = [];
  for (let i = 0; i < P.N; i++) if (before.cell[i] === UNKNOWN && after.cell[i] === SHADED) shaded.push(i); else if (before.cell[i] === UNKNOWN && after.cell[i] === LOOP) loop.push(i);
  for (let x = 0; x < P.numEdges; x++) if (before.e[x] === E_UNKNOWN && after.e[x] === E_ON) segOn.push(x);
  return { shaded, loop, segOn };
}

/**
 * A step a person can follow in one look, with its reason: the first of these rules that has something to mark (on `base`, where a cell a segment
 * touches already counts as on the loop):
 *   arrow-done   an arrow has all its boxes: the other cells on its line are dots
 *   arrow-full   an arrow needs as many boxes as it has open cells left: they are all boxes
 *   next-to-box  a box's neighbours are dots (boxes never touch)
 *   no-room      an undecided cell with fewer than two neighbours the loop could use is a box
 *   two-exits    a loop cell that has only two neighbours left must connect to both
 */
function directStep(P, base) {
  const cellOfArrow = (k) => P.clues[k].r * P.cols + P.clues[k].c;
  const step = (rule, why, marks) => ({ kind: 'rule', rule, why, shaded: marks.shaded || [], loop: marks.loop || [], segOn: marks.segOn || [], focus: marks.focus || [], clue: marks.clue || [], range: marks.range || [], chain: [] });
  for (let k = 0; k < P.clues.length; k++) {
    const cl = P.clues[k];
    if (cl.n < 0) continue;
    const ray = P.rays[k], open = ray.filter((i) => base.cell[i] === UNKNOWN), have = ray.filter((i) => base.cell[i] === SHADED).length;
    if (!open.length) continue;
    if (have === cl.n) return step('arrow-done', { arrow: cellOfArrow(k), n: cl.n, cells: open }, { loop: open, clue: [cellOfArrow(k)], range: ray });
    if (have + open.length === cl.n) return step('arrow-full', { arrow: cellOfArrow(k), n: cl.n, cells: open }, { shaded: open, clue: [cellOfArrow(k)], range: ray });
  }
  for (let i = 0; i < P.N; i++) {
    if (base.cell[i] !== SHADED) continue;
    const next = [];
    for (let d = 0; d < P.K; d++) { const j = P.nb[i * P.K + d]; if (j >= 0 && base.cell[j] === UNKNOWN) next.push(j); }
    if (next.length) return step('next-to-box', { cell: i, cells: next }, { loop: next, focus: [i] });
  }
  const room = (i) => { let n = 0; for (let d = 0; d < P.K; d++) { const j = P.nb[i * P.K + d]; if (j >= 0 && base.cell[j] !== SHADED) n++; } return n; };
  for (let i = 0; i < P.N; i++) if (base.cell[i] === UNKNOWN && P.clueAt[i] < 0 && room(i) < 2) return step('no-room', { cell: i }, { shaded: [i], focus: [i] });
  for (let i = 0; i < P.N; i++) {
    if (base.cell[i] !== LOOP) continue;
    const exits = [];
    for (let d = 0; d < P.K; d++) { const j = P.nb[i * P.K + d]; if (j >= 0 && base.cell[j] !== SHADED) exits.push(d); }
    if (exits.length !== 2) continue;
    const need = exits.filter((d) => base.e[P.ed[i * P.K + d]] === E_UNKNOWN).map((d) => P.ed[i * P.K + d]);
    if (need.length) return step('two-exits', { cell: i, cells: exits.map((d) => P.nb[i * P.K + d]) }, { segOn: need, focus: [i] });
  }
  return null;
}

/** The cell nearest to `from` first (by hex distance on the board's own grid, good enough for choosing a neighbourhood). */
function byDistance(P, from, cells) {
  const at = (i) => { const r = (i / P.cols) | 0, c = i % P.cols; return [c + (r & 1) * 0.5, r * 0.866]; };
  const [fx, fy] = at(from);
  return cells.slice().sort((a, b) => { const [ax, ay] = at(a), [bx, by] = at(b); return Math.hypot(ax - fx, ay - fy) - Math.hypot(bx - fx, by - fy); });
}

/** The cell a fact is about (a segment: its first end). */
const cellOf = (P, fact) => (fact.cell >= 0 ? fact.cell : P.edgeA[fact.edge]);

/**
 * The next step from the position `st` (a solver state: the player's boxes, dots and segments), or null if there is none (solved, or stuck for
 * the machine, or the position is contradictory). Returns
 *   { kind: 'rule', rule, why, shaded, loop, segOn, focus, clue, range }   (one concrete rule with its reason: see directStep)
 *   { kind: 'forced', shaded, loop, segOn, focus: [cells], chain: [] }   (several marks that follow together, no single rule)
 *   { kind: 'imagine', imagined: 'box' | 'dot' | 'gap', focus: [cell] (a gap: the segment's two cells), shaded, loop, segOn, chain: [segments] }
 */
export function hexNextStep(P, st) {
  // a cell a segment touches is on the loop already (the player has drawn it): nothing to mark there
  const base = cloneState(st);
  for (let x = 0; x < P.numEdges; x++) if (base.e[x] === E_ON) { for (const i of [P.edgeA[x], P.edgeB[x]]) if (base.cell[i] === UNKNOWN) base.cell[i] = LOOP; }
  const t = cloneState(base);
  { const probe = cloneState(base); if (!propagate(P, probe)) return null; }
  const direct = directStep(P, base);
  if (direct) return direct;
  // `t` is the position with everything propagation (and the unmarkable segment-off lookaheads below) has settled; the loop ends when a step shows
  for (let round = 0; round <= P.numEdges; round++) {
    if (!propagate(P, t)) return null;
    const f = newFacts(P, base, t);
    const all = [...f.shaded.map((i) => ({ cell: i, edge: -1, v: 's' })), ...f.loop.map((i) => ({ cell: i, edge: -1, v: 'l' })), ...f.segOn.map((x) => ({ cell: -1, edge: x, v: 'e' }))];
    if (all.length) {
      // the facts near the first one: a hint is one place to look, not the whole board
      const order = byDistance(P, cellOf(P, all[0]), all.map((a) => cellOf(P, a)));
      const keep = new Set(), picked = [];
      for (const c of order) for (const a of all) if (!keep.has(a) && cellOf(P, a) === c && picked.length < MAX_FORCED) { keep.add(a); picked.push(a); }
      return {
        kind: 'forced',
        shaded: picked.filter((a) => a.v === 's').map((a) => a.cell), loop: picked.filter((a) => a.v === 'l').map((a) => a.cell), segOn: picked.filter((a) => a.v === 'e').map((a) => a.edge),
        focus: [], chain: [], total: all.length,
      };
    }
    // nothing is forced directly: imagine a value in an undecided cell, and see which one cannot be right (the one with the shortest story first)
    let best = null;
    const nameOf = (i) => `${colName(i % P.cols)}${((i / P.cols) | 0) + 1}`;
    const chainOf = (apply) => {                                       // what the imagined mark forces before the contradiction shows (a failed propagate keeps what it set)
      const v = cloneState(t); apply(v); propagate(P, v);
      const chain = [];
      for (let x = 0; x < P.numEdges; x++) if (t.e[x] === E_UNKNOWN && v.e[x] === E_ON) chain.push(x);
      return chain;
    };
    for (let i = 0; i < P.N; i++) {
      if (t.cell[i] !== UNKNOWN) continue;
      for (const [imagined, value, other] of [['box', SHADED, LOOP], ['dot', LOOP, SHADED]]) {
        const u = cloneState(t);
        u.cell[i] = value;
        if (propagate(P, u)) continue;                                 // no contradiction: this one cannot be ruled out here
        // the story of the contradiction (js/hexwhy.js); the shortest one wins, and the plain "can no longer be completed" is the fallback
        const explain = explainImagine(P, base, { kind: 'cell', i, v: value }, nameOf);
        const chain = explain ? explain.chain : chainOf((v) => { v.cell[i] = value; });
        const size = explain ? explain.steps : 99;
        if (!best || size < best.size || (size === best.size && chain.length < best.chain.length)) best = { kind: 'imagine', imagined, focus: [i], chain, explain, size, shaded: other === SHADED ? [i] : [], loop: other === LOOP ? [i] : [], segOn: [] };
      }
    }
    if (best) return best;
    // a segment: imagining it missing and failing means it is there (a step); imagining it there and failing only rules it out (nothing to mark: keep it and go round again)
    let progress = false;
    for (let x = 0; x < P.numEdges && !best; x++) {
      const a = P.edgeA[x];
      if (a < 0 || t.e[x] !== E_UNKNOWN || t.cell[a] === SHADED || t.cell[P.edgeB[x]] === SHADED || P.clueAt[a] >= 0 || P.clueAt[P.edgeB[x]] >= 0) continue;
      const off = cloneState(t); off.e[x] = E_OFF;
      if (!propagate(P, off)) { best = { kind: 'imagine', imagined: 'gap', focus: [a, P.edgeB[x]], chain: [], explain: explainImagine(P, base, { kind: 'edge', x, v: E_OFF }, nameOf), shaded: [], loop: [], segOn: [x] }; if (best.explain) best.chain = best.explain.chain; break; }
      const on = cloneState(t); on.e[x] = E_ON;
      if (!propagate(P, on)) { t.e[x] = E_OFF; progress = true; }
    }
    if (best) return best;
    if (!progress) return null;
  }
  return null;
}

/** The text of a step, in the app's voice. `name(i)` is a cell's name ("C4"). */
export function describeHexStep(step, name) {
  const list = (cells) => cells.map(name).join(', ');
  if (step.kind === 'rule') {
    const w = step.why, noun = (n) => (n === 1 ? 'box' : 'boxes');
    switch (step.rule) {
      case 'arrow-done': return w.n === 0
        ? `The clue at ${name(w.arrow)} says 0 boxes on its line, so none of its cells can be a box: ${list(w.cells)} ${w.cells.length === 1 ? 'is a dot' : 'are dots'}.`
        : `The clue at ${name(w.arrow)} has all ${w.n} of its ${noun(w.n)} already, so the rest of its line cannot hold one: ${list(w.cells)} ${w.cells.length === 1 ? 'is a dot' : 'are dots'}.`;
      case 'arrow-full': return `The clue at ${name(w.arrow)} needs ${w.n} ${noun(w.n)} and has no more open cells on its line than that, so ${list(w.cells)} ${w.cells.length === 1 ? 'is a box' : 'are all boxes'}.`;
      case 'next-to-box': return `${name(w.cell)} is a box, and boxes never touch, so ${list(w.cells)} ${w.cells.length === 1 ? 'is a dot' : 'are dots'}.`;
      case 'no-room': return `${name(w.cell)} has fewer than two ways out, so the loop cannot pass through it: it is a box.`;
      default: return `${name(w.cell)} is on the loop and has only two ways out (${list(w.cells)}): it uses both.`;
    }
  }
  if (step.kind === 'forced') {
    const n = step.shaded.length + step.loop.length + step.segOn.length;
    const parts = [];
    if (step.shaded.length) parts.push(`${step.shaded.length === 1 ? 'a box' : `${step.shaded.length} boxes`} (${list(step.shaded)})`);
    if (step.loop.length) parts.push(`${step.loop.length === 1 ? 'a dot' : `${step.loop.length} dots`} (${list(step.loop)})`);
    if (step.segOn.length) parts.push(`${step.segOn.length === 1 ? 'a line' : `${step.segOn.length} lines`}`);
    const more = step.total > n ? ` (${step.total - n} more follow after these)` : '';
    return `Together the clues' counts and the shape of the loop force ${parts.join(', ')}.${more}`;
  }
  if (step.explain) return step.explain.text;
  if (step.imagined === 'gap') return `Imagine no line between ${name(step.focus[0])} and ${name(step.focus[1])}: the position can no longer be completed. So the loop runs between them.`;
  const c = name(step.focus[0]);
  const want = step.shaded.length ? 'a box' : 'a dot';
  return `Imagine ${step.imagined === 'box' ? 'a box' : 'a dot'} at ${c}: the position can no longer be completed${step.chain.length ? ' (the dashed lines are what the box would force)' : ''}. So ${c} must be ${want}.`;
}

/** Apply a step's marks to a position (a solver state). */
export function applyHexStep(st, step) {
  for (const i of step.shaded) st.cell[i] = SHADED;
  for (const i of step.loop) st.cell[i] = LOOP;
  for (const x of step.segOn) st.e[x] = E_ON;
}

/**
 * How hard a hex puzzle is for a player, measured by playing it with the hints: how many 'imagine' steps (a what-if that fails) the solution needs,
 * and how many 'forced' steps. `imagine` is the score; null if the hints get stuck before the end.
 */
export function hexDifficulty(P) {
  const st = initialState(P);
  let imagine = 0, forced = 0;
  for (let k = 0; k < 4 * P.N; k++) {
    const s = hexNextStep(P, st);
    if (!s) break;
    if (s.kind === 'imagine') imagine++; else forced++;
    applyHexStep(st, s);
  }
  const touched = new Uint8Array(P.N);                              // a cell a segment touches is on the loop, dot or not
  for (let x = 0; x < P.numEdges; x++) if (st.e[x] === E_ON) { touched[P.edgeA[x]] = 1; touched[P.edgeB[x]] = 1; }
  for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && st.cell[i] === UNKNOWN && !touched[i]) return null;
  return { imagine, forced };
}

/** The tier for a score (the number of imagine steps): up to 2 Beginner, up to 11 Medium, then Hard. */
export const hexTier = (imagine) => (imagine <= 2 ? 'Beginner' : imagine <= 11 ? 'Medium' : 'Hard');
