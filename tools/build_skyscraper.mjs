// Build the Skyscraper books (tall, narrow boards: 4x36, 6x36, 8x36; one book per width) from the pools of tools/make_skyscraper.sh
// (tools/library/sky_<cap>_<size>_s<seed>.csv) and the puzzles already in the books: every tier gets an even share of --limit (84 + 83 + 83 of 250),
// a tier that runs short hands its share to the others, and each tier is thinned evenly by score.
//   node tools/build_skyscraper.mjs [--limit 250] [--sizes 4x36,6x36,8x36]
// (The page shows a tall board sideways when that fits the window better.) The books were called Skinny until 2026-11-22.
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
import { sizeBlurb, setBonusSub } from './bonus_manifest.mjs';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname, dir = root + 'tools/library/';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const limit = +arg('limit', 250), sizes = arg('sizes', '4x36,6x36,8x36').split(',');
const TIERS = ['Beginner', 'Medium', 'Hard', 'Expert'];
const manifestPath = root + 'data/manifest.json', manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
setBonusSub(manifest, 'Skyscraper', '🏙️', 'Tall, narrow boards, up to 36 cells high. One book per width.');
for (const size of sizes) {
  const [a, b] = size.split('x').map(Number), id = `bonus-skyscraper-${size}`, nice = size.replace('x', '×');
  const seen = new Set(), pool = [];
  const add = (p) => { const h = symmetryKey(p); if (!seen.has(h) && Math.min(p.rows, p.cols) === a && Math.max(p.rows, p.cols) === b) { seen.add(h); pool.push(p); } };
  if (fs.existsSync(`${root}data/${id}.csv`)) for (const p of parseCsv(fs.readFileSync(`${root}data/${id}.csv`, 'utf8'))) add(p);      // (the puzzles already in the book)
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith('sky_') && f.includes(`_${size}_`) && f.endsWith('.csv')).sort()) for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) add(p);
  const live = TIERS.filter((t) => pool.some((p) => p.tier === t)), chosen = [];
  const byTier = new Map(live.map((t) => [t, pool.filter((p) => p.tier === t).sort((x, y) => (x.score ?? 0) - (y.score ?? 0))]));
  const take = new Map(live.map((t) => [t, 0]));
  for (let left = limit, progress = true; left > 0 && progress;) {       // round-robin, so a short tier hands its share to the others
    progress = false;
    for (const t of live) if (left > 0 && take.get(t) < byTier.get(t).length) { take.set(t, take.get(t) + 1); left--; progress = true; }
  }
  for (const t of live) { const g = byTier.get(t), k = take.get(t); for (let j = 0; j < k; j++) chosen.push(g[Math.floor(((j + 0.5) * g.length) / k)]); }
  chosen.sort(byTierScore);
  chosen.forEach((p, i) => { p.name = `SKYSCRAPER-${size.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; });
  fs.writeFileSync(`${root}data/${id}.csv`, toCsv(chosen));
  const counts = Object.fromEntries(live.map((t) => [t, take.get(t)]));
  console.log(`${id}: ${chosen.length} puzzles from a pool of ${pool.length}; ${live.map((t) => `${t} ${take.get(t)}/${byTier.get(t).length}`).join(', ')}`);
  const at = manifest.books.findIndex((x) => x.id === id);
  const entry = { ...(at >= 0 ? manifest.books[at] : { group: 'Bonus', sub: 'Skyscraper' }), id, name: `Bonus: skyscraper ${nice}`, label: `Skyscraper ${nice}`, file: `data/${id}.csv`, count: chosen.length, blurb: sizeBlurb(nice, counts) };
  if (at >= 0) manifest.books[at] = entry; else manifest.books.push(entry);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
