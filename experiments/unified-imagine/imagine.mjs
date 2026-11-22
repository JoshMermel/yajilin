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
export function easyContradiction(P, st) {
  const { N, nb } = P;
  for (let i = 0; i < N; i++) {
    const s = st.cell[i];
    if (s === CLUE) continue;
    if (s === SHADED) {
      for (let d = 0; d < 4; d++) {
        const j = nb[i * 4 + d];
        if (j >= 0 && st.cell[j] === SHADED) return true;
        const x = P.ed[i * 4 + d];
        if (x >= 0 && st.e[x] === E_ON) return true;
      }
      continue;
    }
    const on = onCount(P, st, i);
    if (on > 2) return true;
    if ((s === LOOP || on > 0) && exits(P, st, i) < 2) return true;
  }
  for (let k = 0; k < P.clues.length; k++) {
    if (P.clues[k].n < 0) continue;
    let s = 0, u = 0;
    for (const i of P.rays[k]) { if (st.cell[i] === SHADED) s++; else if (st.cell[i] === UNKNOWN) u++; }
    if (s > P.clues[k].n || s + u < P.clues[k].n) return true;
  }
  // early close
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
}

const TRACE = ['shadedNeighbor', 'clueDone', 'clueFull', 'clueTight', 'deadEnd', 'forcedExits'];
const RUN_RULES = RULES.filter((r) => r.free || TRACE.includes(r.id));
const key = (k, i, v) => `${k}${i}:${v}`;
export const STATS = { runs: 0, iters: 0, ruleCalls: 0 };

/** hyp: [['c', i, v]...]. forbid: Set of fact keys that may not be derived by a non-free rule.
 *  record: keep the state at the start of every generation, so a later run that only forbids facts from generation g on can resume there.
 *  resume: such a snapshot (from a run with the same hypothesis whose forbid set differs only by facts first derivable at that generation). */
export function run(P, st, hyp, forbid = null, maxFacts = 80, contr = easyContradiction, record = false, resume = null) {
  STATS.runs++;
  let s2, facts, steps, g0, snaps = null;
  if (resume) { s2 = cloneState(resume.state); facts = resume.facts.slice(0, resume.nf); steps = resume.steps; g0 = resume.g; if (record) snaps = resume.snaps.slice(0, g0); }
  else { s2 = cloneState(st); applySets(s2, hyp); facts = []; steps = 0; g0 = 0; if (record) snaps = []; }
  for (let g = g0; g < 400; g++) {
    if (record) snaps[g] = { state: cloneState(s2), facts, nf: facts.length, steps, g, snaps };
    STATS.iters++;
    if (contr(P, s2)) return { ok: true, facts, steps, snaps };
    let fired = false;
    for (const r of RUN_RULES) {
      STATS.ruleCalls++;
      const fs = r.find(P, s2, {});
      if (!fs.length) continue;
      const arrOf = (k) => (k === 'c' ? s2.cell : s2.e);
      const sets = [];
      for (const f of fs) for (const t of f.sets) {
        if (arrOf(t[0])[t[1]] === t[2]) continue;
        if (!r.free && forbid && forbid.has(key(...t))) continue;
        sets.push(t);
      }
      if (!sets.length) continue;
      const ok = applySets(s2, sets);
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
function scanSlow(P, st, hyp, maxRaw = 30, areaFacts = 12) {
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

export function scan(P, st, hyp, maxRaw = 30, areaFacts = 12) {
  STATS.runs++;
  const s2 = cloneState(st);
  applySets(s2, hyp);
  const facts = []; let last = null;
  const finish = () => (last && fullContradiction(P, last) ? scanSlow(P, st, hyp, maxRaw, areaFacts) : null);   // (the full check only ever gets truer as facts are added)
  for (let g = 0; g < 400; g++) {
    STATS.iters++;
    if (easyContradiction(P, s2)) return { ok: true, area: false, facts };
    if (facts.length <= areaFacts) last = cloneState(s2);
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
      if (facts.length > maxRaw) return finish();
      fired = true; break;
    }
    if (!fired) break;
  }
  return finish();
}

/** Prune by ablation: forbid each derived fact in turn (last first); if the contradiction still follows, it was not needed. */
export function pruned(P, st, hyp, contr = easyContradiction) {
  let r = run(P, st, hyp, null, 80, contr, true);
  if (!r.ok) return null;
  const raw = r.facts.length;
  const forbid = new Set();
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let a = r.facts.length - 1; a >= 0; a--) {
      const f = r.facts[a], kk = key(f.k, f.i, f.v);
      forbid.add(kk);
      const t = run(P, st, hyp, forbid, 80, contr, true, r.snaps[f.g]);
      if (t.ok) { changed = true; r = t; a = Math.min(a, r.facts.length); }   // not needed: take the new, shorter run
      else forbid.delete(kk);
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
