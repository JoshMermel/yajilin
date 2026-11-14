// How do the generator's parameters change a puzzle's difficulty and style?
//
//   node tools/param_sweep.mjs [--n 30] [--rows 14 --cols 14] [--seed 1000] [--out experiments/sweep]
//
// Generates --n puzzles for each setting in SETTINGS (a baseline plus one-factor-at-a-time variations, and a size sweep), rates
// every puzzle with the human-style solver, and writes one JSON file per setting plus a summary table (experiments/sweep/summary.md).
// Settings run in parallel (one child process each).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { compile } from '../js/logic.js';
import { generatePuzzle, makeRng } from '../js/generator.js';
import { rate, RULES } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const n = +arg('n', 30), baseSeed = +arg('seed', 1000);
const outDir = path.resolve(root, arg('out', 'experiments/sweep'));
const ROWS = +arg('rows', 14), COLS = +arg('cols', 14);

const firstOf = (tier) => RULES.findIndex((r) => r.tier === tier);
// name, what changed (group), generator options, optional size override
const BASE = { density: 0.24, shadeShare: 0.55, prune: true, acceptU: 20, clump: 0.5 };
const SETTINGS = [
  { name: 'baseline', group: 'baseline', opts: {} },
  { name: 'boxes-35', group: 'box/clue split (shadeShare)', opts: { shadeShare: 0.35 } },
  { name: 'boxes-75', group: 'box/clue split (shadeShare)', opts: { shadeShare: 0.75 } },
  { name: 'edge-25', group: 'edge bias', opts: { edgeBias: 0.25 } },
  { name: 'edge-50', group: 'edge bias', opts: { edgeBias: 0.5 } },
  { name: 'edge-75', group: 'edge bias', opts: { edgeBias: 0.75 } },
  { name: 'numbers-big', group: 'clue numbers', opts: { numbers: 'big', minMean: 1.6 } },
  { name: 'numbers-small', group: 'clue numbers', opts: { numbers: 'small' } },
  { name: 'rules-medium', group: 'rules allowed', opts: { upto: firstOf('Hard') } },
  { name: 'rules-beginner', group: 'rules allowed', opts: { upto: firstOf('Medium') } },
  { name: 'no-prune', group: 'clue pruning', opts: { prune: false } },
  { name: 'holes-16', group: 'starting holes', opts: { density: 0.16 } },
  { name: 'holes-20', group: 'starting holes', opts: { density: 0.20 } },
  { name: 'accept-0', group: 'lookahead allowed', opts: { acceptU: 0 } },
  { name: 'accept-60', group: 'lookahead allowed', opts: { acceptU: 60 } },
  { name: 'one-direction', group: 'arrow directions', opts: { oneDirection: true } },
  { name: 'clump-0', group: 'clustering of non-loop cells', opts: { clump: 0.0 } },
  { name: 'clump-90', group: 'clustering of non-loop cells', opts: { clump: 0.9 } },
  { name: 'size-8', group: 'size', opts: {}, size: [8, 8] },
  { name: 'size-10', group: 'size', opts: {}, size: [10, 10] },
  { name: 'size-12', group: 'size', opts: {}, size: [12, 12] },
  { name: 'size-16', group: 'size', opts: {}, size: [16, 16] },
  { name: 'size-20', group: 'size', opts: {}, size: [20, 20] },
];

// ------------------------------------------------------------ worker: one setting
if (process.argv.includes('--worker')) {
  const s = SETTINGS.find((x) => x.name === arg('worker'));
  const [rows, cols] = s.size || [ROWS, COLS];
  const results = [];
  let failures = 0;
  for (let k = 0; k < n; k++) {
    const t0 = Date.now();
    const r = generatePuzzle(rows, cols, makeRng(baseSeed + k * 7919 + rows), { ...BASE, ...s.opts, restarts: 3, budgetMs: 40000, name: `${s.name}_${k}` });
    if (!r) { failures++; continue; }
    const P = r.puzzle;
    const rating = rate(P);
    const N = rows * cols;
    const boxes = [...P.solution].filter((c) => c === 'x').length;
    const nn = P.clues.map((c) => c.n);
    let near = 0;
    for (const c of P.clues) { const e = [c.r, cols - 1 - c.c, rows - 1 - c.r, c.c]; const a = e[c.d], b = e[(c.d + 2) % 4]; near += a < b ? 1 : a === b ? 0.5 : 0; }
    results.push({
      ms: Date.now() - t0, N, clues: P.clues.length / N, boxes: boxes / N,
      meanN: nn.reduce((a, b) => a + b, 0) / nn.length, zeros: nn.filter((v) => v === 0).length / nn.length, nearer: near / P.clues.length,
      tier: rating.tier, rule: rating.rules, score: rating.score, steps: rating.steps.length, solved: rating.solved, counts: rating.counts,
    });
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${s.name}.json`), JSON.stringify({ setting: s, rows, cols, n, failures, results }));
  process.exit(0);
}

// ------------------------------------------------------------ main: run all settings in parallel, then summarise
fs.mkdirSync(outDir, { recursive: true });
const queue = SETTINGS.map((s) => s.name);
const workers = Math.max(2, Math.min(os.cpus().length - 1, 9));
const t0 = Date.now();
await new Promise((resolve) => {
  let running = 0;
  const next = () => {
    if (!queue.length && !running) return resolve();
    while (running < workers && queue.length) {
      const name = queue.shift(); running++;
      const args = [new URL(import.meta.url).pathname, '--worker', name, '--n', String(n), '--rows', String(ROWS), '--cols', String(COLS), '--seed', String(baseSeed), '--out', outDir];
      spawn(process.execPath, args, { stdio: 'inherit' }).on('exit', () => { running--; console.log(`  done ${name} (${Math.round((Date.now() - t0) / 1000)} s)`); next(); });
    }
  };
  next();
});

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; };
const pct = (x) => (100 * x).toFixed(1) + '%';
const rows_ = [];
for (const s of SETTINGS) {
  const d = JSON.parse(fs.readFileSync(path.join(outDir, `${s.name}.json`), 'utf8'));
  const R = d.results;
  const tiers = { Beginner: 0, Medium: 0, Hard: 0, Expert: 0 }; for (const r of R) tiers[r.tier]++;
  const rules = {}; for (const r of R) rules[r.rule] = (rules[r.rule] || 0) + 1;
  const topRule = Object.entries(rules).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(', ');
  const lookahead = mean(R.map((r) => (r.counts.tryCell || 0) + (r.counts.tryEdge || 0)));
  rows_.push({ s, d, R, line: `| ${s.name} | ${s.group} | ${d.rows}x${d.cols} | ${R.length}/${n} | ${(mean(R.map((r) => r.ms)) / 1000).toFixed(1)} s | ${pct(mean(R.map((r) => r.clues)))} | ${pct(mean(R.map((r) => r.boxes)))} | ${mean(R.map((r) => r.meanN)).toFixed(2)} | ${pct(mean(R.map((r) => r.zeros)))} | ${pct(mean(R.map((r) => r.nearer)))} | ${mean(R.map((r) => r.score)).toFixed(0)} ± ${sd(R.map((r) => r.score)).toFixed(0)} | ${(mean(R.map((r) => r.score / r.N))).toFixed(2)} | ${tiers.Beginner}/${tiers.Medium}/${tiers.Hard}/${tiers.Expert} | ${lookahead.toFixed(1)} | ${topRule} |` });
}
const md = ['# Parameter sweep', '', `${n} puzzles per setting, ${ROWS}x${COLS} unless the setting changes the size; one factor changed per row against the baseline (${JSON.stringify(BASE)}).`,
  'Difficulty is the human-style solver\'s: score = weighted sum of the steps it needed; tier = hardest rule used; lookahead = trial-and-error steps per puzzle.', '',
  '| setting | what changed | size | made | gen time | clue cells | boxes | mean n | zeros | arrows at nearer edge | score (mean ± sd) | score per cell | tiers B/M/H/E | trials | hardest rule (top 2) |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows_.map((r) => r.line)];
fs.writeFileSync(path.join(outDir, 'summary.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
