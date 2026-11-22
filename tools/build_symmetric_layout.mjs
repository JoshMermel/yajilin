// Build the symmetric-layout bonus books (the clue cells come in symmetric orbits; arrows and numbers are free) from the pools of
// tools/make_symmetric_layout.sh (tools/library/lsym_<mode>_<cap>_<size>_s<seed>.csv): one book per size, each mixing the four symmetries
// (rot180, rot90, mirror, transpose). Every tier gets the same number of puzzles and, inside a tier, as even a share to each symmetry as the
// pools allow (a symmetry that runs out hands its share to the others), thinned evenly by score.
//   node tools/build_symmetric_layout.mjs [--limit 250] [--sizes 8x8,12x12] [--modes rot180,rot90,mirror,transpose]
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
import { sizeBlurb, setBonusSub } from './bonus_manifest.mjs';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname, dir = root + 'tools/library/';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const limit = +arg('limit', 250), sizes = arg('sizes', '8x8,12x12').split(','), modes = arg('modes', 'rot180,rot90,mirror,transpose').split(',');
const TIERS = ['Beginner', 'Medium', 'Hard', 'Expert'];
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
setBonusSub(manifest, 'Symmetric layout', '🧩', 'The clue cells sit in matching pairs (or fours): reflect or turn the board and every clue lands on a clue. The arrows point any way and the numbers are free; the boxes are not symmetric.');
for (const size of sizes) {
  const [c, r] = size.split('x').map(Number);
  const groups = modes.map((mode) => {
    const seen = new Set(), pool = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`lsym_${mode}_`) && f.includes(`_${size}_`) && f.endsWith('.csv')).sort()) {
      for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) { const h = symmetryKey(p); if (p.rows === r && p.cols === c && !seen.has(h)) { seen.add(h); pool.push(p); } }
    }
    return { mode, pool };
  });
  const live = TIERS.filter((t) => groups.some((g) => g.pool.some((p) => p.tier === t)));
  const chosen = [], report = [];
  for (const [ti, t] of live.entries()) {
    const perTier = Math.floor(limit / live.length) + (ti < limit % live.length ? 1 : 0);          // (a remainder goes to the first tiers: 250 is 84 + 83 + 83)
    const avail = groups.map((g) => g.pool.filter((p) => p.tier === t).sort((a, b) => (a.score ?? 0) - (b.score ?? 0)));
    const take = avail.map(() => 0);
    for (let left = perTier, progress = true; left > 0 && progress;) {
      progress = false;
      avail.forEach((g, k) => { if (left > 0 && take[k] < g.length) { take[k]++; left--; progress = true; } });
    }
    avail.forEach((g, k) => { for (let j = 0; j < take[k]; j++) chosen.push(g[Math.floor(((j + 0.5) * g.length) / take[k])]); });
    report.push(`${t}: ${groups.map((g, k) => `${g.mode} ${take[k]}/${avail[k].length}`).join(', ')}`);
  }
  chosen.sort(byTierScore);
  const id = `bonus-symmetric-layout-${size}`, nice = size.replace('x', '×');
  chosen.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; });
  fs.writeFileSync(`${root}data/${id}.csv`, toCsv(chosen));
  console.log(`${id}: ${chosen.length} puzzles\n  ${report.join('\n  ')}`);
  const counts = Object.fromEntries(live.map((t) => [t, chosen.filter((p) => p.tier === t).length]));
  const entry = { id, name: `Bonus: symmetric layout ${nice}`, file: `data/${id}.csv`, count: chosen.length, label: `Symmetric layout ${nice}`, group: 'Bonus', sub: 'Symmetric layout', blurb: sizeBlurb(nice, counts) };
  const at = manifest.books.findIndex((b) => b.id === id);
  if (at >= 0) manifest.books[at] = entry;
  else { const last = manifest.books.map((b, i) => (b.sub === 'Exact symmetry' || b.sub === 'Symmetric layout' ? i : -1)).filter((i) => i >= 0).pop(); manifest.books.splice(last === undefined ? manifest.books.length : last + 1, 0, entry); }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
