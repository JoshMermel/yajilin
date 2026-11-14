// Turn a transcribed puzzle (clue list + the black boxes seen in a solved answer key) into a CSV row, and CHECK it.
//
//   node tools/import_photo.mjs --clues clues.txt --boxes fit.json --rows 36 --cols 20 --name nk_99 --tier Nikoli [--append data/tmp.csv]
//
// clues.txt: one clue per line, "row col DIR n" (0-based, DIR one of U R D L). fit.json: { boxes: [[row, col], ...] } (the black
// boxes of the answer key). The checks make a misread clue show up: the clue numbers must equal the box counts, the puzzle must
// have exactly one solution (the human rules solve it, or a complete exhaustive search finishes), and that solution's shaded
// cells must equal the photographed boxes.
import fs from 'node:fs';
import { compile, solve, encodeSolution, toCsvRow, SHADED, DIR_LETTERS } from '../js/logic.js';
import { solvedByRules, ratePuzzle } from '../js/rating.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const rows = +arg('rows'), cols = +arg('cols'), name = arg('name', 'photo'), tier = arg('tier', '');
const clues = fs.readFileSync(arg('clues'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
  const [r, c, d, n] = l.trim().split(/\s+/);
  return { r: +r, c: +c, d: DIR_LETTERS.indexOf(d), n: +n };
});
const boxes = new Set(JSON.parse(fs.readFileSync(arg('boxes'), 'utf8')).boxes.map(([r, c]) => r * cols + c));
const P = compile({ name, rows, cols, clues });
console.log(`${name}: ${cols}x${rows}, ${clues.length} clues, ${boxes.size} photographed boxes`);

// 1. clue numbers against the photographed boxes
let bad = 0;
for (const [k, cl] of P.clues.entries()) {
  const n = P.rays[k].filter((i) => boxes.has(i)).length;
  if (n !== cl.n) { console.log(`  clue (${cl.r},${cl.c}) ${DIR_LETTERS[cl.d]}: read ${cl.n}, boxes say ${n}`); bad++; }
  if (boxes.has(cl.r * cols + cl.c)) { console.log(`  clue (${cl.r},${cl.c}) sits on a box`); bad++; }
}
console.log(bad ? `  ${bad} clue/box mismatches` : '  every clue number matches the boxes');

// 2. uniqueness and the solution
const t0 = Date.now();
const byRules = solvedByRules(P);
let sol = null, unique = null;
if (byRules.solved) { sol = byRules.state; unique = true; console.log(`  the human rules solve it outright (${Date.now() - t0} ms): the solution is unique`); }
else {
  const r = solve(P, { limit: 2, state: byRules.state, maxNodes: 20000000 });
  console.log(`  rules leave some cells open; exhaustive search from there: ${r.count} solution(s)${r.exceeded ? ', CUT OFF' : ''} (${Date.now() - t0} ms)`);
  unique = !r.exceeded && r.count === 1; sol = r.solutions[0];
}
if (!sol) { console.log('  NO SOLUTION: the transcription is wrong somewhere'); process.exit(1); }

// 3. the solution's shaded cells against the photo
const shaded = new Set();
for (let i = 0; i < P.N; i++) if (sol.cell[i] === SHADED) shaded.add(i);
const missing = [...boxes].filter((i) => !shaded.has(i)), extra = [...shaded].filter((i) => !boxes.has(i));
const at = (i) => `(${(i / cols) | 0},${i % cols})`;
console.log(missing.length || extra.length
  ? `  SOLUTION DIFFERS FROM THE PHOTO: boxes in photo not in solution ${missing.map(at).join(' ')}; shaded in solution not in photo ${extra.map(at).join(' ')}`
  : '  the solution\'s shaded cells are exactly the photographed boxes');
if (bad || missing.length || extra.length || !unique) { console.log('  NOT stored (see above).'); process.exit(2); }

P.solution = encodeSolution(P, sol);
P.tier = tier;
const t1 = Date.now();
const r = ratePuzzle(P);
P.tier = tier || P.tier;
console.log(`  rated by the human-style solver: ${r.rules} (${r.tier}), score ${r.score}, ${r.steps.length} steps, ${Date.now() - t1} ms, solved ${r.solved}`);
const row = toCsvRow({ ...P, tier });
if (arg('append')) { fs.appendFileSync(arg('append'), row + '\n'); console.log(`  appended to ${arg('append')}`); } else console.log(row);
