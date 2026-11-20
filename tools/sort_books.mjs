// Put every book in the manifest in the order the builders now use: easiest tier first, then lowest score (tools/quota.mjs byTierScore).
// Idempotent. Renumbers the trailing index of a puzzle's name ("8X8-0042", "SKINNY-07 (4x36)") to follow the new order, keeping its width;
// names that are not numbered like that (the regional corpus's recipe names) are left alone. Saved progress is keyed by puzzle content, so it survives.
//   node tools/sort_books.mjs [--check]     (--check only reports the books that are out of order)
import fs from 'node:fs';
import { parseCsv, toCsv } from '../js/logic.js';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname;
const check = process.argv.includes('--check');
const manifest = JSON.parse(fs.readFileSync(root + 'data/manifest.json', 'utf8'));
let moved = 0;
for (const b of manifest.books.filter((b) => !b.hidden)) {      // (the armory is in the order of docs/how_to_solve.md)
  const text = fs.readFileSync(root + b.file, 'utf8');
  const ps = parseCsv(text);
  const sorted = ps.map((p, i) => [p, i]).sort((x, y) => byTierScore(x[0], y[0]) || x[1] - y[1]).map(([p]) => p);   // stable
  const same = sorted.every((p, i) => p === ps[i]);
  if (same) continue;
  moved++;
  console.log(`${b.id}: ${check ? 'out of order' : 'sorted'} (${sorted.filter((p, i) => p !== ps[i]).length} of ${ps.length} puzzles move)`);
  if (check) continue;
  const m = /^(.*-)(\d+)( \(.*\))?$/.exec(sorted[0].name);
  if (m && b.id !== 'regional-corpus') {
    const width = m[2].length;
    sorted.forEach((p, i) => { const q = /^(.*-)(\d+)( \(.*\))?$/.exec(p.name); p.name = `${q[1]}${String(i + 1).padStart(width, '0')}${q[3] || ''}`; });
  }
  fs.writeFileSync(root + b.file, toCsv(sorted));
}
console.log(moved ? `${moved} book(s) ${check ? 'out of order' : 're-sorted'}` : 'every book is in order');
