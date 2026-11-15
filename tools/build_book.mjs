// Assemble a book from the pools in tools/library/ into data/<id>.csv and register it in data/manifest.json.
//
//   node tools/build_book.mjs --id large --name "Large (draft)" [--glob y_] [--min-cells 100] [--dir tools/library/overnight/8x8]
//
// Puzzles are deduplicated (by content hash), sorted by board size and then rated score, and numbered. Re-running replaces
// the book. (The sibling projects' builders are much fancier: tier shares, stable rebuilds. This is the first draft.)
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsv, puzzleHash } from '../js/logic.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const id = arg('id', 'large'), name = arg('name', 'Large (draft)'), prefix = arg('glob', 'y_'), minCells = +arg('min-cells', 0);

const dir = path.resolve(root, arg('dir', 'tools/library')) + '/';
const seen = new Set();
const puzzles = [];
for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.csv')).sort()) {
  for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
    const h = puzzleHash(p);
    if (seen.has(h) || p.rows * p.cols < minCells) continue;
    seen.add(h); puzzles.push(p);
  }
}
puzzles.sort((a, b) => a.rows * a.cols - b.rows * b.cols || (a.score ?? 0) - (b.score ?? 0));
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
