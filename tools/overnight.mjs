// Overnight generation: many Nikoli-style puzzles per board size, in chunks, with a stop time, resumable, and a summary at the end.
//
//   caffeinate -i node tools/overnight.mjs [--sizes 12x12:1000,16x16:1000,20x20:1000,20x36:1000] [--chunk 25] [--workers 9]
//                                          [--hours 8] [--budget 900] [--out tools/library/overnight] [--seed-base 70000] [--tight-rate 0.5]
//
// Each job runs tools/generate.mjs for one size (COLSxROWS) with its own seed and writes <out>/<size>/s<seed>.csv as it goes (every
// puzzle is verified: valid, exactly one solution; rated). Jobs are started biggest boards first. No new job starts after --hours; jobs
// already running finish. Re-running tops each size up to its target (it counts the puzzles already in <out>/<size>/), so it is safe to
// stop and restart. Progress: <out>/progress.json (every 30 s); at the end: <out>/summary.md. Nothing here touches the books.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { compile, parseCsv } from '../js/logic.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const sizes = arg('sizes', '12x12:1000,16x16:1000,20x20:1000,20x36:1000').split(',').map((s) => { const [sz, n] = s.split(':'); return { size: sz, target: +n }; });
const chunk = +arg('chunk', 25), workers = +arg('workers', 9), hours = +arg('hours', 8), budget = +arg('budget', 900);
const outDir = path.resolve(root, arg('out', 'tools/library/overnight'));
const seedBase = +arg('seed-base', 70000), tightRate = arg('tight-rate', '0.5');
const t0 = Date.now(), stopAt = t0 + hours * 3600 * 1000;
const area = (sz) => sz.split('x').reduce((a, b) => a * +b, 1);

const countIn = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).reduce((n, f) => n + parseCsv(fs.readFileSync(path.join(dir, f), 'utf8')).length, 0);
};

// the jobs still needed, biggest boards first
const jobs = [];
for (const { size, target } of sizes.slice().sort((a, b) => area(b.size) - area(a.size))) {
  const dir = path.join(outDir, size);
  fs.mkdirSync(dir, { recursive: true });
  let need = target - countIn(dir);
  for (let k = 0; need > 0; k++) {
    const seed = seedBase + k + 1000 * area(size) % 9973;
    const file = path.join(dir, `s${seed}.csv`);
    if (fs.existsSync(file)) continue;                    // a seed already used (its puzzles are counted above)
    const count = Math.min(chunk, need);
    jobs.push({ size, seed, count, file });
    need -= count;
  }
}
fs.mkdirSync(path.join(outDir, 'logs'), { recursive: true });
console.log(`${jobs.length} jobs, ${workers} at a time, stop starting at ${new Date(stopAt).toLocaleTimeString()}`);

let running = 0, started = 0, finished = 0, skipped = 0;
const writeProgress = () => {
  const per = {};
  for (const { size, target } of sizes) per[size] = { target, have: countIn(path.join(outDir, size)) };
  fs.writeFileSync(path.join(outDir, 'progress.json'), JSON.stringify({ now: new Date().toISOString(), elapsedMin: Math.round((Date.now() - t0) / 60000), jobs: jobs.length, started, finished, running, per }, null, 1));
};
const timer = setInterval(writeProgress, 30000);

await new Promise((resolve) => {
  const next = () => {
    while (running < workers && jobs.length && Date.now() < stopAt) {
      const j = jobs.shift(); running++; started++;
      const log = fs.openSync(path.join(outDir, 'logs', `${j.size}_s${j.seed}.log`), 'w');
      const args = ['tools/generate.mjs', '--size', j.size, '--count', String(j.count), '--seed', String(j.seed), '--budget', String(budget), '--edge-bias', '0.8', '--shade', '0.7', '--tight-rate', tightRate, '--out', j.file];
      spawn(process.execPath, args, { cwd: root, stdio: ['ignore', log, log] }).on('exit', () => { running--; finished++; writeProgress(); next(); });
    }
    if (!running && (!jobs.length || Date.now() >= stopAt)) { skipped = jobs.length; resolve(); }
  };
  next();
});
clearInterval(timer);
writeProgress();

// ---- summary
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const lines = ['# Overnight generation', '', `Started ${new Date(t0).toLocaleString()}, took ${((Date.now() - t0) / 3600000).toFixed(2)} h; ${started} jobs run, ${skipped} not started (past the stop time). Nikoli-style: edge bias 0.8, shade 0.7, tight arrows ${tightRate} per 100 cells.`, '',
  '| size (cols x rows) | target | made | tiers B/M/H | score min / median / max | clue cells | tight per 100 clues |', '| --- | --- | --- | --- | --- | --- | --- |'];
for (const { size, target } of sizes) {
  const ps = [];
  const dir = path.join(outDir, size);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.csv')) : []) ps.push(...parseCsv(fs.readFileSync(path.join(dir, f), 'utf8')));
  const seen = new Set(), uniq = ps.filter((p) => { const k = p.clues.map((c) => `${c.r}:${c.c}:${c.d}:${c.n}`).join(';'); if (seen.has(k)) return false; seen.add(k); return true; });
  let clues = 0, tight = 0;
  for (const raw of uniq) { const P = compile(raw); clues += P.clues.length; P.clues.forEach((c, k) => { if (c.n >= 2 && P.rays[k].filter((i) => P.clueAt[i] < 0).length === 2 * c.n - 1) tight++; }); }
  const sc = uniq.map((p) => p.score).filter((v) => v != null).sort((a, b) => a - b);
  const t = { Beginner: 0, Medium: 0, Hard: 0 }; for (const p of uniq) t[p.tier] = (t[p.tier] || 0) + 1;
  const cells = uniq.length ? area(size) : 0;
  lines.push(`| ${size} | ${target} | ${uniq.length}${uniq.length < ps.length ? ` (${ps.length - uniq.length} duplicates dropped)` : ''} | ${t.Beginner}/${t.Medium}/${t.Hard} | ${sc.length ? `${sc[0]} / ${sc[sc.length >> 1]} / ${sc[sc.length - 1]}` : '-'} | ${uniq.length ? (100 * clues / (uniq.length * cells)).toFixed(1) + '%' : '-'} | ${clues ? (100 * tight / clues).toFixed(1) : '-'} |`);
}
fs.writeFileSync(path.join(outDir, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
