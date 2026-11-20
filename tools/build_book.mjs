// Assemble a book from the pools in tools/library/ into data/<id>.csv and register it in data/manifest.json.
//
//   node tools/build_book.mjs --id large --name "Large (draft)" [--glob y_[,more_]] [--min-cells 100] [--dir tools/library/overnight/8x8] [--limit 100]
//                              [--sizes 10x10,12x12,14x14]   (only those sizes, an even share of --limit from each)
//
// Puzzles are deduplicated (by content hash), sorted by board size and then rated score, and numbered. Re-running replaces
// the book. (The sibling projects' builders are much fancier: tier shares, stable rebuilds. This is the first draft.)
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
import { pickBySize, sizesArg, byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const id = arg('id', 'large'), name = arg('name', 'Large (draft)'), prefixes = arg('glob', 'y_').split(','), minCells = +arg('min-cells', 0);

const dir = path.resolve(root, arg('dir', 'tools/library')) + '/';
const seen = new Set();
const puzzles = [];
for (const f of fs.readdirSync(dir).filter((f) => prefixes.some((x) => f.startsWith(x)) && f.endsWith('.csv')).sort()) {
  for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
    const h = symmetryKey(p);   // a turned or mirrored copy counts as the same puzzle
    if (seen.has(h) || p.rows * p.cols < minCells) continue;
    seen.add(h); puzzles.push(p);
  }
}
puzzles.sort(byTierScore);
const limit = +arg('limit', 0);               // --limit 100: more than that are thinned out evenly (by size, then score), keeping the spread
const sizes = sizesArg(process.argv);         // --sizes 10x10,12x12,14x14: only these sizes, an even share of the limit from each (see quota.mjs)
if (sizes) puzzles.splice(0, puzzles.length, ...pickBySize(puzzles, sizes, limit));
else if (limit && puzzles.length > limit) { const keep = new Set(Array.from({ length: limit }, (_, k) => Math.floor(((k + 0.5) * puzzles.length) / limit))); puzzles.splice(0, puzzles.length, ...puzzles.filter((_, i) => keep.has(i))); }
puzzles.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(Math.max(2, String(puzzles.length).length), '0')}`; });
fs.writeFileSync(`${root}data/${id}.csv`, toCsv(puzzles));

const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.books = manifest.books || [];
const at = manifest.books.findIndex((b) => b.id === id);            // a rebuilt book keeps its place, group, label and blurb
const entry = { ...(at >= 0 ? manifest.books[at] : {}), id, name, file: `data/${id}.csv`, count: puzzles.length };
if (at >= 0) manifest.books[at] = entry; else manifest.books.push(entry);
if (!manifest.default) manifest.default = id;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${puzzles.length} puzzles in data/${id}.csv: ${puzzles.map((p) => `${p.cols}x${p.rows} ${p.tier}`).join(', ')}`);
