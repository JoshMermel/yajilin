// Does planting tight arrows (generator option tightArrows) make our puzzles feel like Nikoli's?
//
//   node tools/tight_experiment.mjs [--n 12] [--out experiments/tight]
//
// For each size and planting rate (tight arrows per 100 cells), generates puzzles in the Nikoli-style settings and measures: how many
// were made, the time, the share of arrows that are tight (n >= 2, exactly 2n-1 cells to the wall), the boxes the clues alone force at
// the start, clue density and the human rating. Nikoli's own puzzles (3 measured): about 5 tight arrows per 100 clues, 14 boxes forced
// at the start of a 36x20; ours without planting: 0.4-1.1 per 100 clues, about 2.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { compile, initialState } from '../js/logic.js';
import { generatePuzzle, makeRng } from '../js/generator.js';
import { rate, RULES } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const n = +arg('n', 12), outDir = path.resolve(root, arg('out', 'experiments/tight'));
const SIZES = [[10, 10], [14, 14], [16, 16], [20, 20]];
const RATES = [0, 0.3, 0.65, 1.0];
const jobs = [];
for (const [r, c] of SIZES) for (const rateP of RATES) jobs.push({ rows: r, cols: c, rate: rateP });
const key = (j) => `${j.rows}x${j.cols}_rate${j.rate}`;

function measure(P) {
  let tight = 0;
  P.clues.forEach((c, k) => { if (c.n >= 2 && P.rays[k].filter((i) => P.clueAt[i] < 0).length === 2 * c.n - 1) tight++; });
  const st = initialState(P); let forced = 0;
  for (const id of ['clueFull', 'clueTight', 'cluePlacements']) for (const f of RULES.find((r) => r.id === id).find(P, st, {})) forced += f.sets.filter(([k, , v]) => k === 'c' && v === 1).length;
  return { tight, forced };
}

if (process.argv.includes('--worker')) {
  const j = jobs[+arg('worker', 0)], results = [];
  for (let k = 0; k < n; k++) {
    const t0 = Date.now();
    const r = generatePuzzle(j.rows, j.cols, makeRng(9000 + k * 17 + j.rows), { density: 0.3, shadeShare: 0.7, edgeBias: 0.8, acceptU: 30, tightArrows: Math.round(j.rate * j.rows * j.cols / 100), restarts: 4, budgetMs: 60000, name: 'x' });
    if (!r) continue;
    const P = r.puzzle, m = measure(P), rt = rate(P);
    results.push({ ms: Date.now() - t0, clues: P.clues.length, N: j.rows * j.cols, tight: m.tight, forced: m.forced, tier: rt.tier, score: rt.score });
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, key(j) + '.json'), JSON.stringify({ job: j, n, results }));
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const queue = jobs.map((_, i) => i);
await new Promise((resolve) => {
  let running = 0;
  const next = () => {
    if (!queue.length && !running) return resolve();
    while (running < Math.max(2, Math.min(os.cpus().length - 1, 9)) && queue.length) {
      const i = queue.shift(); running++;
      spawn(process.execPath, [new URL(import.meta.url).pathname, '--worker', String(i), '--n', String(n), '--out', outDir], { stdio: 'inherit' }).on('exit', () => { running--; next(); });
    }
  };
  next();
});
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const lines = ['# Planting tight arrows', '', `${n} attempts per row; Nikoli-style settings (edge bias 0.8, shade 0.7). Rate = planted tight arrows per 100 cells.`, '',
  '| size | rate | made | gen time | clue cells | tight per 100 clues | boxes forced at the start | score | Hard share |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const j of jobs) {
  const R = JSON.parse(fs.readFileSync(path.join(outDir, key(j) + '.json'), 'utf8')).results;
  const clues = R.reduce((a, r) => a + r.clues, 0), tight = R.reduce((a, r) => a + r.tight, 0);
  lines.push(`| ${j.cols}x${j.rows} | ${j.rate} | ${R.length}/${n} | ${R.length ? (mean(R.map((r) => r.ms)) / 1000).toFixed(1) + ' s' : '-'} | ${R.length ? (100 * mean(R.map((r) => r.clues / r.N))).toFixed(1) + '%' : '-'} | ${clues ? (100 * tight / clues).toFixed(1) : '-'} | ${R.length ? mean(R.map((r) => r.forced)).toFixed(1) : '-'} | ${R.length ? Math.round(mean(R.map((r) => r.score))) : '-'} | ${R.length ? Math.round(100 * R.filter((r) => r.tier === 'Hard').length / R.length) + '%' : '-'} |`);
}
fs.writeFileSync(path.join(outDir, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
