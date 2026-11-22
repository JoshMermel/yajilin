// Split a book that mixes board sizes into one book per size, keeping its puzzles (and their order), and put the new books where the old one was:
//   node tools/split_book_by_size.mjs bonus-skyscraper "SKYSCRAPER"
// Sizes are written short side first (4x36); a puzzle is renamed <PREFIX>-<4X36>-<number>. The old book and its CSV are removed. Used once, on 2026-11-22,
// to split the Skyscraper book (then called Skinny) (since then tools/build_skyscraper.mjs builds the books, per size, from the pools of tools/make_skyscraper.sh).
import fs from 'node:fs';
import { parseCsv, toCsv } from '../js/logic.js';
import { sizeBlurb } from './bonus_manifest.mjs';
const root = new URL('..', import.meta.url).pathname;
const [id, prefix] = [process.argv[2], process.argv[3] || process.argv[2].toUpperCase()];
const manifestPath = root + 'data/manifest.json', manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const at = manifest.books.findIndex((b) => b.id === id);
if (at < 0) throw new Error(`no book ${id}`);
const old = manifest.books[at], ps = parseCsv(fs.readFileSync(root + old.file, 'utf8'));
const sizes = [...new Set(ps.map((p) => `${Math.min(p.rows, p.cols)}x${Math.max(p.rows, p.cols)}`))].sort((a, b) => parseInt(a) - parseInt(b));
const books = sizes.map((size) => {
  const mine = ps.filter((p) => `${Math.min(p.rows, p.cols)}x${Math.max(p.rows, p.cols)}` === size), nice = size.replace('x', '×');
  const bid = `${id}-${size}`;
  mine.forEach((p, i) => { p.name = `${prefix}-${size.toUpperCase()}-${String(i + 1).padStart(2, '0')}`; });
  fs.writeFileSync(`${root}data/${bid}.csv`, toCsv(mine));
  const tiers = {}; for (const p of mine) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
  console.log(`${bid}: ${mine.length} puzzles ${JSON.stringify(tiers)}`);
  return { ...old, id: bid, name: `${old.name} ${nice}`, label: `${old.label} ${nice}`, file: `data/${bid}.csv`, count: mine.length, blurb: sizeBlurb(nice, tiers) };
});
manifest.books.splice(at, 1, ...books);
fs.unlinkSync(root + old.file);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
