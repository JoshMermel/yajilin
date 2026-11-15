// Which sets of rules can the generator make puzzles for, and how do those puzzles look? (Step towards beginner-tier puzzles.)
//
//   node tools/beginner_experiment.mjs [--n 20] [--out experiments/beginner]
//
// For each rule set (Beginner without and with noEarlyClose; plus tightCell and deadEndNeighbor; all Medium) x size x pruning on/off,
// generates puzzles that THAT set of rules solves (no lookahead acceptance), and reports how many were made, how long it took,
// clue density, clues that are redundant for uniqueness, and the human rating. Runs the combinations in parallel.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { compile, solve } from '../js/logic.js';
import { generatePuzzle, makeRng } from '../js/generator.js';
import { rate, RULES } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const n = +arg('n', 20), outDir = path.resolve(root, arg('out', 'experiments/beginner'));
const tier = (t) => RULES.filter((r) => r.tier === t && !r.free && !r.assumesUnique && !r.lookahead).map((r) => r.id);
const B = tier('Beginner'), M = tier('Medium');
const SETS = {
  'beginner without noEarlyClose': B.filter((id) => id !== 'noEarlyClose'),
  'beginner': B,                                              // noEarlyClose is the last Beginner rule since 2026-11-14
  'beginner+tightCell+deadEndNeighbor': [...B, 'tightCell', 'deadEndNeighbor'],
  'all Medium': [...B, ...M],
};
const SIZES = [[6, 6], [7, 7], [8, 8], [9, 9]];   // the sizes of the site's daily Easy, Easy/Medium, Medium and Hard puzzles
const jobs = [];
for (const set of Object.keys(SETS)) for (const [r, c] of SIZES) for (const prune of [true, false]) jobs.push({ set, rows: r, cols: c, prune });
const key = (j) => `${j.set}_${j.rows}x${j.cols}_${j.prune ? 'prune' : 'noprune'}`.replace(/[^\w.-]/g, '_');

if (process.argv.includes('--worker')) {
  const j = jobs[+arg('worker', 0)];
  const results = [];
  for (let k = 0; k < n; k++) {
    const t0 = Date.now();
    const r = generatePuzzle(j.rows, j.cols, makeRng(4000 + k * 31 + j.rows), { density: 0.24, shadeShare: 0.55, prune: j.prune, acceptU: 0, upto: SETS[j.set], restarts: 3, budgetMs: 20000, name: 'x' });
    if (!r) continue;
    const P = r.puzzle, N = j.rows * j.cols;
    let redundant = 0;
    for (let q = 0; q < P.clues.length; q++) {
      const Q = compile({ ...P, clues: P.clues.filter((_, i) => i !== q).map((c) => ({ ...c })) });
      const u = solve(Q, { limit: 2, maxNodes: 2e6 });
      if (!u.exceeded && u.count === 1) redundant++;
    }
    const rt = rate(P);
    results.push({ ms: Date.now() - t0, density: P.clues.length / N, clues: P.clues.length, redundant, tier: rt.tier, hardest: rt.rules, score: rt.score });
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
const lines = ['# Generating puzzles for a given set of rules', '', `${n} attempts per row; acceptance only by the rule set itself (no lookahead), 20 s budget per puzzle.`, '',
  '| rule set | size | pruned | made | gen time | clue cells | redundant clues | score | tiers B/M/H | hardest rule (top) |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
for (const j of jobs) {
  const d = JSON.parse(fs.readFileSync(path.join(outDir, key(j) + '.json'), 'utf8')), R = d.results;
  const t = { Beginner: 0, Medium: 0, Hard: 0 }; for (const r of R) t[r.tier] = (t[r.tier] || 0) + 1;
  const h = {}; for (const r of R) h[r.hardest] = (h[r.hardest] || 0) + 1;
  const top = Object.entries(h).sort((a, b) => b[1] - a[1])[0];
  lines.push(`| ${j.set} | ${j.cols}x${j.rows} | ${j.prune ? 'yes' : 'no'} | ${R.length}/${n} | ${R.length ? (mean(R.map((r) => r.ms)) / 1000).toFixed(1) + ' s' : '-'} | ${R.length ? (100 * mean(R.map((r) => r.density))).toFixed(1) + '%' : '-'} | ${R.length ? mean(R.map((r) => r.redundant)).toFixed(2) : '-'} | ${R.length ? Math.round(mean(R.map((r) => r.score))) : '-'} | ${t.Beginner}/${t.Medium}/${t.Hard} | ${top ? top[0] + ' ' + top[1] : '-'} |`);
}
fs.writeFileSync(path.join(outDir, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
