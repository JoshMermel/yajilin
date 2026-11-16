// Assemble the regional test corpus from the pools made by tools/make_regional_corpus.sh into data/regional-corpus.csv and register it.
//
//   node tools/build_regional_corpus.mjs
//
// Puzzles are named <recipe>-<size>-<n> (so a player can say "stuck-8x8-2 needs ..."), ordered by recipe, then size, then score.
import fs from 'node:fs';
import { parseCsv, toCsv, puzzleHash } from '../js/logic.js';

const root = new URL('..', import.meta.url).pathname;
const RECIPES = ['gentle', 'beginner', 'medium', 'hard', 'big', 'rows', 'cols', 'stuck'];
const dir = root + 'tools/library/';
const seen = new Set(), out = [];
for (const rec of RECIPES) {
  const bySize = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`regc_${rec}_`) && f.endsWith('.csv')).sort()) {
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
fs.writeFileSync(root + 'data/regional-corpus.csv', toCsv(out));
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.books = manifest.books.filter((b) => b.id !== 'experiment-regional');          // the first sample book is replaced by this one
const entry = {
  id: 'regional-corpus', name: 'Experiment: regional corpus', file: 'data/regional-corpus.csv', count: out.length, label: 'Regional corpus (experiment)', group: 'Bonus',
  blurb: 'No arrows: thick lines cut the board into regions and a number says how many boxes its region holds. A spread of styles for finding the techniques.',
};
const at = manifest.books.findIndex((b) => b.id === entry.id);
if (at >= 0) manifest.books[at] = entry; else manifest.books.push(entry);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${out.length} puzzles in data/regional-corpus.csv`);
const tally = {};
for (const p of out) { const rec = p.name.split('-')[0]; (tally[rec] = tally[rec] || []).push(`${p.cols}x${p.rows} ${p.tier || '?'}${p.rules ? `/${p.rules}` : ''}`); }
for (const [rec, list] of Object.entries(tally)) console.log(`  ${rec}: ${list.join(', ')}`);
