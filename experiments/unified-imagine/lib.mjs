import fs from 'node:fs';
import path from 'node:path';
import { compile, parseCsv, initialState, cloneState, SHADED, LOOP, UNKNOWN } from '../../js/logic.js';
import { RULES, applySets, contradiction, nextStep, rate, isComplete, tierOfRule, DOT_SHORT } from '../../js/rating.js';
export const ROOT = process.env.CORPUS_ROOT || new URL('../..', import.meta.url).pathname.replace(/\/$/, '');   // CORPUS_ROOT: a frozen copy of data/ and tools/library (the books change under a running experiment)
export { compile, parseCsv, initialState, cloneState, SHADED, LOOP, UNKNOWN, rate, nextStep, applySets, contradiction, isComplete, RULES };

// the cell-hypothesis ("imagine X") family in the current table
export const FAMILY = ['deadEndNeighbor', 'shadeShortChain', 'boxStarvesClue', 'closingNeighbor', 'dotShortChain', 'shadeFewLines', 'boxStarvesClueByLines',
  'shadeForcesLines', 'boxStarvesClueByPlacements', 'shadeClosesLoop', 'dotForcesLines'];
export const NONFAMILY = RULES.filter((r) => !r.free && !FAMILY.includes(r.id)).map((r) => r.id);

const edgesOn = (s) => { let n = 0; for (const v of s.e) if (v === 1) n++; return n; };
const TRACE_RULES = ['shadedNeighbor', 'clueDone', 'clueFull', 'clueTight', 'deadEnd', 'forcedExits'];
/** imagine `pol` (SHADED or LOOP) at `cell`; follow the easy rules; steps = non-free rule applications. */
export function trace(P, st, cell, pol, cap = 12) {
  const s2 = cloneState(st); s2.cell[cell] = pol;
  let steps = 0;
  for (let g = 0; g < 200; g++) {
    if (contradiction(P, s2)) return { ok: true, steps, work: steps + edgesOn(s2) - edgesOn(st), s2 };
    let fired = false;
    for (const r of RULES) {
      if (!(r.free || TRACE_RULES.includes(r.id))) continue;
      const fs = r.find(P, s2, {});
      if (!fs.length) continue;
      let ok = true; let changed = false;
      for (const f of fs) { const before = JSON.stringify(f.sets.length); if (!applySets(s2, f.sets)) ok = false; }
      if (!r.free) steps++;
      if (!ok) return { ok: true, steps, work: steps + edgesOn(s2) - edgesOn(st), s2 };
      fired = true; break;
    }
    if (!fired || steps > cap) return { ok: false, steps };
  }
  return { ok: false, steps };
}

const counted = (P) => {
  if (P._cnt) return P._cnt;
  const c = new Uint8Array(P.N);
  P.clues.forEach((cl, k) => { if (cl.n >= 0) for (const i of P.rays[k]) c[i] = 1; });
  return (P._cnt = c);
};
/** every cell hypothesis that ends in a contradiction: [{cell, pol, steps}] (pol: what was imagined) */
export function familyAll(P, st, cap = 12) {
  const out = [], cnt = counted(P);
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    for (const pol of [SHADED, LOOP]) {
      if (pol === LOOP && !cnt[i]) continue;
      const t = trace(P, st, i, pol, cap);
      if (t.ok) out.push({ cell: i, pol, steps: t.steps, work: t.work });
    }
  }
  return out;
}

export function loadCorpus() {
  const out = [];
  const take = (file, n, label) => {
    const ps = parseCsv(fs.readFileSync(file, 'utf8'));
    const stride = Math.max(1, Math.floor(ps.length / n));
    for (let i = 0; i < ps.length && out.filter((x) => x.label === label).length < n; i += stride) out.push({ label, p: ps[i] });
  };
  for (const f of fs.readdirSync(`${ROOT}/data`).filter((f) => f.endsWith('.csv'))) {
    const big = /20x|16x16/.test(f);
    take(`${ROOT}/data/${f}`, big ? 3 : 8, f);
  }
  take(`${ROOT}/tools/library/regl_all.csv`, 43, 'regl_all');
  return out;
}
