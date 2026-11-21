// Assemble the regional test corpus from the pools made by tools/make_regional_corpus.sh into data/regional-corpus.csv and register it.
//
//   node tools/build_regional_corpus.mjs
//
// Puzzles are named <recipe>-<size>-<n> (so a player can say "stuck-8x8-2 needs ..."), ordered by recipe, then size, then score.
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey, mergeBlankRegions, compile } from '../js/logic.js';
import { rate } from '../js/rating.js';
import { byTierScore } from './quota.mjs';

const root = new URL('..', import.meta.url).pathname;
const RECIPES = ['gentle', 'beginner', 'medium', 'hard', 'big', 'rows', 'cols', 'classical', 'stuck'];
const dir = root + 'tools/library/';
const seen = new Set(), out = [], merges = { n: 0, kept: [] };
for (const rec of RECIPES) {
  const bySize = new Map();
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`regc_${rec}_`) && f.endsWith('.csv')).sort()) {
    for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
      const numbered = new Set(p.clues.map((c) => p.regions[c.r * p.cols + c.c]));
      const m = mergeBlankRegions(p.rows, p.cols, p.regions, (g) => numbered.has(g));          // neighbouring regions without a number become one
      // every puzzle is re-rated here (the pools may predate the current rules); a merge is kept only if the rules rate the puzzle as before
      const fresh = (regions) => compile({ ...p, clues: p.clues.map((c) => ({ ...c })), regions });      // (compile writes into the clues: each compile gets its own copies)
      const was = rate(fresh(p.regions));
      let Q = fresh(p.regions), now = was;
      if (m.merged) {
        const M = fresh(m.regions), r = rate(M);
        if (r.solved === was.solved && r.tier === was.tier) { Q = M; now = r; merges.n++; }
        else merges.kept.push(`${rec}: ${was.tier}/${was.solved} -> ${r.tier}/${r.solved}`);       // the border mattered to the rules: leave it
      }
      Q.solution = p.solution; Q.rules = now.rules; Q.tier = now.tier; Q.score = now.score;
      const q = Q;
      const h = symmetryKey(q);   // a turned or mirrored copy counts as the same puzzle
      if (seen.has(h)) continue;
      seen.add(h);
      const size = `${p.cols}x${p.rows}`;
      if (!bySize.has(size)) bySize.set(size, []);
      bySize.get(size).push(q);
    }
  }
  const sizes = [...bySize.keys()].sort((a, b) => a.split('x')[0] * a.split('x')[1] - b.split('x')[0] * b.split('x')[1]);
  for (const size of sizes) {
    bySize.get(size).sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).forEach((p, i) => { p.name = `${rec}-${size}-${i + 1}`; out.push(p); });
  }
}
out.sort(byTierScore);                                                  // like every book: easiest tier first, then by score
fs.writeFileSync(root + 'data/regional-corpus.csv', toCsv(out));
console.log(`${merges.n} puzzles had blank neighbouring regions merged; ${merges.kept.length} left as they were because the rules rated them differently${merges.kept.length ? ': ' + merges.kept.join(', ') : ''}`);
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.books = manifest.books.filter((b) => b.id !== 'experiment-regional');          // the first sample book is replaced by this one
const entry = {
  id: 'regional-corpus', name: 'Experiment: regional corpus', file: 'data/regional-corpus.csv', count: out.length, label: 'Regional corpus (experiment)', group: 'Bonus',
  blurb: 'No arrows: thick lines cut the board into regions and a number says how many boxes its region holds. A spread of styles for finding the techniques.',
};
const at = manifest.books.findIndex((b) => b.id === entry.id);
if (at >= 0) manifest.books[at] = entry; else manifest.books.push(entry);
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${out.length} puzzles in data/regional-corpus.csv`);
const tally = {};
for (const p of out) { const rec = p.name.split('-')[0]; (tally[rec] = tally[rec] || []).push(`${p.cols}x${p.rows} ${p.tier || '?'}${p.rules ? `/${p.rules}` : ''}`); }
for (const [rec, list] of Object.entries(tally)) console.log(`  ${rec}: ${list.join(', ')}`);
