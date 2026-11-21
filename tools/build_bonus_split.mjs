// Build the split bonus books (the long way round, one direction, all zeros, no zeros; each at 8x8 and 12x12) from the pools that
// tools/make_bonus_split.sh writes (tools/library/bs_<recipe>_<size>_s<seed>.csv), replacing the old one-book-per-theme versions.
//   node tools/build_bonus_split.mjs [--limit 250]
// A book is the same number of puzzles from each of its recipes (the no-zeros books mix four), each recipe's share thinned evenly by
// score so the spread is kept; a recipe with too few puzzles hands its share to the others. Puzzles are deduplicated across turns and mirrors.
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname;
const li = process.argv.indexOf('--limit'), limit = li > 0 ? +process.argv[li + 1] : 250;
const dir = root + 'tools/library/';
const THEMES = [
  { key: 'longway', old: 'bonus-longway', name: 'Bonus: the long way round', label: 'The long way round', recipes: ['longway'], blurb: 'Arrows point away from the nearest edge: long lines of sight.' },
  { key: 'onedir', old: 'bonus-onedir', name: 'Bonus: one direction', label: 'One direction', recipes: ['onedir'], blurb: 'Every arrow in a puzzle points the same way.' },
  { key: 'zeros', old: 'bonus-zeros', name: 'Bonus: all zeros', label: 'All zeros', recipes: ['zeros'], blurb: 'Every arrow says 0: its line holds no boxes, so the boxes hide elsewhere.' },
  { key: 'nozeros', old: 'bonus-bignum', name: 'Bonus: no zeros', label: 'No zeros', recipes: ['nz', 'nzd', 't2', 't2d'], blurb: 'No arrow says 0, and the numbers run large; in some puzzles every arrow says 2 or more.' },
];
const SIZES = ['8x8', '12x12'];
const need = (c) => ({ rows: +c.split('x')[1], cols: +c.split('x')[0] });

const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const th of THEMES) {
  const slot = manifest.books.findIndex((b) => b.id === th.old || b.id.startsWith(`bonus-${th.key}-`));
  const entries = [];
  for (const size of SIZES) {
    const [c, r] = size.split('x').map(Number);
    const seen = new Set(), pools = [];
    for (const recipe of th.recipes) {
      const ps = [];
      for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`bs_${recipe}_${size}_`) && f.endsWith('.csv')).sort()) {
        for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
          if (p.rows !== r || p.cols !== c) continue;
          if (th.key === 'nozeros' && p.clues.some((q) => q.n === 0)) continue;    // (the generator already insists; this is the check)
          const h = symmetryKey(p);
          if (seen.has(h)) continue;
          seen.add(h); ps.push(p);
        }
      }
      ps.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
      pools.push(ps);
    }
    const take = pools.map(() => 0);
    for (let left = limit, progress = true; left > 0 && progress;) {
      progress = false;
      for (let k = 0; k < pools.length && left > 0; k++) if (take[k] < pools[k].length) { take[k]++; left--; progress = true; }
    }
    const chosen = pools.flatMap((ps, k) => Array.from({ length: take[k] }, (_, j) => ps[Math.floor(((j + 0.5) * ps.length) / take[k])]));
    chosen.sort(byTierScore);
    const id = `bonus-${th.key}-${size}`, nice = size.replace('x', '×');
    chosen.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; });
    fs.writeFileSync(`${root}data/${id}.csv`, toCsv(chosen));
    const tiers = {}; for (const p of chosen) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
    console.log(`${id}: ${chosen.length} puzzles (pool ${pools.map((p) => p.length).join('/')}), tiers ${JSON.stringify(tiers)}`);
    entries.push({ id, name: `${th.name} ${nice}`, file: `data/${id}.csv`, count: chosen.length, label: `${th.label} ${nice}`, group: 'Bonus', blurb: th.blurb });
  }
  manifest.books = manifest.books.filter((b) => b.id !== th.old && !b.id.startsWith(`bonus-${th.key}-`));
  manifest.books.splice(slot < 0 ? manifest.books.length : Math.min(slot, manifest.books.length), 0, ...entries);
  if (fs.existsSync(`${root}data/${th.old}.csv`)) fs.unlinkSync(`${root}data/${th.old}.csv`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
