// Build the exact-symmetry bonus books (mirror, diagonal mirror = transposition, quarter turn, half turn) from the pools of tools/make_symmetry_exact.sh
// (tools/library/xsym_<mode>_<cap>_<size>_s<seed>.csv): an even share of each tier the pool has, each tier thinned evenly by score.
//   node tools/build_symmetry_exact.mjs [--limit 60] [--sizes 8x8,12x12] [--modes mirror,transpose,rot90,rot180]         one mixed book per size (the default)
//   node tools/build_symmetry_exact.mjs --separate [--limit 60] ...                                              one book per symmetry and size
// A mixed book gives every tier the same number of puzzles and, inside a tier, as even a share to each symmetry and size as the pools allow
// (a group that runs out hands its share to the others: the 8x8 pools have few Hard puzzles).
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
import { sizeBlurb, setBonusSub } from './bonus_manifest.mjs';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname, dir = root + 'tools/library/';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const separate = process.argv.includes('--separate');
const limit = +arg('limit', 60), sizes = arg('sizes', '8x8,12x12').split(','), modes = arg('modes', 'mirror,transpose,rot90,rot180').split(',');
const TIERS = ['Beginner', 'Medium', 'Hard', 'Expert'];
const KINDS = {
  mirror: { id: 'mirror', label: 'Mirror', sub: 'Mirror', icon: '🪞', blurb: 'The whole puzzle is its own reflection, left to right: every clue has a twin on the other side, pointing the other way, with the same number. A column of clues runs up the middle.' },
  transpose: { id: 'diagonal-mirror', label: 'Diagonal mirror', sub: 'Diagonal mirror', icon: '◩', blurb: 'The whole puzzle is its own reflection across the diagonal: a clue and its twin swap rows and columns, with the same number. The diagonal itself is boxes and voids, and the loop touches it only twice.' },
  rot180: { id: 'half-turn', label: 'Half turn', sub: 'Half turn', icon: '↻', blurb: 'Turn the board half way round and it is the same puzzle: every clue has a twin on the other side, pointing the opposite way, with the same number.' },
  rot90: { id: 'quarter-turn', label: 'Quarter turn', sub: 'Quarter turn', icon: '🔁', blurb: 'Turn the board a quarter and it is the same puzzle: every clue has three twins, each pointing a quarter further round, all with the same number.' },
};
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const loadPool = (mode, size) => {
  const [c, r] = size.split('x').map(Number), seen = new Set(), pool = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`xsym_${mode}_`) && f.includes(`_${size}_`) && f.endsWith('.csv')).sort()) {
    for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
      const h = symmetryKey(p);
      if (p.rows === r && p.cols === c && !seen.has(h)) { seen.add(h); pool.push(p); }
    }
  }
  return pool;
};
if (!separate) {
  setBonusSub(manifest, 'Exact symmetry', '🪞', 'The whole puzzle is its own image: every clue has twins, pointing the matching way and saying the same number. Left to right, across the diagonal, turned a quarter or turned a half.');
  manifest.books = manifest.books.filter((b) => !/^bonus-(mirror|diagonal-mirror|quarter-turn)-/.test(b.id) && b.id !== 'bonus-symmetry-mix');   // (the one-book mix and the separate drafts give way to a mix per size)
  for (const k of ['Mirror', 'Diagonal mirror', 'Quarter turn']) delete manifest.groups.find((x) => x.name === 'Bonus').subs[k];
  for (const f of fs.readdirSync(root + 'data').filter((f) => /^(bonus-(mirror|diagonal-mirror|quarter-turn)-.*|bonus-symmetry-mix)\.csv$/.test(f))) fs.unlinkSync(root + 'data/' + f);
  for (const size of sizes) {
    const groups = modes.map((mode) => ({ mode, pool: loadPool(mode, size) }));
    const live = TIERS.filter((t) => groups.some((g) => g.pool.some((p) => p.tier === t)));
    const perTier = Math.floor(limit / live.length), chosen = [], report = [];
    for (const t of live) {
      const avail = groups.map((g) => g.pool.filter((p) => p.tier === t).sort((a, b) => (a.score ?? 0) - (b.score ?? 0)));
      const take = avail.map(() => 0);
      for (let left = perTier, progress = true; left > 0 && progress;) {       // one at a time, round-robin over the symmetries that still have puzzles of this tier
        progress = false;
        avail.forEach((g, k) => { if (left > 0 && take[k] < g.length) { take[k]++; left--; progress = true; } });
      }
      avail.forEach((g, k) => { for (let j = 0; j < take[k]; j++) chosen.push(g[Math.floor(((j + 0.5) * g.length) / take[k])]); });
      report.push(`${t} ${chosen.filter((p) => p.tier === t).length}/${perTier} (${groups.map((g, k) => `${g.mode} ${take[k]}/${avail[k].length}`).join(', ')})`);
    }
    chosen.sort(byTierScore);
    const id = `bonus-symmetry-mix-${size}`, nice = size.replace('x', '×');
    chosen.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; });
    fs.writeFileSync(`${root}data/${id}.csv`, toCsv(chosen));
    console.log(`${id}: ${chosen.length} puzzles\n  ${report.join('\n  ')}`);
    const counts = Object.fromEntries(live.map((t) => [t, chosen.filter((p) => p.tier === t).length]));
    const entry = { id, name: `Bonus: symmetry mix ${nice}`, file: `data/${id}.csv`, count: chosen.length, label: `Symmetry mix ${nice}`, group: 'Bonus', sub: 'Exact symmetry', blurb: `Mirror, diagonal-mirror, quarter-turn and half-turn puzzles mixed. ${sizeBlurb(nice, counts)}` };
    const at = manifest.books.findIndex((b) => b.id === id);
    if (at >= 0) manifest.books[at] = entry;
    else { const last = manifest.books.map((b, i) => (b.sub === 'Symmetric' || b.sub === 'Exact symmetry' ? i : -1)).filter((i) => i >= 0).pop(); manifest.books.splice(last === undefined ? manifest.books.length : last + 1, 0, entry); }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.exit(0);
}
for (const mode of modes) {
  const kind = KINDS[mode];
  for (const size of sizes) {
    const [c, r] = size.split('x').map(Number), seen = new Set(), pool = [];
    for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`xsym_${mode}_`) && f.includes(`_${size}_`) && f.endsWith('.csv')).sort()) {
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
    const id = `bonus-${kind.id}-${size}`, nice = size.replace('x', '×');
    chosen.forEach((p, i) => { p.name = `${id.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; });
    fs.writeFileSync(`${root}data/${id}.csv`, toCsv(chosen));
    console.log(`${id}: ${chosen.length} puzzles from a pool of ${pool.length}; ${live.map((t) => `${t} ${take.get(t)}/${byTier.get(t).length}`).join(', ')}`);
    const entry = { id, name: `Bonus: ${kind.label.toLowerCase()} ${nice}`, file: `data/${id}.csv`, count: chosen.length, label: `${kind.label} ${nice}`, group: 'Bonus', sub: kind.sub, blurb: sizeBlurb(nice, Object.fromEntries(live.map((t) => [t, take.get(t)]))) };
    setBonusSub(manifest, kind.sub, kind.icon, kind.blurb);
    const at = manifest.books.findIndex((b) => b.id === id);
    if (at >= 0) manifest.books[at] = entry;
    else {
      const lastSym = manifest.books.map((b, i) => (b.sub === 'Symmetric' || b.id.startsWith('bonus-mirror-') || b.id.startsWith('bonus-diagonal-mirror-') || b.id.startsWith('bonus-quarter-turn-') ? i : -1)).filter((i) => i >= 0).pop();
      manifest.books.splice(lastSym === undefined ? manifest.books.length : lastSym + 1, 0, entry);
    }
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
