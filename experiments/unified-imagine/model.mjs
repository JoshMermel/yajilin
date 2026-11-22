import { RULES, applySets, contradiction, isComplete, nextStep, rate, tierOfRule, UNDETERMINED_WEIGHT } from '../../js/rating.js';
import { initialState, SHADED, LOOP, UNKNOWN, checkSolved, E_ON } from '../../js/logic.js';
import { run, scan, scanSlow, pruned, fullContradiction, STATS } from './imagine.mjs';
export { STATS };
export const AREA_PENALTY = 12;

export const REPLACED = ['deadEndNeighbor', 'shadeShortChain', 'boxStarvesClue', 'closingNeighbor', 'dotShortChain', 'shadeFewLines', 'boxStarvesClueByLines',
  'shadeForcesLines', 'shadeClosesLoop', 'dotForcesLines'];
const NOT_REPLACED = RULES.filter((r) => !r.free && !REPLACED.includes(r.id)).map((r) => r.id);
export const MEDIUM_MAX = 30;
const NONFREE = RULES.filter((r) => !r.free).map((r) => r.id);
const ABOVE_CHEAP = REPLACED.concat(RULES.filter((r) => !r.free && r.weight > 12).map((r) => r.id));

/** one cost for a chain of either polarity: the lines it needs matter most, the cells it passes through a little; many lines make it Hard */
const MODEL = process.env.MODEL || 'A';
export const costOf = (pr) => {
  if (MODEL === 'B') { const s = pr.steps; return 5 + 5 * s + (s > 4 ? 10 * (s - 4) : 0); }          // B: the reasoning steps the pruned chain needs
  const nE = pr.nE, nC = pr.nB + pr.nD; return 8 + 5 * nE + 2 * nC + (nE > 3 ? 10 * (nE - 3) : 0);   // A: the lines it needs (cells count a little)
};

const counted = (P) => {
  if (P._cnt) return P._cnt;
  const c = new Uint8Array(P.N);
  P.clues.forEach((cl, k) => { if (cl.n >= 0) for (const i of P.rays[k]) c[i] = 1; });
  return (P._cnt = c);
};

/** the cheapest imagined box or dot that ends in a contradiction: { cell, pol, cost, pr } or null */
export function bestImagine(P, st, { maxCand = +(process.env.MAXCAND || 8), maxRaw = 30 } = {}) {
  const cnt = counted(P), cands = [], pending = [], r0 = STATS.runs, i0 = STATS.iters, tS = performance.now();
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    for (const pol of [SHADED, LOOP]) {
      if (pol === LOOP && !cnt[i]) continue;
      const r = scan(P, st, [['c', i, pol]], maxRaw, 12, true);
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
      const r = scanSlow(P, st, [['c', q.cell, q.pol]], maxRaw, 12);
      if (r && r.ok) cands.push({ cell: q.cell, pol: q.pol, area: true, rawE: r.facts.filter((f) => f.k === 'e').length, raw: r.facts.length });
    }
  }
  STATS.scanMs = (STATS.scanMs || 0) + (performance.now() - tS); STATS.scanIters = (STATS.scanIters || 0) + (STATS.iters - i0);
  const tP = performance.now();
  STATS.scanRuns = (STATS.scanRuns || 0) + (STATS.runs - r0); STATS.cands = (STATS.cands || 0) + cands.length; STATS.calls = (STATS.calls || 0) + 1;
  cands.sort((a, b) => a.area - b.area || a.rawE - b.rawE || a.raw - b.raw || (a.pol === SHADED ? -1 : 1));
  let best = null;
  for (const c of cands.slice(0, maxCand)) {
    const pen = c.area ? AREA_PENALTY : 0;
    // a chain with the facts already known to be needed priced above the best (or equal, when it would not win the tie) cannot be the cheapest (model A: cost only grows with the chain)
    const abort = best && MODEL !== 'B' ? (nec) => { const lb = costOf(nec) + pen; return lb > best.cost || (lb === best.cost && !(c.pol === SHADED && best.pol !== SHADED)); } : null;
    const pr = pruned(P, st, [['c', c.cell, c.pol]], c.area ? fullContradiction : undefined, abort);
    if (!pr || pr.aborted) continue;
    const cost = costOf(pr) + (c.area ? AREA_PENALTY : 0);
    if (!best || cost < best.cost || (cost === best.cost && c.pol === SHADED && best.pol !== SHADED)) best = { cell: c.cell, pol: c.pol, cost, pr, area: c.area, cands: cands.length };
  }
  STATS.pruneMs = (STATS.pruneMs || 0) + (performance.now() - tP);
  return best;
}

export function rateUnified(P) {
  const st = initialState(P), steps = [];
  for (let guard = 0; guard < 2000; guard++) {
    if (!contradiction(P, st) && isComplete(P, st)) break;
    const bk = {};
    nextStep(P, st, bk, NONFREE);                          // only the bookkeeping (free rules) runs; it is applied to st
    for (const id of Object.keys(bk)) { const rule = RULES.find((q) => q.id === id); steps.push({ rule: id, tier: rule.tier, cost: rule.weight, bookkeeping: true }); }
    let pick = null;
    const cheap = nextStep(P, st, null, ABOVE_CHEAP);       // a cheap rule outside the family: no need to imagine anything
    let nf = cheap, fam = null;
    if (!cheap || cheap.weight + (cheap.extra || 0) > 12) {
      fam = bestImagine(P, st);
      // the other rules only matter if they could beat the imagined chain: leave out those priced above it (an equal price still wins the tie)
      const skip = fam ? REPLACED.concat(RULES.filter((r) => !r.free && r.weight > fam.cost).map((r) => r.id)) : REPLACED;
      nf = nextStep(P, st, null, skip);
    }
    const nfCost = nf ? nf.weight + (nf.extra || 0) : Infinity;
    if (fam && fam.cost < nfCost) {
      pick = { rule: 'imagine', tier: fam.cost <= MEDIUM_MAX ? 'Medium' : 'Hard', cost: fam.cost, sets: [['c', fam.cell, fam.pol === SHADED ? LOOP : SHADED]], hyp: fam.pol === SHADED ? 'box' : 'dot', nE: fam.pr.nE, n: fam.pr.n, area: fam.area };
    } else if (nf) {
      pick = { rule: nf.rule, tier: nf.tier, cost: nf.weight + (nf.extra || 0), sets: nf.sets };
    } else {
      // nothing else: the old family rules are the fallback (counted, to see how often the unified search misses something)
      const old = nextStep(P, st, null, NOT_REPLACED);
      if (!old) break;
      pick = { rule: old.rule, tier: old.tier, cost: old.weight + (old.extra || 0), sets: old.sets, fallback: true };
    }
    if (!applySets(st, pick.sets)) break;
    steps.push(pick);
  }
  nextStep(P, st);
  const shaded = Uint8Array.from(st.cell, (v) => (v === SHADED ? 1 : 0)), edges = Int8Array.from(st.e, (v) => (v === E_ON ? 1 : 0));
  const solved = isComplete(P, st) && checkSolved(P, shaded, edges);
  let unknown = 0; for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) unknown++;
  const score = steps.reduce((a, s) => a + s.cost, 0) + (solved ? 0 : unknown * UNDETERMINED_WEIGHT);
  const order = ['Beginner', 'Medium', 'Hard', 'Expert'];
  const tier = solved ? steps.reduce((t, s) => (order.indexOf(s.tier) > order.indexOf(t) ? s.tier : t), 'Beginner') : 'Expert';
  return { solved, tier, score, steps };
}
