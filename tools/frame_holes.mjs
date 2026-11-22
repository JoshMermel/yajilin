// Holes for tools/cpsat_frame.py: a loop on an N x N board whose cells admit no other loop (tightLoop), as JSON {n, holes: [[r, c]], edges: [[[r,c],[r,c]]]}
// (1-based inside coordinates, the ring not counted).   node tools/frame_holes.mjs --inside 18 --seed 1 [--density 0.3]
import { tightLoop, makeRng } from '../js/generator.js';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const n = +arg('inside', 12), seed = +arg('seed', 1), density = +arg('density', 0.3), plantFile = arg('plant', '');
// --plant file.json: [[r, c], ...] cells that must be holes (tools/cpsat_frame.py plants the boxes the numbers need, so every arrow line can reach its number)
import fs from 'node:fs';
const planted = plantFile ? JSON.parse(fs.readFileSync(plantFile, 'utf8')).map(([r, c]) => (r - 1) * n + (c - 1)) : null;
const rng = makeRng(seed * 7919 + n);
let L = null;
for (let t = 0; t < 200 && !L; t++) L = tightLoop(n, n, rng, { startDensity: density, maxDensity: 0.6, maxIters: 8 * n * n + 400, budgetMs: 30000, preset: planted ? { holes: planted, between: new Set(), clues: [], boxes: [] } : null });
if (!L) { console.error('no loop'); process.exit(1); }
const holes = [], edges = [];
for (let i = 0; i < n * n; i++) {
  const r = (i / n) | 0, c = i % n;
  if (L.holes[i]) holes.push([r + 1, c + 1]);
  if (L.edges[2 * i]) edges.push([[r + 1, c + 1], [r + 1, c + 2]]);
  if (L.edges[2 * i + 1]) edges.push([[r + 1, c + 1], [r + 2, c + 1]]);
}
console.log(JSON.stringify({ n, holes, edges }));
