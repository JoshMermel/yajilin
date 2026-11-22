// Re-rate every puzzle in the given CSV files (default: all books in data/ and the pools in tools/library/ and experiments/) and
// rewrite their rules / tier / score columns in place. Run it after changing weights in js/rating.js. Row order is kept, except that a
// file whose rows were sorted by (cells, score) is sorted again the same way.
//
//   node tools/rescore.mjs [file.csv ...] [--dry] [--jobs N]
//
// The puzzles are rated in parallel by N worker threads (default: one per core), handed out one at a time, biggest boards first, so the
// slow 20x36 boards start at once and nobody waits at the end. Each puzzle is rated on its own, so the result does not depend on N.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { compile, parseCsv, toCsv } from '../js/logic.js';
import { rate } from '../js/rating.js';

if (!isMainThread) {
  parentPort.on('message', ({ id, p }) => {
    const r = rate(compile(p));
    parentPort.postMessage({ id, rules: r.rules, tier: r.tier, score: r.score });
  });
} else {
  const root = new URL('..', import.meta.url).pathname;
  const args = process.argv.slice(2), dry = args.includes('--dry');
  const ji = args.indexOf('--jobs');
  const jobs = Math.max(1, ji >= 0 ? +args[ji + 1] : os.availableParallelism());
  let files = args.filter((a, i) => !a.startsWith('--') && !(ji >= 0 && i === ji + 1));
  if (!files.length) {
    const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.csv') ? [path.join(d, e.name)] : [])) : []);
    files = [...walk(root + 'data'), ...walk(root + 'tools/library'), ...walk(root + 'experiments')];
  }
  const key = (p) => [p.rows * p.cols, p.score ?? 0];
  const sortedBy = (ps) => ps.every((p, i) => !i || key(ps[i - 1])[0] < key(p)[0] || (key(ps[i - 1])[0] === key(p)[0] && key(ps[i - 1])[1] <= key(p)[1]));

  // read everything first: the work list is every puzzle of every file
  const books = [];
  const tasks = [];
  for (const f of files) {
    const ps = parseCsv(fs.readFileSync(f, 'utf8'));
    if (!ps.length) continue;
    const book = { f, ps, wasSorted: sortedBy(ps), changed: 0, left: ps.length };
    books.push(book);
    ps.forEach((p, i) => tasks.push({ book, i, cells: p.rows * p.cols }));
  }
  tasks.sort((a, b) => b.cells - a.cells);                      // biggest first (stable, so the order among equals is deterministic)

  const finish = (book) => {
    const { f, ps, wasSorted, changed } = book;
    if (wasSorted) ps.sort((a, b) => a.rows * a.cols - b.rows * b.cols || a.score - b.score);
    if (!dry) fs.writeFileSync(f, toCsv(ps));
    console.log(`${path.relative(root, f)}: ${ps.length} puzzles, ${changed} scores changed${wasSorted ? ', kept sorted by (cells, score)' : ''}`);
  };

  const t0 = Date.now();
  let next = 0, done = 0;
  const workers = [];
  const pending = new Map();                                    // task id -> task
  const feed = (w) => {
    if (next >= tasks.length) { w.terminate(); return; }
    const id = next++, t = tasks[id];
    pending.set(id, t);
    w.postMessage({ id, p: t.book.ps[t.i] });
  };
  let finished = 0;
  if (!tasks.length) process.exit(0);
  for (let k = 0; k < Math.min(jobs, tasks.length); k++) {
    const w = new Worker(new URL(import.meta.url));
    w.on('message', ({ id, rules, tier, score }) => {
      const t = pending.get(id); pending.delete(id);
      const p = t.book.ps[t.i];
      if (p.score !== score) t.book.changed++;
      p.rules = rules; p.tier = tier; p.score = score;
      done++;
      if (!--t.book.left) { finish(t.book); finished++; }
      if (process.stderr.isTTY && done % 200 === 0) process.stderr.write(`\r${done}/${tasks.length} puzzles, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      feed(w);
    });
    w.on('error', (e) => { console.error(e); process.exit(1); });
    workers.push(w);
    feed(w);
  }
  process.on('exit', () => { if (process.stderr.isTTY) process.stderr.write('\r'); });
  console.error(`rating with ${workers.length} worker${workers.length > 1 ? 's' : ''}; each file is written as it finishes`);
}
