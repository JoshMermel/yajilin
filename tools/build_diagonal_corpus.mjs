// Assemble the diagonal test corpus from the pools made by tools/make_diagonal_corpus.sh into the books data/diagonal-{all,half,quarter}.csv and register them (group Diagonal).
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
// three books: every arrow diagonal, half of them, a quarter of them
const BOOKS = [
  { id: 'diagonal-all', recipes: ['beginner', 'medium', 'hard'], label: 'All diagonal', blurb: 'Every arrow points along a diagonal, so a diagonal arrow counts the boxes on its diagonal to the edge. Beginner to Hard.' },
  { id: 'diagonal-half', recipes: ['half'], label: 'Half diagonal', blurb: 'Half the arrows are diagonal, the rest point up, down, left or right.' },
  { id: 'diagonal-quarter', recipes: ['quarter'], label: 'A quarter diagonal', blurb: 'Mostly ordinary arrows, with a quarter of them diagonal.' },
];
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.books = manifest.books.filter((b) => b.id !== 'diagonal-corpus');          // the single experiment book this replaced
fs.rmSync(root + 'data/diagonal-corpus.csv', { force: true });
for (const b of BOOKS) {
  const puzzles = out.filter((p) => b.recipes.includes(p.name.split('-')[0]));
  fs.writeFileSync(root + `data/${b.id}.csv`, toCsv(puzzles));
  const entry = { id: b.id, name: `Diagonal: ${b.label.toLowerCase()}`, file: `data/${b.id}.csv`, count: puzzles.length, label: b.label, group: 'Diagonal', blurb: b.blurb };
  const at = manifest.books.findIndex((x) => x.id === b.id);
  if (at >= 0) manifest.books[at] = { ...manifest.books[at], ...entry }; else manifest.books.push(entry);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${out.length} puzzles in ${BOOKS.map((b) => b.id).join(', ')}`);
const tally = {};
for (const p of out) { const rec = p.name.split('-')[0]; (tally[rec] = tally[rec] || []).push(`${p.cols}x${p.rows} ${p.tier || '?'}${p.rules ? `/${p.rules}` : ''}`); }
for (const [rec, list] of Object.entries(tally)) console.log(`  ${rec}: ${list.join(', ')}`);
