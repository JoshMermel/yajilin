// Assemble experiments/tall/pools/*.csv into the book data/bonus-skinny.csv ("Bonus: skinny"): boards whose longer side is at most 36.
// (The pools also hold the older, longer ribbons up to 8x100; they stay there but are not in the book. The page shows a skinny board
// sideways when that fits the window better.)
import fs from 'node:fs';
import { parseCsv, toCsv, puzzleHash } from '../js/logic.js';
const root = new URL('..', import.meta.url).pathname, dir = root + 'experiments/tall/pools/';
const MAX_SIDE = 36;
const seen = new Set(), ps = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) {
  for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
    const h = puzzleHash(p);
    if (seen.has(h) || Math.max(p.rows, p.cols) > MAX_SIDE) continue;
    seen.add(h); ps.push(p);
  }
}
ps.sort((a, b) => a.rows * a.cols - b.rows * b.cols || a.score - b.score);
ps.forEach((p, i) => { p.name = `SKINNY-${String(i + 1).padStart(2, '0')} (${p.cols}x${p.rows})`; });
fs.writeFileSync(root + 'data/bonus-skinny.csv', toCsv(ps));
const mp = root + 'data/manifest.json', m = JSON.parse(fs.readFileSync(mp, 'utf8'));
m.books = m.books || [];
const at = m.books.findIndex((b) => b.id === 'bonus-skinny' || b.id === 'bonus-tall');          // a rebuilt book keeps its place and group
const entry = { ...(at >= 0 ? m.books[at] : { group: 'Bonus' }), id: 'bonus-skinny', name: 'Bonus: skinny', label: 'Skinny', blurb: 'Narrow boards, up to 36 cells long: a ribbon to follow.', file: 'data/bonus-skinny.csv', count: ps.length };
if (at >= 0) m.books[at] = entry; else m.books.push(entry);
fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
console.log(ps.map((p) => `${p.name} ${p.tier} ${p.score}`).join('\n'));
