// Re-rate every puzzle in the given CSV files (default: all books in data/ and the pools in tools/library/ and experiments/) and
// rewrite their rules / tier / score columns in place. Run it after changing weights in js/rating.js. Row order is kept, except that a
// file whose rows were sorted by (cells, score) is sorted again the same way.
//
//   node tools/rescore.mjs [file.csv ...] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { compile, parseCsv, toCsv } from '../js/logic.js';
import { rate } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2), dry = args.includes('--dry');
let files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.csv') ? [path.join(d, e.name)] : [])) : []);
  files = [...walk(root + 'data'), ...walk(root + 'tools/library'), ...walk(root + 'experiments')];
}
const key = (p) => [p.rows * p.cols, p.score ?? 0];
const sortedBy = (ps) => ps.every((p, i) => !i || key(ps[i - 1])[0] < key(p)[0] || (key(ps[i - 1])[0] === key(p)[0] && key(ps[i - 1])[1] <= key(p)[1]));
for (const f of files) {
  const ps = parseCsv(fs.readFileSync(f, 'utf8'));
  if (!ps.length) continue;
  const wasSorted = sortedBy(ps);
  let changed = 0;
  for (const p of ps) {
    const r = rate(compile(p));
    if (p.score !== r.score) changed++;
    p.rules = r.rules; p.tier = r.tier; p.score = r.score;
  }
  if (wasSorted) ps.sort((a, b) => a.rows * a.cols - b.rows * b.cols || a.score - b.score);
  if (!dry) fs.writeFileSync(f, toCsv(ps));
  console.log(`${path.relative(root, f)}: ${ps.length} puzzles, ${changed} scores changed${wasSorted ? ', kept sorted by (cells, score)' : ''}`);
}
