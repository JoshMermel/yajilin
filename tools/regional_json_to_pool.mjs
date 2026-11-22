// A layout-first regional puzzle from tools/cpsat_regional.py (JSON {rows, cols, owner, solutions: [{boxes, edges}]}) -> a row of a pool CSV.
// For each solution: checks it and that the puzzle with every number is unique (exhaustive solver), then drops numbers in a random order
// while the rules up to --tier still solve it (if they cannot even with every number, the Hard rules without trial and error are used
// instead). The regions stay as drawn: unnumbered regions keep their borders, since the layout is the design. The best solution is kept
// (one the --tier rules handle, the highest score among those), rated and appended.
//   node tools/regional_json_to_pool.mjs sol.json --name REG-ROOMS-8x8-1 --out tools/library/regl_rooms_8x8.csv [--tier Medium] [--seed 1] [--keep 0.5]
// --tier   Beginner | Medium | Hard (default Hard: every sound rule, trial and error on cells included, but not on segments)
// --keep   stop pruning when this share of the regions is still numbered (default 0)
import fs from 'node:fs';
import { checkSolved, decodeSolution, solve, toCsvRow, CSV_HEADER_REGIONAL, SHADED, E_ON } from '../js/logic.js';
import { buildRegionalPuzzle } from '../js/generator.js';
import { RULES, TIERS, ratePuzzle, solvedByRules } from '../js/rating.js';
import { mulberry, drawLayout, shuffle } from './regional_layouts.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const J = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const name = arg('name', 'REG'), out = arg('out'), tier = arg('tier', 'Hard'), keep = +arg('keep', 0), rng = mulberry(+arg('seed', 1));
const { rows, cols } = J, N = rows * cols, owner = Int16Array.from(J.owner);
const nRegions = Math.max(...owner) + 1;
const rulesUpTo = (t, trial) => RULES.filter((r) => !r.assumesUnique && r.id !== 'tryEdge' && (trial || !r.lookahead) && TIERS.indexOf(r.tier) <= TIERS.indexOf(t)).map((r) => r.id);
// (tryEdge is always left out: trial and error on segments can take a minute per check here, and pruning runs one check per region)
const target = rulesUpTo(tier, true);
const fallback = rulesUpTo('Hard', false);                 // the Hard rules without trial and error
const cheap = RULES.filter((r) => !r.assumesUnique && !r.lookahead).map((r) => r.id);

/** One solution -> { P, cls, shown } (cls 0: the --tier rules solve it, 1: the Hard rules without trial and error, 2: neither) or a reason. */
function candidate(S, k) {
  const loop = { holes: new Uint8Array(N), edges: new Int8Array(2 * N) };
  for (const i of S.boxes) loop.holes[i] = 1;
  for (const x of S.edges) loop.edges[x] = 1;
  const numbered = new Uint8Array(nRegions).fill(1);
  let P = buildRegionalPuzzle(rows, cols, loop, owner, numbered, name);
  const sol = decodeSolution(P, P.solution);
  if (!checkSolved(P, Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0)))) return 'stored solution is not valid';
  const byRules = solvedByRules(P, cheap);              // start the exhaustive search where the rules without trial and error stop
  const u = byRules.solved ? { count: 1, exceeded: false } : solve(P, { limit: 2, maxNodes: 2000000, state: byRules.state });
  if (u.exceeded || u.count !== 1) return u.exceeded ? 'exhaustive check did not finish' : `${u.count} solutions`;
  const cls = solvedByRules(P, target).solved ? 0 : byRules.solved ? 1 : 2;
  if (cls < 2) {
    const ids = cls === 0 ? target : fallback;
    const order = shuffle([...Array(nRegions).keys()], rng);
    let left = nRegions;
    for (const g of order) {
      if (left - 1 < keep * nRegions) break;
      numbered[g] = 0;
      const Q = buildRegionalPuzzle(rows, cols, loop, owner, numbered, name);
      if (solvedByRules(Q, ids).solved) { P = Q; left--; } else numbered[g] = 1;
    }
  }
  ratePuzzle(P);
  return { P, cls, shown: numbered.reduce((s, x) => s + x, 0), boxes: S.boxes.length, k };
}

const sols = J.solutions || [{ boxes: J.boxes, edges: J.edges }];
const cands = [];
sols.forEach((S, k) => { const c = candidate(S, k); if (typeof c === 'string') console.log(`${name} #${k + 1}: ${c} with every number`); else cands.push(c); });
if (!cands.length) process.exit(3);
// the best: the lowest class; within class 0 the highest score (the most to do while staying in the tier), otherwise the lowest score
cands.sort((a, b) => a.cls - b.cls || (a.cls === 0 ? b.P.score - a.P.score : a.P.score - b.P.score));
const best = cands[0], P = best.P;
const how = ['', ' (pruned with the Hard rules: the ' + tier + ' rules cannot start)', ' (no rules without trial and error solve it even with every number, so none were dropped)'][best.cls];
console.log(`${name}: ${J.kind}, ${nRegions} regions, ${best.shown} numbered${how}, ${best.boxes} boxes; ${P.tier} (${P.rules}, score ${P.score}); best of ${cands.length} [${cands.map((c) => `${c.P.tier[0]}${c.cls}`).join(' ')}]`);
if (process.argv.includes('--draw')) process.stdout.write(drawLayout(rows, cols, owner));
if (out) {
  if (!fs.existsSync(out)) fs.writeFileSync(out, CSV_HEADER_REGIONAL + '\n');
  fs.appendFileSync(out, toCsvRow(P) + '\n');
}
