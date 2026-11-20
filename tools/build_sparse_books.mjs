// Build the SPARSE books from the pools in tools/library/ (made by tools/make_sparse_tier_books.sh and the earlier sparse experiments):
// one book for each board size and direction set (orthogonal, diagonal, both), each running from Beginner through Medium to Hard, with as
// few arrows as could be found at each tier. Replaces the books of every earlier sparse experiment (manifest group "Sparse").
//
//   node tools/build_sparse_books.mjs [--sizes 8x8,12x12] [--per-tier 10] [--dry]      (--dry: only report what would be built)      (default per tier: 10 at 8x8, 8 at 12x12, 6 at larger sizes)
//
// Per (size, directions, tier) the sparsest puzzles are taken (fewest arrows, then lowest score), each puzzle once however it is turned,
// mirrored or transposed (symmetryKey). A book is sorted by tier and then score like every book, and a tier with fewer puzzles than wanted
// gives what there is (the report says so). Directions are those the puzzle's arrows use, whichever search found it.
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname, dir = root + 'tools/library/';
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const dry = process.argv.includes('--dry');
const sizes = arg('sizes', '8x8,12x12').split(',');
const perTier = (size) => +arg('per-tier', { '8x8': 10, '12x12': 8 }[size] || 6);
const KINDS = [
  { key: 'orthogonal', code: 'ORTHOGONAL', label: 'orthogonal', blurb: 'Arrows point along rows and columns only' },
  { key: 'diagonal', code: 'DIAGONAL', label: 'diagonal', blurb: 'Every arrow is diagonal' },
  { key: 'both', code: 'BOTH', label: 'both', blurb: 'Arrows point along rows, columns and diagonals' },
];
const kindOf = (p) => (p.clues.every((c) => c.n < 0 || c.d < 4) ? 'orthogonal' : p.clues.every((c) => c.n < 0 || c.d >= 4) ? 'diagonal' : 'both');
const TIERS = ['Beginner', 'Medium', 'Hard'];

const pool = new Map();                                              // size -> symmetry key -> puzzle
for (const f of fs.readdirSync(dir).filter((f) => /^sp(t|q|d|m)?_.*\.csv$/.test(f)).sort()) {
  for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
    if (!p.tier || !TIERS.includes(p.tier)) continue;
    const size = `${Math.min(p.rows, p.cols)}x${Math.max(p.rows, p.cols)}`;      // (a 36x20 board is the 20x36 book's)
    if (!sizes.includes(size)) continue;
    const m = pool.get(size) || pool.set(size, new Map()).get(size);
    const k = symmetryKey(p), was = m.get(k);
    if (!was || p.clues.length < was.clues.length) m.set(k, p);
  }
}

const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const old = (b) => b.group === 'Sparse';                              // every sparse book of an earlier experiment goes
if (!dry) for (const b of manifest.books.filter(old)) if (b.file) fs.rmSync(root + b.file, { force: true });
manifest.books = manifest.books.filter((b) => !old(b));
const group = manifest.groups.find((g) => g.name === 'Sparse');
group.subs = {};
group.blurb = 'As few arrows as a search could find, each book running from Beginner to Hard: about one cell in ten or fewer, against one in six in the main books. An experiment.';
for (const size of sizes) {
  const z = size.replace('x', '×');
  group.subs[z] = { icon: '🔹' };
  for (const kind of KINDS) {
    const picked = [];
    const report = [];
    for (const tier of TIERS) {
      const have = [...pool.get(size)?.values() || []].filter((p) => kindOf(p) === kind.key && p.tier === tier)
        .sort((a, b) => a.clues.length - b.clues.length || (a.score ?? 0) - (b.score ?? 0));
      const take = have.slice(0, perTier(size));
      picked.push(...take);
      report.push(`${tier} ${take.length}/${perTier(size)}${take.length ? ` (${take[0].clues.length}-${take[take.length - 1].clues.length} arrows)` : ''}`);
    }
    picked.sort(byTierScore);
    const id = `sparse-${size}-${kind.key}`;
    picked.forEach((p, i) => { p.name = `SPARSE-${size.toUpperCase()}-${kind.code}-${String(i + 1).padStart(2, '0')}`; });
    if (!dry) fs.writeFileSync(`${root}data/${id}.csv`, toCsv(picked));
    const arrows = picked.map((p) => p.clues.length), cells = picked[0] ? picked[0].rows * picked[0].cols : 1;
    manifest.books.push({
      id, name: `Sparse ${z}, ${kind.label}`, file: `data/${id}.csv`, count: picked.length, label: `${z} ${kind.label}`, group: 'Sparse', sub: z,
      blurb: `${kind.blurb}, and there are few of them: ${Math.min(...arrows)} to ${Math.max(...arrows)} on a ${z} board (one cell in ${(cells / (arrows.reduce((a, b) => a + b, 0) / arrows.length)).toFixed(0)} on average). Beginner to Hard.`,
    });
    console.log(`${id.padEnd(26)} ${String(picked.length).padStart(3)} puzzles: ${report.join(', ')}`);
  }
}
if (!dry) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
