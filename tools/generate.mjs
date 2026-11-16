// Fill a pool with generated, rated puzzles (the pattern from the sibling projects: pools in tools/library/, then books).
//
//   node tools/generate.mjs --size 12x12 [--count 3] [--seed 1] [--budget 300] [--out tools/library/y_12x12_s1.csv]
//
// --size is COLSxROWS --budget is seconds per puzzle. Each puzzle is appended to the output file
// the moment it is found, so a long run can be stopped at any time. Every puzzle is checked (solution valid, exactly one
// solution by the exhaustive solver) and rated with the human-style solver before it is stored.
import fs from 'node:fs';
import { compile, solve, decodeSolution, checkSolved, toCsvRow, CSV_HEADER, SHADED, E_ON } from '../js/logic.js';
import { generatePuzzle, makeRng } from '../js/generator.js';
import { ratePuzzle, RULES, solvedByRules } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const [cols, rows] = arg('size', '10x10').split('x').map(Number);
const count = +arg('count', 3), seed = +arg('seed', 1), budget = +arg('budget', 300);
const density = +arg('density', 0.3), shadeShare = +arg('shade', 0.55), acceptU = +arg('accept', 30), clump = +arg('clump', 0.5);
const edgeBias = arg('edge-bias', '') === '' ? null : +arg('edge-bias');  // e.g. 0.75: arrows mostly point at the nearer edge, like Nikoli's
const oneDirection = process.argv.includes('--one-dir');          // every arrow in a puzzle points the same way
const dirsArg = arg('dirs', '');                                  // e.g. UR: only these directions
const directions = dirsArg ? [...dirsArg].map((ch) => 'URDL'.indexOf(ch)) : null;
const numbers = arg('numbers', '') || null;                       // 'big', 'small', 'zeros' (every number 0) or 'twos' (every number at least 2)
const boxRange = arg('boxes', '') ? arg('boxes').split(',').map(Number) : null;   // e.g. 0,0.3: boxes are at most 30% of the non-loop cells; 0.7,1: at least 70%
const minMean = +arg('min-mean', 2.0);                            // with --numbers big: required mean clue number
const tightRate = +arg('tight-rate', 0);                          // tight arrows per 100 cells (Nikoli's own puzzles: about 0.65)
const cheapFirst = arg('cheap', '') === '' ? null : arg('cheap') === '1';   // climb with the cheap rules first (default: boards of 150+ cells)
const crossNodes = +arg('cross-check-nodes', 5000000);                // node cap of the from-scratch uniqueness cross-check on boards of up to 150 cells (0: skip it); a lower cap trades the tail of slow checks for coverage
const voids = +arg('voids', 0);                                   // this many void cells (not box, not loop, no arrow) in every puzzle
const maxTier = arg('max-tier', '');   // 'medium': only the rules up to Medium (no shadeForcesLines etc.)
const out = arg('out', `${root}tools/library/y_${cols}x${rows}_s${seed}.csv`);
fs.mkdirSync(new URL('../tools/library/', import.meta.url).pathname, { recursive: true });
if (!fs.existsSync(out)) fs.writeFileSync(out, CSV_HEADER + '\n');

const rng = makeRng(seed * 1000003 + cols * 101 + rows);
let made = 0;
for (let attempt = 0; made < count && attempt < count * 4; attempt++) {
  const t0 = Date.now();
  const name = `Y${cols}x${rows}_s${seed}_${made + 1}`;
  const upto = maxTier ? RULES.findIndex((r) => r.tier === { medium: 'Hard', beginner: 'Medium' }[maxTier.toLowerCase()]) : undefined;
  const r = generatePuzzle(rows, cols, rng, { name, density, shadeShare, acceptU, clump, upto, edgeBias, oneDirection, directions, numbers, minMean, boxRange, cheapFirst, tightArrows: Math.round(tightRate * cols * rows / 100), prune: arg('prune', '1') !== '0', voids, loopGate: arg('gate', '1') !== '0', tight: arg('tight', '1') !== '0', budgetMs: budget * 1000 });
  if (!r) { console.log(`${name}: no puzzle within ${budget} s`); continue; }
  const P = r.puzzle;
  // check: the stored solution is valid and the exhaustive solver agrees it is the only one
  const sol = decodeSolution(P, P.solution);
  const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
  const edges = Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0));
  if (!checkSolved(P, shaded, edges)) throw new Error(`${name}: stored solution is not valid`);
  // Uniqueness. The rules are sound, so a puzzle they solve has exactly one solution; otherwise search exhaustively FROM the rules'
  // position (from scratch is hopeless on big boards: plain propagation is far weaker than the rules). Small boards are also
  // checked from scratch as an independent cross-check of the rules.
  const byRules = solvedByRules(P);
  let unique;
  if (byRules.solved) unique = { count: 1, exceeded: false };
  else unique = solve(P, { limit: 2, maxNodes: 5000000, state: byRules.state });
  if (P.N <= 150 && crossNodes > 0) {
    const scratch = solve(P, { limit: 2, maxNodes: crossNodes });
    if (!scratch.exceeded && scratch.count !== 1) throw new Error(`${name}: the rules and the exhaustive search disagree (${scratch.count} solutions from scratch)`);
  }
  if (unique.exceeded) { console.log(`${name}: exhaustive check did not finish, skipping`); continue; }
  if (unique.count !== 1) { console.log(`${name}: exhaustive solver found ${unique.count} solutions, skipping`); continue; }
  const t1 = Date.now();
  const rating = ratePuzzle(P);
  fs.appendFileSync(out, toCsvRow(P) + '\n');
  made++;
  console.log(`${name}: ${cols}x${rows}, ${P.clues.filter((c) => c.n >= 0).length} clues${voids ? `, ${P.clues.filter((c) => c.n < 0).length} voids` : ''}, ${P.tier} (${P.rules}, score ${P.score}), generated in ${((t1 - t0) / 1000).toFixed(1)} s, rated in ${((Date.now() - t1) / 1000).toFixed(1)} s, solved by rules: ${rating.solved}`);
}
console.log(`done: ${made} puzzle(s) in ${out}`);
