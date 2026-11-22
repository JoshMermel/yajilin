// Prototype of the unified "imagine X" family: a hypothesis (box or dot in a cell) is followed with the easy rules until a contradiction,
// and the chain is pruned to the facts the contradiction really depends on (by ablation), so the length is the same for both polarities.
import { RULES, applySets, contradiction as fullContradiction } from '../../js/rating.js';
import { cloneState, SHADED, LOOP, UNKNOWN, CLUE, E_ON, E_OFF } from '../../js/logic.js';

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
/** The contradictions a person sees without a special argument: touching boxes, a cell with three lines or too few ways out, a clue that
 *  has too many boxes or cannot reach its number, the loop closing around loop cells that are not on it. (No parity, no chokepoint.) */
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
  return s > P.clues[k].n || s + u < P.clues[k].n;
};
/** the loop closed early: some segments form a cycle while a loop cell lies off it */
const earlyClose = (P, st) => {
  const { N } = P;
  const parent = new Int16Array(N); for (let i = 0; i < N; i++) parent[i] = i;
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

const TRACE = ['shadedNeighbor', 'clueDone', 'clueFull', 'clueTight', 'deadEnd', 'forcedExits'];
const RUN_RULES = RULES.filter((r) => r.free || TRACE.includes(r.id));
// What can make a rule newly fire: a rule is only asked again when a fact of a kind it reads has been added since it last found nothing.
// (Facts only ever go from unknown to known, so e.g. "a segment touching a box that is not off yet" needs a new box.)
const SH = 1, LP = 2, ON = 4, OFF = 8, ALL = 15;
const DEP = { edgesOffShaded: SH, edgeEnds: ON, fullCells: ON, shadedNeighbor: SH, clueDone: SH, clueFull: SH | LP, clueTight: SH | LP, deadEnd: SH | ON | OFF, forcedExits: ALL };
const RUN_DEP = RUN_RULES.map((r) => DEP[r.id] ?? ALL);
const kindsOf = (sets) => { let m = 0; for (const t of sets) m |= t[0] === 'c' ? (t[2] === SHADED ? SH : LP) : (t[2] === E_ON ? ON : OFF); return m; };
const CHECK_GATE = !!process.env.CHECK_GATE;   // debugging: also ask the skipped rules and fail if one of them finds something
const key = (k, i, v) => `${k}${i}:${v}`;
const CHECK_EASY = !!process.env.CHECK_EASY;   // debugging: verify the incremental check against the full one at every generation
export const STATS = { runs: 0, iters: 0, ruleCalls: 0 };

/** hyp: [['c', i, v]...]. forbid: Set of fact keys that may not be derived by a non-free rule.
 *  record: keep the state at the start of every generation, so a later run that only forbids facts from generation g on can resume there.
 *  resume: such a snapshot (from a run with the same hypothesis whose forbid set differs only by facts first derivable at that generation). */
export function run(P, st, hyp, forbid = null, maxFacts = 80, contr = easyContradiction, record = false, resume = null) {
  STATS.runs++;
  let s2, facts, steps, g0, snaps = null, pend, gate;
  const incr = contr === easyContradiction;   // the incremental check needs a state that had no easy contradiction before `pend` was applied
  if (resume) { s2 = cloneState(resume.state); facts = resume.facts.slice(0, resume.nf); steps = resume.steps; g0 = resume.g; pend = resume.pend; gate = resume.gate.slice(); if (record) snaps = resume.snaps.slice(0, g0); }
  else { s2 = cloneState(st); applySets(s2, hyp); facts = []; steps = 0; g0 = 0; pend = hyp; gate = new Array(RUN_RULES.length).fill(kindsOf(hyp)); if (record) snaps = []; }
  for (let g = g0; g < 400; g++) {
    if (record) snaps[g] = { state: cloneState(s2), facts, nf: facts.length, steps, g, snaps, pend, gate: gate.slice() };
    STATS.iters++;
    if (incr ? easyContradictionAfter(P, s2, pend) : contr(P, s2)) return { ok: true, facts, steps, snaps };
    let fired = false;
    for (let ri = 0; ri < RUN_RULES.length; ri++) {
      const r = RUN_RULES[ri];
      if (!(gate[ri] & RUN_DEP[ri]) && !CHECK_GATE) continue;
      STATS.ruleCalls++;
      const fs = r.find(P, s2, {});
      const arrOf = (k) => (k === 'c' ? s2.cell : s2.e);
      const sets = [];
      for (const f of fs) for (const t of f.sets) {
        if (arrOf(t[0])[t[1]] === t[2]) continue;
        if (!r.free && forbid && forbid.has(key(...t))) continue;
        sets.push(t);
      }
      if (CHECK_GATE && sets.length && !(gate[ri] & RUN_DEP[ri])) throw new Error('rule gate skipped ' + r.id);
      if (!sets.length) { gate[ri] = 0; continue; }
      const ok = applySets(s2, sets);
      pend = sets;
      { const m = kindsOf(sets); for (let q = 0; q < gate.length; q++) gate[q] |= m; }
      if (!r.free) { steps++; for (const t of sets) facts.push({ k: t[0], i: t[1], v: t[2], rule: r.id, step: steps, g }); }
      if (!ok) return { ok: true, facts, steps, snaps };
      if (facts.length > maxFacts) return { ok: false, facts, steps, snaps };
      fired = true; break;
    }
    if (!fired) return { ok: false, facts, steps, snaps };
  }
  return { ok: false, facts, steps, snaps };
}

/** The scan run for one hypothesis, both ways at once: the same propagation as run(...easyContradiction) up to maxRaw facts, and, should the easy
 *  contradictions never come, the first state within `areaFacts` facts where the full check (cut-off areas, odd open ends) holds.
 *  Returns { ok, area, facts } as the two separate runs would (the easy one wins), or null. */
export function scanSlow(P, st, hyp, maxRaw = 30, areaFacts = 12) {
  STATS.runs++;
  const s2 = cloneState(st);
  applySets(s2, hyp);
  const facts = []; let areaAt = -1;
  for (let g = 0; g < 400; g++) {
    STATS.iters++;
    if (easyContradiction(P, s2)) return { ok: true, area: false, facts };
    if (areaAt < 0 && facts.length <= areaFacts && fullContradiction(P, s2)) areaAt = facts.length;
    let fired = false;
    for (const r of RUN_RULES) {
      STATS.ruleCalls++;
      const fs = r.find(P, s2, {});
      if (!fs.length) continue;
      const arrOf = (k) => (k === 'c' ? s2.cell : s2.e);
      const sets = [];
      for (const f of fs) for (const t of f.sets) {
        if (arrOf(t[0])[t[1]] === t[2]) continue;
        sets.push(t);
      }
      if (!sets.length) continue;
      const ok = applySets(s2, sets);
      if (!r.free) for (const t of sets) facts.push({ k: t[0], i: t[1], v: t[2], rule: r.id });
      if (!ok) return { ok: true, area: false, facts };
      if (facts.length > maxRaw) return areaAt >= 0 ? { ok: true, area: true, facts: facts.slice(0, areaAt) } : null;
      fired = true; break;
    }
    if (!fired) break;
  }
  return areaAt >= 0 ? { ok: true, area: true, facts: facts.slice(0, areaAt) } : null;
}

export function scan(P, st, hyp, maxRaw = 30, areaFacts = 12, deferArea = false) {
  STATS.runs++;
  const s2 = cloneState(st);
  applySets(s2, hyp);
  // `last` is the state at the start of the final generation that began with at most areaFacts facts: the stuck state itself, or the state just
  // before the rule that took the chain past areaFacts (cloned only then)
  const facts = []; let last = null, crossed = false;
  // deferArea: do not decide the area argument now, hand back the state it would be checked on ({ areaState }): the caller may never need it
  const finish = () => {
    const l = crossed ? last : s2;
    if (deferArea) return { ok: false, areaState: l };
    return facts.length <= areaFacts || crossed ? (fullContradiction(P, l) ? scanSlow(P, st, hyp, maxRaw, areaFacts) : null) : null;
  };   // (the full check only ever gets truer as facts are added)
  const gate = new Array(RUN_RULES.length).fill(kindsOf(hyp));   // the position was at a fixed point of these rules before the hypothesis
  let pend = hyp;   // what changed since the last check: the state before it had no easy contradiction (the position is one the rules left consistent)
  for (let g = 0; g < 400; g++) {
    STATS.iters++;
    const bad = easyContradictionAfter(P, s2, pend);
    if (CHECK_EASY && bad !== easyContradiction(P, s2)) throw new Error('easyContradictionAfter disagrees with easyContradiction');
    if (bad) return { ok: true, area: false, facts };
    let fired = false;
    for (let ri = 0; ri < RUN_RULES.length; ri++) {
      const r = RUN_RULES[ri];
      if (!(gate[ri] & RUN_DEP[ri]) && !CHECK_GATE) continue;
      STATS.ruleCalls++;
      const fs = r.find(P, s2, {});
      const arrOf = (k) => (k === 'c' ? s2.cell : s2.e);
      const sets = [];
      for (const f of fs) for (const t of f.sets) {
        if (arrOf(t[0])[t[1]] === t[2]) continue;
        sets.push(t);
      }
      if (CHECK_GATE && sets.length && !(gate[ri] & RUN_DEP[ri])) throw new Error('rule gate skipped ' + r.id);
      if (!sets.length) { gate[ri] = 0; continue; }
      if (!r.free && !crossed && facts.length <= areaFacts && facts.length + sets.length > areaFacts) { crossed = true; last = cloneState(s2); }
      const ok = applySets(s2, sets);
      pend = sets;
      { const m = kindsOf(sets); for (let q = 0; q < gate.length; q++) gate[q] |= m; }
      if (!r.free) for (const t of sets) facts.push({ k: t[0], i: t[1], v: t[2], rule: r.id });
      if (!ok) return { ok: true, area: false, facts };
      if (facts.length > maxRaw) return finish();
      fired = true; break;
    }
    if (!fired) break;
  }
  return finish();
}

/** Prune by ablation: forbid each derived fact in turn (last first); if the contradiction still follows, it was not needed.
 *  abort(neededCounts) -> true gives up early (returns { aborted: true }) once the facts known to be needed already make the chain too costly. */
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
  return { ok: true, raw, n: r.facts.length, nE, nB, nD, steps: r.steps, facts: r.facts };
}

export { fullContradiction };
