// Build the symmetric bonus books (arrows and boxes the same after a half turn of the board) from the pools of tools/make_symmetric.sh
// (tools/library/sym_<cap>_<size>_s<seed>.csv): an even share of each tier the pool has, each tier thinned evenly by score.
//   node tools/build_symmetric.mjs [--limit 60] [--sizes 8x8,12x12]
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname, dir = root + 'tools/library/';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const limit = +arg('limit', 60), sizes = arg('sizes', '8x8,12x12').split(',');
const TIERS = ['Beginner', 'Medium', 'Hard', 'Expert'];
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const size of sizes) {
  const [c, r] = size.split('x').map(Number), seen = new Set(), pool = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`sym_`) && f.includes(`_${size}_`) && f.endsWith('.csv')).sort()) {
    for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
      const h = symmetryKey(p);
      if (p.rows === r && p.cols === c && !seen.has(h)) { seen.add(h); pool.push(p); }
    }
  }
  const byTier = new Map(TIERS.map((t) => [t, pool.filter((p) => p.tier === t).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))]));
  const live = TIERS.filter((t) => byTier.get(t).length);
  const take = new Map(live.map((t) => [t, 0]));
  for (let left = limit, progress = true; left > 0 && progress;) {            // one at a time, round-robin over the tiers that still have puzzles
    progress = false;
    for (const t of live) if (left > 0 && take.get(t) < byTier.get(t).length) { take.set(t, take.get(t) + 1); left--; progress = true; }
  }
  const chosen = live.flatMap((t) => { const g = byTier.get(t), k = take.get(t); return Array.from({ length: k }, (_, j) => g[Math.floor(((j + 0.5) * g.length) / k)]); }).sort(byTierScore);
  const id = `bonus-symmetric-${size}`, nice = size.replace('x', '×');
  chosen.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; });
  fs.writeFileSync(`${root}data/${id}.csv`, toCsv(chosen));
  console.log(`${id}: ${chosen.length} puzzles from a pool of ${pool.length}; ${live.map((t) => `${t} ${take.get(t)}/${byTier.get(t).length}`).join(', ')}`);
  const entry = { id, name: `Bonus: symmetric ${nice}`, file: `data/${id}.csv`, count: chosen.length, label: `Symmetric ${nice}`, group: 'Bonus', blurb: 'The arrows and boxes sit in matching pairs: turn the board half a way round and the layout is the same, with every arrow pointing the opposite way.' };
  const at = manifest.books.findIndex((b) => b.id === id);
  if (at >= 0) manifest.books[at] = entry;
  else {
    const lastNo = manifest.books.map((b, i) => (b.id.startsWith('bonus-nozeros-') ? i : -1)).filter((i) => i >= 0).pop();
    manifest.books.splice(lastNo === undefined ? manifest.books.length : lastNo + 1 + manifest.books.filter((b) => b.id.startsWith('bonus-symmetric-')).length, 0, entry);   // (after the books of this kind already in)
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
