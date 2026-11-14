// Fill a pool with generated, rated puzzles (the pattern from the sibling projects: pools in tools/library/, then books).
//
//   node tools/generate.mjs --size 12x12 [--count 3] [--seed 1] [--budget 300] [--out tools/library/y_12x12_s1.csv]
//
// --size is COLSxROWS (rows * cols must be even); --budget is seconds per puzzle. Each puzzle is appended to the output file
// the moment it is found, so a long run can be stopped at any time. Every puzzle is checked (solution valid, exactly one
// solution by the exhaustive solver) and rated with the human-style solver before it is stored.
import fs from 'node:fs';
import { compile, solve, decodeSolution, checkSolved, toCsvRow, CSV_HEADER, SHADED, E_ON } from '../js/logic.js';
import { generatePuzzle, makeRng } from '../js/generator.js';
import { ratePuzzle, RULES } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const [cols, rows] = arg('size', '10x10').split('x').map(Number);
const count = +arg('count', 3), seed = +arg('seed', 1), budget = +arg('budget', 300);
const density = +arg('density', 0.3), shadeShare = +arg('shade', 0.55), acceptU = +arg('accept', 30), clump = +arg('clump', 0.5);
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
  const r = generatePuzzle(rows, cols, rng, { name, density, shadeShare, acceptU, clump, upto, budgetMs: budget * 1000 });
  if (!r) { console.log(`${name}: no puzzle within ${budget} s`); continue; }
  const P = r.puzzle;
  // check: the stored solution is valid and the exhaustive solver agrees it is the only one
  const sol = decodeSolution(P, P.solution);
  const shaded = Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0));
  const edges = Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0));
  if (!checkSolved(P, shaded, edges)) throw new Error(`${name}: stored solution is not valid`);
  const unique = solve(P, { limit: 2, maxNodes: 20000000 });
  if (unique.exceeded) { console.log(`${name}: exhaustive check did not finish, skipping`); continue; }
  if (unique.count !== 1) { console.log(`${name}: exhaustive solver found ${unique.count} solutions, skipping`); continue; }
  const t1 = Date.now();
  const rating = ratePuzzle(P);
  fs.appendFileSync(out, toCsvRow(P) + '\n');
  made++;
  console.log(`${name}: ${cols}x${rows}, ${P.clues.length} clues, ${P.tier} (${P.rules}, score ${P.score}), generated in ${((t1 - t0) / 1000).toFixed(1)} s, rated in ${((Date.now() - t1) / 1000).toFixed(1)} s, solved by rules: ${rating.solved}`);
}
console.log(`done: ${made} puzzle(s) in ${out}`);
