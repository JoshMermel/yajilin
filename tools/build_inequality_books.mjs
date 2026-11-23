// The Inequality books (arrows whose number may say "at least", "at most" or "not" n boxes) from the pools of tools/make_inequality_pools.sh,
// and the Inequality group of the book picker.
//
//   node tools/build_inequality_books.mjs 8x8 10x10 12x12
//
// Every puzzle is re-rated; turned or mirrored copies are dropped; a book runs easiest first.
import fs from 'node:fs';
import { parseCsv, toCsv, compile, symmetryKey } from '../js/logic.js';
import { rate } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname, dir = `${root}tools/library/ineq/`;
const sizes = process.argv.slice(2);
if (!sizes.length) { console.error('usage: node tools/build_inequality_books.mjs 8x8 12x12 ...'); process.exit(1); }
const manifestPath = `${root}data/manifest.json`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.groups.some((g) => g.name === 'Inequality')) {
  const at = manifest.groups.findIndex((g) => g.name === 'Bonus');
  manifest.groups.splice(at >= 0 ? at : manifest.groups.length, 0, {
    name: 'Inequality', icon: '≥',
    blurb: 'Some numbers carry a sign: ≥2 means at least two boxes in that direction, ≤2 at most two, ≠2 anything but two. Same loop, same boxes. An experiment.',
  });
}
for (const size of sizes) {
  const seen = new Set(), puzzles = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`ineq_${size}_`) && f.endsWith('.csv')).sort()) {
    for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
      const key = symmetryKey(p);
      if (seen.has(key)) continue;
      const r = rate(compile({ ...p, clues: p.clues.map((c) => ({ ...c })) }));
      if (!r.solved || r.steps.some((s) => s.rule === 'tryCell' || s.rule === 'tryEdge')) continue;      // no trial and error
      seen.add(key); p.tier = r.tier; p.score = r.score; puzzles.push(p);
    }
  }
  if (!puzzles.length) { console.log(`${size}: no pool puzzles, skipped`); continue; }
  puzzles.sort((a, b) => (a.score - b.score) || (a.clues.length - b.clues.length));
  const id = `ineq-${size}`, n = puzzles.length, tiers = {};
  for (const p of puzzles) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
  puzzles.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(Math.max(2, String(n).length), '0')}`; });
  fs.writeFileSync(`${root}data/${id}.csv`, toCsv(puzzles));
  const label = size.replace('x', '×');
  const entry = { id, name: `Inequality: ${label}`, file: `data/${id}.csv`, count: n, label, group: 'Inequality', blurb: `${label} boards with ≥, ≤ and ≠ numbers, ${n} puzzles from easy to hard. An experiment.` };
  const at = manifest.books.findIndex((b) => b.id === id);
  if (at >= 0) manifest.books[at] = entry; else manifest.books.push(entry);
  console.log(`${size}: ${n} puzzles in data/${id}.csv (${Object.entries(tiers).map(([t, k]) => `${k} ${t}`).join(', ')})`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
