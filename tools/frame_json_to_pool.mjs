// A frame puzzle from tools/cpsat_frame.py / cpsat_frame2.py (JSON {rows, cols, clues, boxes, edges}) -> a row of a pool tools/library/frame_*.csv:
// checks the stored solution, checks uniqueness with the exhaustive solver (and the rules from scratch where cheap), rates it, appends it.
//   node tools/frame_json_to_pool.mjs frame.json --name FRAME-IRR-x --out tools/library/frame_irr_12_1.csv [--trust-solver]
// --trust-solver: keep a puzzle whose exhaustive check runs out of nodes (the CEGAR loop of cpsat_frame2.py only ends when OR-tools proves no other solution exists)
import fs from 'node:fs';
import { compile, initialState, encodeSolution, decodeSolution, checkSolved, solve, toCsvRow, CSV_HEADER, CLUE, SHADED, LOOP, E_ON, E_OFF } from '../js/logic.js';
import { ratePuzzle, solvedByRules } from '../js/rating.js';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const file = process.argv[2], J = JSON.parse(fs.readFileSync(file, 'utf8')), out = arg('out'), name = arg('name', 'FRAME');
const { rows, cols } = J, P = compile({ name, rows, cols, clues: J.clues });
const st = initialState(P), box = new Set(J.boxes.map(([r, c]) => r * cols + c));
for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0) st.cell[i] = box.has(i) ? SHADED : LOOP;
st.e.fill(E_OFF);
const D = [[-1, 0], [0, 1], [1, 0], [0, -1]];
for (const [[r1, c1], [r2, c2]] of J.edges) {
  const i = r1 * cols + c1, d = D.findIndex(([dr, dc]) => r1 + dr === r2 && c1 + dc === c2);
  if (d < 0) throw new Error('edge between non-neighbours');
  st.e[P.ed[i * 4 + d]] = E_ON;
}
P.solution = encodeSolution(P, st);
const sol = decodeSolution(P, P.solution);
if (!checkSolved(P, Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0)))) { console.log(`${name}: stored solution is not valid`); process.exit(2); }
const byRules = solvedByRules(P);
const u = byRules.solved ? { count: 1, exceeded: false } : solve(P, { limit: 2, maxNodes: 300000, state: byRules.state });
const trust = process.argv.includes('--trust-solver');   // big boards: the exhaustive search may not finish; OR-tools has already proved there is no second solution
if (u.exceeded && !trust) { console.log(`${name}: exhaustive check did not finish`); process.exit(3); }
if (!u.exceeded && u.count !== 1) { console.log(`${name}: ${u.count} solutions`); process.exit(4); }
ratePuzzle(P);
fs.mkdirSync(new URL('../tools/library/', import.meta.url).pathname, { recursive: true });
if (!fs.existsSync(out)) fs.writeFileSync(out, CSV_HEADER + '\n');
fs.appendFileSync(out, toCsvRow(P) + '\n');
console.log(`${name}: unique, ${P.tier} (${P.rules}, score ${P.score}) -> ${out}`);
