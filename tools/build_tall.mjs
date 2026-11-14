// Assemble experiments/tall/pools/*.csv into the book data/experiment-tall.csv ("Experiment: tall and skinny").
import fs from 'node:fs';
import { parseCsv, toCsv, puzzleHash } from '../js/logic.js';
const root = new URL('..', import.meta.url).pathname, dir = root + 'experiments/tall/pools/';
const seen = new Set(), ps = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort()) for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) { const h = puzzleHash(p); if (!seen.has(h)) { seen.add(h); ps.push(p); } }
ps.sort((a, b) => a.rows * a.cols - b.rows * b.cols || a.score - b.score);
ps.forEach((p, i) => { p.name = `TALL-${String(i + 1).padStart(2, '0')} (${p.cols}x${p.rows})`; });
fs.writeFileSync(root + 'data/experiment-tall.csv', toCsv(ps));
const mp = root + 'data/manifest.json', m = JSON.parse(fs.readFileSync(mp, 'utf8'));
m.books = m.books.filter((b) => b.id !== 'experiment-tall');
m.books.push({ id: 'experiment-tall', name: 'Experiment: tall and skinny', file: 'data/experiment-tall.csv' });
fs.writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
console.log(ps.map((p) => `${p.name} ${p.tier} ${p.score}`).join('\n'));
