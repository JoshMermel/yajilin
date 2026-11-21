// Fill a pool with generated, rated puzzles (the pattern from the sibling projects: pools in tools/library/, then books).
//
//   node tools/generate.mjs --size 12x12 [--count 3] [--seed 1] [--budget 300] [--out tools/library/y_12x12_s1.csv]
//   node tools/generate.mjs --size 8x8 --diagonal 1 [--dirs EC]   (diagonal arrows: --diagonal is their share, 0..1; --dirs takes letters URDL and ECZQ = up-right, down-right, down-left, up-left)
//   node tools/generate.mjs --layout symmetric --size 12x12 [--numbers big|nozeros|twos]   (experiment: arrows and boxes the same after a half turn; --layout frame: arrows round the border only)
//   node tools/generate.mjs --voids-only --size 8x8   (experiment: only void cells, no numbers or arrows)
//   node tools/generate.mjs --sparse --size 6x6 [--max-clues 4] [--best-of 5] [--from-rules] [--polish-ms 30]   (experiment: as few clues as the exhaustive solver allows; difficulty is not controlled)
//   node tools/generate.mjs --regional --size 8x8 [--avg-size 5] [--density 0.2] ...   (experiment: regional puzzles, see js/generator.js)
//
// --size is COLSxROWS --budget is seconds per puzzle. Each puzzle is appended to the output file
// the moment it is found, so a long run can be stopped at any time. Every puzzle is checked (solution valid, exactly one
// solution by the exhaustive solver) and rated with the human-style solver before it is stored.
import fs from 'node:fs';
import { compile, solve, decodeSolution, checkSolved, toCsvRow, CSV_HEADER, CSV_HEADER_REGIONAL, SHADED, E_ON } from '../js/logic.js';
import { generatePuzzle, generateRegional, generateVoidsOnly, generateSparse, makeRng } from '../js/generator.js';
import { generateLayout } from '../js/generator_layouts.js';
import { ratePuzzle, RULES, solvedByRules } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const [cols, rows] = arg('size', '10x10').split('x').map(Number);
const count = +arg('count', 3), seed = +arg('seed', 1), budget = +arg('budget', 300);
const density = +arg('density', 0.3), shadeShare = +arg('shade', 0.55), acceptU = +arg('accept', 30), clump = +arg('clump', 0.5);
const edgeBias = arg('edge-bias', '') === '' ? null : +arg('edge-bias');  // e.g. 0.75: arrows mostly point at the nearer edge, like Nikoli's
const oneDirection = process.argv.includes('--one-dir');          // every arrow in a puzzle points the same way
const dirsArg = arg('dirs', '');                                  // e.g. UR: only these directions
const directions = dirsArg ? [...dirsArg].map((ch) => 'URDLECZQ'.indexOf(ch)) : null;
const numbers = arg('numbers', '') || null;                       // 'big', 'small', 'zeros' (every number 0) or 'twos' (every number at least 2) or 'nozeros' (every number at least 1)
const boxRange = arg('boxes', '') ? arg('boxes').split(',').map(Number) : null;   // e.g. 0,0.3: boxes are at most 30% of the non-loop cells; 0.7,1: at least 70%
const minMean = +arg('min-mean', 2.0);                            // with --numbers big: required mean clue number
const tightRate = +arg('tight-rate', 0);                          // tight arrows per 100 cells (Nikoli's own puzzles: about 0.65)
const cheapFirst = arg('cheap', '') === '' ? null : arg('cheap') === '1';   // climb with the cheap rules first (default: boards of 150+ cells)
const crossNodes = +arg('cross-check-nodes', 5000000);                // node cap of the from-scratch uniqueness cross-check on boards of up to 150 cells (0: skip it); a lower cap trades the tail of slow checks for coverage
const diagonal = +arg('diagonal', 0);                           // the share of the arrows that point diagonally (1: every arrow is diagonal, like "Diagonal Yajilin")
const voids = +arg('voids', 0);                                   // this many void cells (not box, not loop, no arrow) in every puzzle
const without = arg('rules-without', '') ? arg('rules-without').split(',') : null;   // experiments: generate as if these rules did not exist (their ids, comma separated)
const maxTier = arg('max-tier', '');   // 'medium': only the rules up to Medium (no shadeForcesLines etc.)
const voidsOnly = process.argv.includes('--voids-only');         // experiment: no numbers or arrows at all, only void cells (generateVoidsOnly)
const sparse = process.argv.includes('--sparse');                 // experiment: as few clues as possible, uniqueness by the exhaustive solver (generateSparse)
const layout = arg('layout', '');                                   // 'symmetric' (clues the same after a half turn of the board) or 'frame' (see js/generator_layouts.js)
const regional = process.argv.includes('--regional');             // regional puzzles (no arrows: numbered regions)
const avgSize = +arg('avg-size', 5);                              // regional: average region size
const spread = +arg('spread', 0), minNumbered = +arg('min-numbered', 0);   // regional: log-normal spread of the region sizes; keep at least this share of the regions numbered
const maxSize = +arg('max-size', 9), shape = arg('shape', 'blob');   // regional: biggest region; 'blob' | 'rows' | 'cols' (bars along rows / columns)
const out = arg('out', `${root}tools/library/${regional ? 'reg' : 'y'}_${cols}x${rows}_s${seed}.csv`);
fs.mkdirSync(new URL('../tools/library/', import.meta.url).pathname, { recursive: true });
if (!fs.existsSync(out)) fs.writeFileSync(out, (regional ? CSV_HEADER_REGIONAL : CSV_HEADER) + '\n');

const rng = makeRng(seed * 1000003 + cols * 101 + rows);
let made = 0;
for (let attempt = 0; made < count && attempt < count * 4; attempt++) {
  const t0 = Date.now();
  const name = `${regional ? 'G' : 'Y'}${cols}x${rows}_s${seed}_${made + 1}`;
  const firstLookahead = RULES.findIndex((r) => r.lookahead);
  const upto = without ? RULES.slice(0, firstLookahead).map((r) => r.id).filter((id) => !without.includes(id)) : maxTier ? RULES.findIndex((r) => r.tier === { medium: 'Hard', beginner: 'Medium' }[maxTier.toLowerCase()]) : undefined;
  const r = layout
    ? generateLayout(rows, cols, rng, { mode: layout, name, upto, budgetMs: budget * 1000, edgeBias: edgeBias ?? 0.8, numbers, uniform: arg('uniform', '') === '' ? null : +arg('uniform'), shadeShare: process.argv.includes('--shade') ? shadeShare : 0.6, prune: arg('prune', '1') !== '0', maxIter: 8000 })
    : sparse
    ? generateSparse(rows, cols, rng, { name, maxClues: +arg('max-clues', Infinity), bestOf: +arg('best-of', 1), startDensity: +arg('start-density', 0.2), shortlist: +arg('shortlist', 8), maxNodes: +arg('max-nodes', 300000), probeCap: +arg('probe-cap', 40), polish: arg('polish', '1') !== '0', polishMs: +arg('polish-ms', 30) * 1000, polishWithin: +arg('polish-within', 2), fromRules: process.argv.includes('--from-rules'), rulesFirst: arg('rules-first', '') === '' ? null : arg('rules-first') === '1', directions: directions || undefined, upto, budgetMs: budget * 1000 })
    : voidsOnly
    ? generateVoidsOnly(rows, cols, rng, { name, upto, budgetMs: budget * 1000 })
    : regional
    ? generateRegional(rows, cols, rng, { name, density: arg('density', '') === '' ? 0.2 : density, avgSize, maxSize, shape, spread, minNumbered, stuck: process.argv.includes('--stuck'), upto, acceptU: arg('accept', '') === '' ? 12 : acceptU, prune: arg('prune', '1') !== '0', budgetMs: budget * 1000 })
    : generatePuzzle(rows, cols, rng, { name, density, shadeShare, acceptU, clump, upto, edgeBias, oneDirection, directions, numbers, minMean, boxRange, cheapFirst, tightArrows: Math.round(tightRate * cols * rows / 100), prune: arg('prune', '1') !== '0', voids, diagonal, loopGate: arg('gate', '1') !== '0', tight: arg('tight', '1') !== '0', budgetMs: budget * 1000 });
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
  console.log(`${name}: ${cols}x${rows}, ${regional ? `${P.regionCells.length} regions, ${P.clues.length} numbers` : `${P.clues.filter((c) => c.n >= 0).length} clues`}${voids || voidsOnly ? `, ${P.clues.filter((c) => c.n < 0).length} voids` : ''}, ${P.tier} (${P.rules}, score ${P.score}), generated in ${((t1 - t0) / 1000).toFixed(1)} s, rated in ${((Date.now() - t1) / 1000).toFixed(1)} s, solved by rules: ${rating.solved}`);
}
console.log(`done: ${made} puzzle(s) in ${out}`);
