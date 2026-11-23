// "Imagine a box or a dot in a cell": the one rule that replaces the cell-hypothesis family in the human rating and in Hint.
//
// A hypothesis (a box or a dot in an open cell) is followed with the easy rules (boxes never touch, a clue with all its boxes, a clue that needs every open
// cell, a clue that fits its boxes exactly, dead ends, forced exits, and the bookkeeping) until something breaks: two boxes touching, a cell with three
// lines or too few ways out, a clue that has too many boxes or cannot reach its number, the loop closing early (an "easy" contradiction), or, failing that
// within a few steps, an area argument (a part of the board cut off from the loop, an odd number of open ends: the full `contradiction` of rating.js).
// The chain is then pruned to the facts the contradiction really depends on (by ablation: forbid a derived fact, and if the contradiction still follows it was
// not needed), and priced by what is left, the same for a box and for a dot: the lines it needs matter most, the cells it passes through a little. The cheapest
// imagined chain over all cells wins, so "assume a dot" and "assume a box" compete on length, not on polarity.
//
// Speed (all of it exact: the same results as following every hypothesis with the full-board rules; tests/imagine.test.mjs checks the pieces):
//  - the position the search starts from has no firing of the easy rules, so after a fact is added only what it touches can fire or break: the rules and the
//    contradiction check look only there (`Ctx`, `LOCAL`, `easyContradictionAfter`), and a rule is only asked again when a fact of a kind it reads has been added;
//  - ablation runs resume from a snapshot of the generation where the forbidden fact would first be derived;
//  - pruning gives up on a candidate once the facts already known to be needed price it above the best one so far;
//  - the area arguments are only looked for when there are fewer easy chains than candidates priced, since the easy ones come first.
import { cloneState, SHADED, LOOP, UNKNOWN, CLUE, E_ON, E_OFF, E_UNKNOWN } from './logic.js';

// ---------------------------------------------------------------- the price of a chain
export const AREA_PENALTY = 12;       // an area argument (cut-off part, odd open ends) is harder to see than touching boxes
export const MEDIUM_MAX = 30;         // an imagined chain priced above this is a Hard step
export const IMAGINE_COST = ({ nE, nB, nD }) => 8 + 5 * nE + 2 * (nB + nD) + (nE > 3 ? 10 * (nE - 3) : 0);   // lines needed, plus the cells passed through, and a surcharge past three lines
const MAX_CAND = 8;                   // chains priced per search (the shortest ones by raw length)
const MAX_RAW = 30;                   // a hypothesis that needs more facts than this to break something is not followed further
const AREA_FACTS = 12;                // ... and an area argument counts only within this many facts

// ---------------------------------------------------------------- the position
const applySets = (st, sets) => {
  for (const [kind, idx, v] of sets) {
    const arr = kind === 'c' ? st.cell : st.e;
    if (arr[idx] === v) continue;
    if (arr[idx] !== 0) return false;
    arr[idx] = v;
  }
  return true;
};
const onCount = (P, st, i) => { let n = 0; for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_ON) n++; } return n; };
const exits = (P, st, i) => {
  let n = 0;
  for (let d = 0; d < 4; d++) {
    const x = P.ed[i * 4 + d]; if (x < 0) continue;
    const j = P.nb[i * 4 + d];
    if (st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
    if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue;
    n++;
  }
  return n;
};

// The contradictions a person sees without a special argument. (No parity, no chokepoint: those are the "area" arguments, below.)
const cellBad = (P, st, i) => {
  const s = st.cell[i];
  if (s === CLUE) return false;
  const { nb } = P;
  if (s === SHADED) {
    for (let d = 0; d < 4; d++) {
      const j = nb[i * 4 + d];
      if (j >= 0 && st.cell[j] === SHADED) return true;
      const x = P.ed[i * 4 + d];
      if (x >= 0 && st.e[x] === E_ON) return true;
    }
    return false;
  }
  const on = onCount(P, st, i);
  if (on > 2) return true;
  return (s === LOOP || on > 0) && exits(P, st, i) < 2;
};
const clueBad = (P, st, k) => {
  if (P.clues[k].n < 0) return false;
  let s = 0, u = 0;
  for (const i of P.rays[k]) { if (st.cell[i] === SHADED) s++; else if (st.cell[i] === UNKNOWN) u++; }
  return s > P.hi[k] || s + u < P.lo[k] || (u === 0 && s === P.ne[k]);
};
let scratchParent = new Int16Array(0);
/** the loop closed early: some segments form a cycle while a loop cell lies off it */
const earlyClose = (P, st) => {
  const { N } = P;
  if (scratchParent.length < N) scratchParent = new Int16Array(N);
  const parent = scratchParent; for (let i = 0; i < N; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  let cyc = -1;
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_ON) continue;
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    const ra = find(a), rb = find(b);
    if (ra === rb) cyc = ra; else parent[ra] = rb;
  }
  if (cyc >= 0) { cyc = find(cyc); for (let i = 0; i < N; i++) if (st.cell[i] === LOOP && find(i) !== cyc) return true; }
  return false;
};
export function easyContradiction(P, st) {
  for (let i = 0; i < P.N; i++) if (cellBad(P, st, i)) return true;
  for (let k = 0; k < P.clues.length; k++) if (clueBad(P, st, k)) return true;
  return earlyClose(P, st);
}
/** easyContradiction when the state was free of easy contradictions before `sets` were applied: only what the sets touch can have gone wrong.
 *  Every check looks at a cell, its neighbours and their segments, or at one clue's ray, or at the cycle; so the cells to look at are the changed
 *  cells, the end cells of changed segments and all their neighbours, the clues counting a changed cell, and the cycle if a segment was turned on. */
export function easyContradictionAfter(P, st, sets) {
  const { nb } = P;
  let cyc = false;
  const seen = new Set();
  const look = (c) => { if (!seen.has(c)) { seen.add(c); if (cellBad(P, st, c)) return true; } return false; };
  for (const [kind, idx, v] of sets) {
    if (kind === 'c') {
      if (look(idx)) return true;
      for (let d = 0; d < 4; d++) { const j = nb[idx * 4 + d]; if (j >= 0 && look(j)) return true; }
      for (const k of P.cluesOf[idx]) if (!seen.has(-1 - k)) { seen.add(-1 - k); if (clueBad(P, st, k)) return true; }
    } else {
      const a = idx >> 1, b = (idx & 1) ? a + P.cols : a + 1;
      for (const c of [a, b]) {
        if (look(c)) return true;
        for (let d = 0; d < 4; d++) { const j = nb[c * 4 + d]; if (j >= 0 && look(j)) return true; }
      }
      if (v === E_ON) cyc = true;
    }
  }
  return cyc ? earlyClose(P, st) : false;
}

// The area arguments need rating.js's full contradiction, which imports this module: it is handed over once (see rating.js).
let fullContradiction = () => false;
export const setFullContradiction = (f) => { fullContradiction = f; };

// ---------------------------------------------------------------- the easy rules, asked only where something changed
// Rule order is the order of the rule table: bookkeeping first (free), then the easy deductions.
const RUN_IDS = ['edgesOffShaded', 'edgeEnds', 'fullCells', 'shadedNeighbor', 'clueDone', 'clueFull', 'clueTight', 'deadEnd', 'forcedExits'];
const FREE = new Set(['edgesOffShaded', 'edgeEnds', 'fullCells']);
// What can make a rule newly fire: a rule is only asked again when a fact of a kind it reads has been added since it last found nothing.
// (Facts only ever go from unknown to known, so e.g. "a segment touching a box that is not off yet" needs a new box.)
const SH = 1, LP = 2, ON = 4, OFF = 8, ALL = 15;
const DEP = { edgesOffShaded: SH, edgeEnds: ON, fullCells: ON, shadedNeighbor: SH, clueDone: SH, clueFull: SH | LP, clueTight: SH | LP, deadEnd: SH | ON | OFF, forcedExits: ALL };
const RUN_DEP = RUN_IDS.map((id) => DEP[id]);
const kindsOf = (sets) => { let m = 0; for (const t of sets) m |= t[0] === 'c' ? (t[2] === SHADED ? SH : LP) : (t[2] === E_ON ? ON : OFF); return m; };
const key = (k, i, v) => `${k}${i}:${v}`;

const adjacentCells = (P, i, j) => (Math.abs(i - j) === 1 && ((i / P.cols) | 0) === ((j / P.cols) | 0)) || Math.abs(i - j) === P.cols;
const touchesShadedAt = (P, st, i) => { for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && st.cell[j] === SHADED) return true; } return false; };
const cSet = (i, v) => ['c', i, v], eSet = (x, v) => ['e', x, v];
/** What the facts added so far touch (grown incrementally with add; the lists come out in ascending order, which is the order the full-board rules find things in):
 *  the changed cells, the shaded ones, the segments turned on and their end cells, the cells whose exits can have changed (changed cells, segment ends and
 *  all their neighbours), the clues counting a changed cell, and those that can see a box beside an open cell. `unordered`: hand back the sets themselves. */
export class Ctx {
  constructor(P) { this.P = P; this.s = { cells: new Set(), shaded: new Set(), onEdges: new Set(), onEnds: new Set(), region: new Set(), clues: new Set(), nearClues: new Set() }; this.ver = 0; this.cache = {}; }
  clone() { const c = new Ctx(this.P); for (const k in this.s) c.s[k] = new Set(this.s[k]); c.ver = this.ver; return c; }
  add(sets) {
    const { P, s } = this;
    const touch = (c) => { s.region.add(c); for (let d = 0; d < 4; d++) { const j = P.nb[c * 4 + d]; if (j >= 0) s.region.add(j); } };
    for (const [kind, idx, v] of sets) {
      if (kind === 'c') {
        s.cells.add(idx); touch(idx);
        for (const k of P.cluesOf[idx]) { s.clues.add(k); s.nearClues.add(k); }
        if (v === SHADED) { s.shaded.add(idx); for (let d = 0; d < 4; d++) { const j = P.nb[idx * 4 + d]; if (j >= 0) for (const k of P.cluesOf[j]) s.nearClues.add(k); } }
      } else {
        const a = idx >> 1, b = (idx & 1) ? a + P.cols : a + 1;
        touch(a); touch(b);
        if (v === E_ON) { s.onEdges.add(idx); s.onEnds.add(a); s.onEnds.add(b); }
      }
    }
    this.ver++;
  }
  get(name) { if (this.unordered) return this.s[name]; const c = this.cache[name]; if (c && c.ver === this.ver) return c.v; const v = [...this.s[name]].sort((x, y) => x - y); this.cache[name] = { ver: this.ver, v }; return v; }
}
/** The easy rules of rating.js, looking only where `cx` says something changed. Each returns what the full-board rule returns from a position that was at
 *  a fixed point of it before the changes (tests/imagine.test.mjs compares them with the full-board rules). */
export const LOCAL = {
  edgesOffShaded(P, st, cx) {
    const sets = [];
    for (const i of cx.get('shaded')) for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_UNKNOWN) sets.push(eSet(x, E_OFF)); }
    return sets.length ? [{ sets }] : [];
  },
  edgeEnds(P, st, cx) {
    const sets = [];
    for (const x of cx.get('onEdges')) { const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1; if (st.cell[a] === UNKNOWN) sets.push(cSet(a, LOOP)); if (st.cell[b] === UNKNOWN) sets.push(cSet(b, LOOP)); }
    return sets.length ? [{ sets }] : [];
  },
  fullCells(P, st, cx) {
    const sets = [];
    for (const i of cx.get('onEnds')) {
      if (st.cell[i] === CLUE || st.cell[i] === SHADED || onCount(P, st, i) !== 2) continue;
      for (let d = 0; d < 4; d++) { const y = P.ed[i * 4 + d]; if (y >= 0 && st.e[y] === E_UNKNOWN) sets.push(eSet(y, E_OFF)); }
    }
    return sets.length ? [{ sets }] : [];
  },
  shadedNeighbor(P, st, cx) {
    const out = [];
    for (const i of cx.get('shaded')) {
      const sets = [];
      for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && st.cell[j] === UNKNOWN) sets.push(cSet(j, LOOP)); }
      if (sets.length) out.push({ sets });
    }
    return out;
  },
  clueDone(P, st, cx) {
    const out = [];
    for (const k of cx.get('clues')) {
      const cl = P.clues[k]; if (cl.n < 0) continue;
      let s = 0; const unk = [];
      for (const i of P.rays[k]) { if (st.cell[i] === SHADED) s++; else if (st.cell[i] === UNKNOWN) unk.push(i); }
      if (s === P.hi[k] && unk.length) out.push({ sets: unk.map((i) => cSet(i, LOOP)), clue: k });
      else if (unk.length === 1 && (s === P.ne[k] || s + 1 === P.ne[k])) out.push({ sets: [cSet(unk[0], s === P.ne[k] ? SHADED : LOOP)], clue: k });
    }
    return out;
  },
  clueFull(P, st, cx) {
    const out = [];
    for (const k of cx.get('clues')) {
      const cl = P.clues[k]; if (cl.n < 0) continue;
      let s = 0; const unk = [];
      for (const i of P.rays[k]) { if (st.cell[i] === SHADED) s++; else if (st.cell[i] === UNKNOWN) unk.push(i); }
      if (unk.length && P.lo[k] - s === unk.length) out.push({ sets: unk.map((i) => cSet(i, SHADED)), clue: k });
    }
    return out;
  },
  clueTight(P, st, cx) {
    const out = [];
    for (const k of cx.get('nearClues')) {          // (a box next to an open cell takes it out of the runs, so the clues of cells beside a new box count too)
      const cl = P.clues[k];
      if (P.lo[k] < 2 || cl.region) continue;
      let boxes = 0, run = [];
      const runs = [];
      for (const i of P.rays[k]) {
        if (st.cell[i] === SHADED) boxes++;
        if (st.cell[i] === UNKNOWN && !touchesShadedAt(P, st, i)) {
          if (run.length && !adjacentCells(P, run[run.length - 1], i)) { runs.push(run); run = []; }
          run.push(i);
        } else { if (run.length) runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
      const need = P.lo[k] - boxes;
      if (need < 2 || !runs.length || runs.some((r) => r.length % 2 === 0)) continue;
      if (runs.reduce((a, r) => a + (r.length + 1) / 2, 0) !== need) continue;
      out.push({ sets: runs.flatMap((r) => r.map((i, q) => (q % 2 === 0 ? cSet(i, SHADED) : cSet(i, LOOP)))), clue: k });
    }
    return out;
  },
  deadEnd(P, st, cx) {
    const out = [];
    for (const i of cx.get('region')) if (st.cell[i] === UNKNOWN && exits(P, st, i) < 2) out.push({ sets: [cSet(i, SHADED)] });
    return out;
  },
  forcedExits(P, st, cx) {
    const out = [];
    for (const i of cx.get('region')) {
      if (st.cell[i] !== LOOP || exits(P, st, i) !== 2) continue;
      const sets = [];
      for (let d = 0; d < 4; d++) {
        const x = P.ed[i * 4 + d];
        if (x < 0 || st.e[x] !== E_UNKNOWN || st.cell[P.nb[i * 4 + d]] === SHADED) continue;
        if (onCount(P, st, P.nb[i * 4 + d]) >= 2) continue;
        sets.push(eSet(x, E_ON));
      }
      if (sets.length) out.push({ sets });
    }
    return out;
  },
};

// ---------------------------------------------------------------- following a hypothesis
/** hyp: [['c', i, v]...]. forbid: Set of fact keys that may not be derived by a non-free rule. contr: the contradiction to look for (easy by default).
 *  record: keep the state at the start of every generation, so a later run that only forbids facts from generation g on can resume there.
 *  resume: such a snapshot (from a run with the same hypothesis whose forbid set differs only by facts first derivable at that generation).
 *  Returns { ok (a contradiction was reached), facts (the derived cells and segments, in order), steps, state, snaps }. */
export function run(P, st, hyp, forbid = null, maxFacts = 80, contr = easyContradiction, record = false, resume = null) {
  let s2, facts, steps, g0, snaps = null, pend, gate, cx;
  const incr = contr === easyContradiction;   // the incremental check needs a state that had no easy contradiction before `pend` was applied
  if (resume) { s2 = cloneState(resume.state); facts = resume.facts.slice(0, resume.nf); steps = resume.steps; g0 = resume.g; pend = resume.pend; gate = resume.gate.slice(); cx = resume.cx.clone(); if (record) snaps = resume.snaps.slice(0, g0); }
  else { s2 = cloneState(st); applySets(s2, hyp); facts = []; steps = 0; g0 = 0; pend = hyp; gate = new Array(RUN_IDS.length).fill(kindsOf(hyp)); cx = new Ctx(P); cx.add(hyp); if (record) snaps = []; }
  for (let g = g0; g < 400; g++) {
    if (record) snaps[g] = { state: cloneState(s2), facts, nf: facts.length, steps, g, snaps, pend, gate: gate.slice(), cx: cx.clone() };
    if (incr ? easyContradictionAfter(P, s2, pend) : contr(P, s2)) return { ok: true, facts, steps, snaps, state: s2 };
    let fired = false;
    for (let ri = 0; ri < RUN_IDS.length; ri++) {
      if (!(gate[ri] & RUN_DEP[ri])) continue;
      const id = RUN_IDS[ri];
      const fs = LOCAL[id](P, s2, cx);
      const sets = [];
      for (const f of fs) for (const t of f.sets) {
        if ((t[0] === 'c' ? s2.cell : s2.e)[t[1]] === t[2]) continue;
        if (!FREE.has(id) && forbid && forbid.has(key(...t))) continue;
        if (f.clue !== undefined) t.clue = f.clue;      // (the clue that made it: the explanation names it)
        sets.push(t);
      }
      if (!sets.length) { gate[ri] = 0; continue; }
      const ok = applySets(s2, sets);
      pend = sets;
      cx.add(sets);
      { const m = kindsOf(sets); for (let q = 0; q < gate.length; q++) gate[q] |= m; }
      if (!FREE.has(id)) { steps++; for (const t of sets) facts.push({ k: t[0], i: t[1], v: t[2], rule: id, step: steps, g, clue: t.clue }); }
      if (!ok) return { ok: true, facts, steps, snaps, state: s2 };
      if (facts.length > maxFacts) return { ok: false, facts, steps, snaps, state: s2 };
      fired = true; break;
    }
    if (!fired) return { ok: false, facts, steps, snaps, state: s2 };
  }
  return { ok: false, facts, steps, snaps, state: s2 };
}

/** The scan run for one hypothesis: follow it with the easy rules up to maxRaw facts. Returns { ok: true, area: false, facts } on an easy contradiction,
 *  null if none comes and no area argument can be made; with deferArea, { ok: false, areaState } instead: the state the area argument would be checked on
 *  (the state at the start of the last generation that began with at most areaFacts facts), for a caller that may never need it. (A full contradiction
 *  only ever gets truer as facts are added, so checking the last such state is enough to know whether an area argument exists at all.) */
export function scan(P, st, hyp, maxRaw = MAX_RAW, areaFacts = AREA_FACTS, deferArea = false, perGeneration = false) {
  const s2 = cloneState(st);
  applySets(s2, hyp);
  const facts = []; let last = null, crossed = false, areaAt = -1;
  const finish = () => {
    if (perGeneration) return areaAt >= 0 ? { ok: true, area: true, facts: facts.slice(0, areaAt) } : null;
    const l = crossed ? last : s2;
    if (deferArea) return { ok: false, areaState: l };
    return fullContradiction(P, l) ? scan(P, st, hyp, maxRaw, areaFacts, false, true) : null;
  };
  const gate = new Array(RUN_IDS.length).fill(kindsOf(hyp));   // the position was at a fixed point of these rules before the hypothesis
  const cx = new Ctx(P); cx.unordered = true; cx.add(hyp);   // everything added so far (the scan only counts what the rules find, so their order does not matter)
  let pend = hyp;   // what changed since the last check: the state before it had no easy contradiction
  for (let g = 0; g < 400; g++) {
    if (easyContradictionAfter(P, s2, pend)) return { ok: true, area: false, facts };
    if (perGeneration && areaAt < 0 && facts.length <= areaFacts && fullContradiction(P, s2)) areaAt = facts.length;
    let fired = false;
    for (let ri = 0; ri < RUN_IDS.length; ri++) {
      if (!(gate[ri] & RUN_DEP[ri])) continue;
      const id = RUN_IDS[ri];
      const sets = [];
      for (const f of LOCAL[id](P, s2, cx)) for (const t of f.sets) {
        if ((t[0] === 'c' ? s2.cell : s2.e)[t[1]] === t[2]) continue;
        sets.push(t);
      }
      if (!sets.length) { gate[ri] = 0; continue; }
      const free = FREE.has(id);
      if (!free && !crossed && facts.length <= areaFacts && facts.length + sets.length > areaFacts) { crossed = true; last = cloneState(s2); }
      const ok = applySets(s2, sets);
      pend = sets;
      cx.add(sets);
      { const m = kindsOf(sets); for (let q = 0; q < gate.length; q++) gate[q] |= m; }
      if (!free) for (const t of sets) facts.push({ k: t[0], i: t[1], v: t[2], rule: id });
      if (!ok) return { ok: true, area: false, facts };
      if (facts.length > maxRaw) return finish();
      fired = true; break;
    }
    if (!fired) break;
  }
  return finish();
}

/** Prune by ablation: forbid each derived fact in turn (last first); if the contradiction still follows, it was not needed.
 *  abort(neededCounts) -> true gives up early (returns { aborted: true }) once the facts known to be needed already make the chain too costly.
 *  Returns { raw, n, nE, nB, nD (the lines, boxes and dots the pruned chain needs), steps, facts, forbid } or null. */
export function pruned(P, st, hyp, contr = easyContradiction, abort = null) {
  let r = run(P, st, hyp, null, 80, contr, true);
  if (!r.ok) return null;
  const raw = r.facts.length;
  const forbid = new Set(), needed = [new Set(), new Set(), new Set()];
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let a = r.facts.length - 1; a >= 0; a--) {
      const f = r.facts[a], kk = key(f.k, f.i, f.v);
      forbid.add(kk);
      const t = run(P, st, hyp, forbid, 80, contr, true, r.snaps[f.g]);
      if (t.ok) { changed = true; r = t; a = Math.min(a, r.facts.length); }   // not needed: take the new, shorter run
      else {
        forbid.delete(kk);
        // this fact is needed whatever else is forbidden later, so the final chain has at least the needed ones: `abort` can tell that it cannot be the cheapest
        if (abort) { needed[f.k === 'e' ? 0 : f.v === SHADED ? 1 : 2].add(kk); if (abort({ nE: needed[0].size, nB: needed[1].size, nD: needed[2].size })) return { aborted: true }; }
      }
    }
    if (!changed) break;
  }
  r = run(P, st, hyp, forbid, 80, contr);
  const nE = r.facts.filter((f) => f.k === 'e').length;
  const nB = r.facts.filter((f) => f.k === 'c' && f.v === SHADED).length;
  const nD = r.facts.filter((f) => f.k === 'c' && f.v === LOOP).length;
  return { raw, n: r.facts.length, nE, nB, nD, steps: r.steps, facts: r.facts, forbid: [...forbid] };
}

// ---------------------------------------------------------------- the search
const counted = (P) => {            // the cells some clue counts (a dot can only matter there)
  if (P._countedByClue) return P._countedByClue;
  const c = new Uint8Array(P.N);
  P.clues.forEach((cl, k) => { if (cl.n >= 0) for (const i of P.rays[k]) c[i] = 1; });
  return (P._countedByClue = c);
};

/**
 * The cheapest imagined box or dot that ends in a contradiction, from the position `st` (which must be one the easy rules have nothing more to do in):
 * { cell, pol (SHADED: a box was imagined, so the cell is a dot; LOOP: a dot was imagined, so it is a box), cost, area, pr (see pruned) } or null.
 * Ties go to the box.
 */
export function bestImagine(P, st, { maxCand = MAX_CAND, maxRaw = MAX_RAW } = {}) {
  const cnt = counted(P), cands = [], pending = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    for (const pol of [SHADED, LOOP]) {
      if (pol === LOOP && !cnt[i]) continue;
      const r = scan(P, st, [['c', i, pol]], maxRaw, AREA_FACTS, true);
      if (r === null) continue;
      if (r.ok) cands.push({ cell: i, pol, area: false, rawE: r.facts.filter((f) => f.k === 'e').length, raw: r.facts.length });
      else if (r.areaState) pending.push({ cell: i, pol, state: r.areaState });
    }
  }
  // The candidates are taken easy ones first and only the first maxCand are priced, so an area argument (cut off, odd open ends) is only looked for
  // when there are fewer easy chains than that.
  if (cands.length < maxCand) {
    for (const q of pending) {
      if (!fullContradiction(P, q.state)) continue;
      const r = scan(P, st, [['c', q.cell, q.pol]], maxRaw, AREA_FACTS, false, true);
      if (r && r.ok) cands.push({ cell: q.cell, pol: q.pol, area: true, rawE: r.facts.filter((f) => f.k === 'e').length, raw: r.facts.length });
    }
  }
  cands.sort((a, b) => a.area - b.area || a.rawE - b.rawE || a.raw - b.raw || (a.pol === SHADED ? -1 : 1));
  let best = null;
  for (const c of cands.slice(0, maxCand)) {
    const pen = c.area ? AREA_PENALTY : 0;
    // a chain with the facts already known to be needed priced above the best (or equal, when it would not win the tie) cannot be the cheapest
    const abort = best ? (nec) => { const lb = IMAGINE_COST(nec) + pen; return lb > best.cost || (lb === best.cost && !(c.pol === SHADED && best.pol !== SHADED)); } : null;
    const pr = pruned(P, st, [['c', c.cell, c.pol]], c.area ? fullContradiction : undefined, abort);
    if (!pr || pr.aborted) continue;
    const cost = IMAGINE_COST(pr) + pen;
    if (!best || cost < best.cost || (cost === best.cost && c.pol === SHADED && best.pol !== SHADED)) best = { cell: c.cell, pol: c.pol, cost, pr, area: c.area, cands: cands.length };
  }
  return best;
}

/** Follow a found chain again from `st` (for the explanation): { state (where the contradiction shows), facts }. `info` is a firing's info from the rule. */
export function replayImagine(P, st, info) {
  const forbid = new Set(info.forbid);
  const r = run(P, st, [['c', info.cell, info.hyp === 'box' ? SHADED : LOOP]], forbid, 80, info.area ? fullContradiction : easyContradiction);
  return { state: r.state, facts: r.facts, ok: r.ok };
}
