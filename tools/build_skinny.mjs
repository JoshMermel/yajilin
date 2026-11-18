// Assemble experiments/tall/pools/*.csv into the book data/bonus-skinny.csv ("Bonus: skinny"): boards whose longer side is at most 36.
// (The pools also hold the older, longer ribbons up to 8x100; they stay there but are not in the book. The page shows a skinny board
// sideways when that fits the window better.)
import fs from 'node:fs';
import { parseCsv, toCsv, puzzleHash } from '../js/logic.js';
import { pickBySize, sizesArg, byTierScore } from './quota.mjs';
const root = new URL('..', import.meta.url).pathname, dir = root + 'experiments/tall/pools/';
const MAX_SIDE = 36, LIMIT = +(process.argv[process.argv.indexOf('--limit') + 1] || 0);   // --limit 100 thins a bigger pool out evenly
const seen = new Set(), ps = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) {
  for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
    const h = puzzleHash(p);
    if (seen.has(h) || Math.max(p.rows, p.cols) > MAX_SIDE) continue;
    seen.add(h); ps.push(p);
  }
}
ps.sort(byTierScore);
const SIZES = sizesArg(process.argv);                       // --sizes 4x36,6x36,8x36: only these sizes, an even share of --limit from each
if (SIZES) ps.splice(0, ps.length, ...pickBySize(ps, SIZES, LIMIT));
else if (LIMIT && ps.length > LIMIT) { const keep = new Set(Array.from({ length: LIMIT }, (_, k) => Math.floor(((k + 0.5) * ps.length) / LIMIT))); ps.splice(0, ps.length, ...ps.filter((_, i) => keep.has(i))); }
ps.forEach((p, i) => { p.name = `SKINNY-${String(i + 1).padStart(2, '0')} (${p.cols}x${p.rows})`; });
fs.writeFileSync(root + 'data/bonus-skinny.csv', toCsv(ps));
const mp = root + 'data/manifest.json', m = JSON.parse(fs.readFileSync(mp, 'utf8'));
m.books = m.books || [];
const at = m.books.findIndex((b) => b.id === 'bonus-skinny' || b.id === 'bonus-tall');          // a rebuilt book keeps its place and group
const entry = { ...(at >= 0 ? m.books[at] : { group: 'Bonus' }), id: 'bonus-skinny', name: 'Bonus: skinny', label: 'Skinny', blurb: 'Narrow boards, up to 36 cells long: a ribbon to follow.', file: 'data/bonus-skinny.csv', count: ps.length };
if (at >= 0) m.books[at] = entry; else m.books.push(entry);
fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
console.log(ps.map((p) => `${p.name} ${p.tier} ${p.score}`).join('\n'));
