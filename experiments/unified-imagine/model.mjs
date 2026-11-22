import { RULES, applySets, contradiction, isComplete, nextStep, rate, tierOfRule, UNDETERMINED_WEIGHT } from '../../js/rating.js';
import { initialState, SHADED, LOOP, UNKNOWN, checkSolved, E_ON } from '../../js/logic.js';
import { run, pruned, fullContradiction } from './imagine.mjs';
export const AREA_PENALTY = 12;

export const REPLACED = ['deadEndNeighbor', 'shadeShortChain', 'boxStarvesClue', 'closingNeighbor', 'dotShortChain', 'shadeFewLines', 'boxStarvesClueByLines',
  'shadeForcesLines', 'shadeClosesLoop', 'dotForcesLines'];
const NOT_REPLACED = RULES.filter((r) => !r.free && !REPLACED.includes(r.id)).map((r) => r.id);
export const MEDIUM_MAX = 30;

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
export function bestImagine(P, st, { maxCand = 8, maxRaw = 30 } = {}) {
  const cnt = counted(P), cands = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    for (const pol of [SHADED, LOOP]) {
      if (pol === LOOP && !cnt[i]) continue;
      let r = run(P, st, [['c', i, pol]], null, maxRaw), area = false;
      if (!r.ok) { r = run(P, st, [['c', i, pol]], null, 12, fullContradiction); area = true; }   // an area argument (cut off, odd open ends) after a short chain
      if (!r.ok) continue;
      cands.push({ cell: i, pol, area, rawE: r.facts.filter((f) => f.k === 'e').length, raw: r.facts.length });
    }
  }
  cands.sort((a, b) => a.area - b.area || a.rawE - b.rawE || a.raw - b.raw || (a.pol === SHADED ? -1 : 1));
  let best = null;
  for (const c of cands.slice(0, maxCand)) {
    const pr = pruned(P, st, [['c', c.cell, c.pol]], c.area ? fullContradiction : undefined);
    if (!pr) continue;
    const cost = costOf(pr) + (c.area ? AREA_PENALTY : 0);
    if (!best || cost < best.cost || (cost === best.cost && c.pol === SHADED && best.pol !== SHADED)) best = { cell: c.cell, pol: c.pol, cost, pr, area: c.area, cands: cands.length };
  }
  return best;
}

export function rateUnified(P) {
  const st = initialState(P), steps = [];
  for (let guard = 0; guard < 2000; guard++) {
    if (!contradiction(P, st) && isComplete(P, st)) break;
    const bk = {};
    const nf = nextStep(P, st, bk, REPLACED);            // cheapest rule that is not part of the family (also applies the bookkeeping)
    for (const id of Object.keys(bk)) { const rule = RULES.find((q) => q.id === id); steps.push({ rule: id, tier: rule.tier, cost: rule.weight, bookkeeping: true }); }
    const nfCost = nf ? nf.weight + (nf.extra || 0) : Infinity;
    let pick = null, fam = null;
    if (nfCost > 12) fam = bestImagine(P, st);
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
