// Assemble the diagonal test corpus from the pools made by tools/make_diagonal_corpus.sh into data/diagonal-corpus.csv and register it.
//
//   node tools/build_diagonal_corpus.mjs
//
// Puzzles are named <recipe>-<size>-<n> (so a player can say "half-8x8-2 needs ..."), ordered by recipe, then size, then score.
import fs from 'node:fs';
import { parseCsv, toCsv, puzzleHash } from '../js/logic.js';

const root = new URL('..', import.meta.url).pathname;
const RECIPES = ['beginner', 'medium', 'hard', 'half', 'quarter'];
const dir = root + 'tools/library/';
const seen = new Set(), out = [];
for (const rec of RECIPES) {
  const bySize = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`diag_${rec}_`) && f.endsWith('.csv')).sort()) {
    for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
      const h = puzzleHash(p);
      if (seen.has(h)) continue;
      seen.add(h);
      const size = `${p.cols}x${p.rows}`;
      if (!bySize.has(size)) bySize.set(size, []);
      bySize.get(size).push(p);
    }
  }
  const sizes = [...bySize.keys()].sort((a, b) => a.split('x')[0] * a.split('x')[1] - b.split('x')[0] * b.split('x')[1]);
  for (const size of sizes) {
    bySize.get(size).sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).forEach((p, i) => { p.name = `${rec}-${size}-${i + 1}`; out.push(p); });
  }
}
fs.writeFileSync(root + 'data/diagonal-corpus.csv', toCsv(out));
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entry = {
  id: 'diagonal-corpus', name: 'Experiment: diagonal corpus', file: 'data/diagonal-corpus.csv', count: out.length, label: 'Diagonal corpus (experiment)', group: 'Bonus',
  blurb: 'Arrows that point along diagonals: a diagonal arrow counts the boxes on its diagonal to the edge. A spread of styles for finding the techniques.',
};
const at = manifest.books.findIndex((b) => b.id === entry.id);
if (at >= 0) manifest.books[at] = entry; else manifest.books.push(entry);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${out.length} puzzles in data/diagonal-corpus.csv`);
const tally = {};
for (const p of out) { const rec = p.name.split('-')[0]; (tally[rec] = tally[rec] || []).push(`${p.cols}x${p.rows} ${p.tier || '?'}${p.rules ? `/${p.rules}` : ''}`); }
for (const [rec, list] of Object.entries(tally)) console.log(`  ${rec}: ${list.join(', ')}`);
