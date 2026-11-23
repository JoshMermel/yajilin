// Make a pool of hex puzzles on worker threads (a puzzle takes a few seconds at 8x8, so this is the way to get hundreds).
//
//   node tools/hex_pool.mjs --size 8x8 --count 60 [--jobs 8] [--seed 1] [--budget 120000] [--out tools/library/hex/hex-8x8-s1.csv]
//
// Every puzzle is unique-solution and falls to propagation plus a one-step lookahead (see js/generator_hex.js). `score` is the number of
// lookahead deductions it takes (0 = propagation alone), so a book can run from easy to hard by it. Puzzles that fail within the budget are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { makeRng } from '../js/generator.js';
import { generateHex } from '../js/generator_hex.js';
import { toCsv } from '../js/logic.js';

if (isMainThread) {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
  const size = args.size || '8x8', count = +(args.count || 20), jobs = +(args.jobs || 8), seed = +(args.seed || 1), budgetMs = +(args.budget || 120000);
  const out = args.out || `tools/library/hex/hex-${size}-s${seed}.csv`;
  const puzzles = [], reasons = {};
  let done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(jobs, count) }, (_, w) => new Promise((resolve) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { size, count, jobs, seed, budgetMs, w } });
    worker.on('message', (m) => {
      done++;
      if (m.fail) reasons[m.fail] = (reasons[m.fail] || 0) + 1; else puzzles.push(m.puzzle);
      process.stdout.write(`\r${done}/${count} tried, ${puzzles.length} made, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    });
    worker.on('exit', resolve);
  })));
  console.log(`\n${size}: ${puzzles.length} puzzles${Object.keys(reasons).length ? `, failed: ${JSON.stringify(reasons)}` : ''}`);
  puzzles.sort((a, b) => a.score - b.score);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toCsv(puzzles));
  console.log(`wrote ${out}; lookahead steps ${puzzles.map((p) => p.score).join(' ')}`);
} else {
  const { size, count, jobs, seed, budgetMs, w } = workerData;
  const [rows, cols] = size.split('x').map(Number);
  for (let k = w; k < count; k += jobs) {
    const g = generateHex(rows, cols, makeRng(seed * 100000 + k), { name: `hex-${size}-${seed}-${k + 1}`, budgetMs });
    if (g.fail) { parentPort.postMessage({ fail: g.fail }); continue; }
    const P = g.puzzle;
    parentPort.postMessage({ puzzle: { name: P.name, grid: 'hex', rows, cols, clues: P.clues, solution: P.solution, rules: '', tier: '', score: g.stats.steps, boxes: [] } });
  }
}
