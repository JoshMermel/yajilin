// Assemble hex books from the pools in tools/library/hex/ into data/hex-<size>.csv and register them in data/manifest.json (group "Hex").
//
//   node tools/build_hex_books.mjs 5x5 6x6 7x7 8x8
//
// Puzzles are deduplicated, sorted easiest first (by the number of lookahead deductions, then by how few cells propagation leaves open), and
// given a tier by rank: the easiest 35% Beginner, the next 45% Medium, the rest Hard. (The tiers are relative to the book, not calibrated.)
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';

const root = new URL('..', import.meta.url).pathname;
const dir = `${root}tools/library/hex/`;
const sizes = process.argv.slice(2);
if (!sizes.length) { console.error('usage: node tools/build_hex_books.mjs 5x5 6x6 ...'); process.exit(1); }

const manifestPath = `${root}data/manifest.json`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.groups.some((g) => g.name === 'Hex')) {
  const at = manifest.groups.findIndex((g) => g.name === 'Bonus');
  const group = { name: 'Hex', icon: '⬡', blurb: 'Hexagonal boards: every cell has six neighbours, and an arrow points along any of six directions. Same rules. An experiment.' };
  manifest.groups.splice(at >= 0 ? at : manifest.groups.length, 0, group);
}

for (const size of sizes) {
  const seen = new Set(), puzzles = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`hex-${size}-`) && f.endsWith('.csv')).sort()) {
    for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
      const key = symmetryKey(p);
      if (seen.has(key)) continue;
      seen.add(key); puzzles.push(p);
    }
  }
  if (!puzzles.length) { console.log(`${size}: no pool puzzles, skipped`); continue; }
  puzzles.sort((a, b) => (a.score - b.score) || (a.clues.length - b.clues.length));
  const id = `hex-${size}`, n = puzzles.length;
  puzzles.forEach((p, i) => {
    p.name = `${id.toUpperCase()}-${String(i + 1).padStart(Math.max(2, String(n).length), '0')}`;
    p.tier = i < 0.35 * n ? 'Beginner' : i < 0.8 * n ? 'Medium' : 'Hard';
  });
  fs.writeFileSync(`${root}data/${id}.csv`, toCsv(puzzles));
  const label = size.replace('x', '×');
  const entry = {
    id, name: `Hex: ${label}`, file: `data/${id}.csv`, count: n, label, group: 'Hex',
    blurb: `${label} hex boards, ${n} puzzles from easy to hard. An experiment.`,
  };
  const at = manifest.books.findIndex((b) => b.id === id);
  if (at >= 0) manifest.books[at] = entry; else manifest.books.push(entry);
  console.log(`${size}: ${n} puzzles in data/${id}.csv (steps ${puzzles[0].score}..${puzzles[n - 1].score})`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
