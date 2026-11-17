// Assemble the DIAGONAL books from the pools made by tools/make_diagonal_corpus.sh and register them (group Diagonal, one sub-category per size):
//
//   node tools/build_diagonal_corpus.mjs [--limit 250] [--sizes 8x8,12x12,16x16,20x20,20x36]
//
// For every size, two books: `diagonal-all-<size>` (every arrow diagonal: pools dg_all_*, and the older diag_beginner/medium/hard_*) and
// `diagonal-mixed-<size>` (some arrows diagonal and some orthogonal, in any mix: pools dg_mix*, and the older diag_half/quarter_*). Each takes
// --limit puzzles, thinned evenly by rated score (tools/quota.mjs), so a book runs from easy to hard as far as the pool allows (the small boards
// have few Hard puzzles). Puzzles are named DIAGONAL-ALL-6X6-001 etc.
import fs from 'node:fs';
import { parseCsv, toCsv, puzzleHash } from '../js/logic.js';
import { pickBySize, sizesArg } from './quota.mjs';


const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const limit = +arg('limit', 250);
const sizes = sizesArg(process.argv) || ['8x8', '12x12', '16x16', '20x20', '20x36'];
const dir = root + 'tools/library/';
const KINDS = [
  { kind: 'all', label: (z) => `${z} diagonal`, pools: /^(dg_all_|diag_(beginner|medium|hard)_)/, keep: (cl) => cl.length > 0 && cl.every((c) => c.d >= 4),
    blurb: 'Every arrow points along a diagonal and counts the boxes on its diagonal to the edge. Beginner to Hard.' },
  { kind: 'mixed', label: (z) => `${z} mixed diagonal`, pools: /^(dg_mix|diag_(half|quarter)_)/, keep: (cl) => cl.some((c) => c.d >= 4) && cl.some((c) => c.d < 4),
    blurb: 'Some arrows point along diagonals and some straight up, down, left or right, in every mix. Beginner to Hard.' },
];
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const old = (id) => /^diagonal-(all|mixed|half|quarter|corpus)(-|$)/.test(id);               // every earlier version of these books
for (const b of manifest.books.filter((b) => old(b.id) && b.file)) fs.rmSync(root + b.file, { force: true });
manifest.books = manifest.books.filter((b) => !old(b.id));
const diag = manifest.groups.find((g) => g.name === 'Diagonal');
diag.subs = {};
const pools = {};
for (const k of KINDS) {
  const seen = new Set();
  pools[k.kind] = [];
  for (const f of fs.readdirSync(dir).filter((f) => k.pools.test(f) && f.endsWith('.csv')).sort()) {
    for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
      const h = puzzleHash(p);
      if (seen.has(h) || !k.keep(p.clues)) continue;
      seen.add(h);
      pools[k.kind].push(p);
    }
  }
}
for (const size of sizes) {
  const z = size.replace('x', '×');
  diag.subs[z] = { icon: '↗️' };
  for (const k of KINDS) {
    const puzzles = pickBySize(pools[k.kind], [size], limit);
    const id = `diagonal-${k.kind}-${size}`;
    puzzles.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; });
    fs.writeFileSync(`${root}data/${id}.csv`, toCsv(puzzles));
    manifest.books.push({ id, name: `Diagonal: ${k.label(z)}`, file: `data/${id}.csv`, count: puzzles.length, label: k.label(z), group: 'Diagonal', sub: z, blurb: k.blurb });
    const tiers = {};
    for (const p of puzzles) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
    console.log(`${id}: ${puzzles.length} of ${pools[k.kind].filter((p) => `${Math.min(p.rows, p.cols)}x${Math.max(p.rows, p.cols)}` === size).length} candidates; ${JSON.stringify(tiers)}`);
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
