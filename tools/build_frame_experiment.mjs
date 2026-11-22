// The experimental Frame book (data/frame-experiment.csv): the pools tools/library/frame_*.csv, named by recipe and size so the parameters can be compared.
// Inspired by stefliew's 20x20 Yajilin on Logic Masters (logic-masters.de, puzzle 0006NR): arrows only round the border, pointing in, most of the rest void.
// His puzzle puts an arrow on every third row and column and every arrow says 6; the break-in is a whole-board count that only works because that exact layout
// was tuned.  This book deliberately does not copy it.  THE LAYOUT RULE (checked below, the build fails on a puzzle that breaks it):
//   - never arrows on every third line (spacing 3);
//   - never arrows on evenly spaced lines (3 or more of them) that all say the same number, or nearly the same: with uniform spacing the numbers must clearly vary
//     (at least 3 different values, spread of 2 or more);
//   - otherwise free: an irregular set of arrow lines may say any numbers.  The row lines and the column lines need not be the same set (they mostly are not).
// Recipes (the pool file name says which: frame_<irr|s2|s4>_<pattern>_<size>_<tag>.csv, frame_uni<n>_...):
//   IRR-<p>  an irregular set of arrow lines (e.g. inside rows 2, 3, 7, 9, 13 and columns 1, 4, 5, 10, 12, 14), one number per line, the pattern p says how the numbers go
//            (MIX: no order, RISE, FALL, BELL, ZIG: up and down).  OR-tools, counterexample-guided (tools/cpsat_frame2.py --row-lines --col-lines --rows --cols, stored by
//            tools/frame_json_to_pool.mjs).  (js/generator_layouts.js can also build irregular lines, node tools/generate.mjs --layout frame --lines rows/cols, each arrow saying its
//            real count, but those come out as 0s and 1s, so none is in the book.)
//   S2-<p>   arrows on every second line (inside lines 2, 4, 6 ...), S4-<p> every fourth (2, 6, 10 ...), with clearly varied numbers (--spacing 2|4 --rows --cols)
//   U<n>     frame whose arrows all say n (a border cell is an arrow only where the count is n; the rest is void), so the arrow lines come out irregular     (--uniform n)
// Every puzzle is unique (the generators check it).  node tools/build_frame_experiment.mjs
import fs from 'node:fs';
import { parseCsv, toCsv, symmetryKey } from '../js/logic.js';
const root = new URL('..', import.meta.url).pathname, dir = root + 'tools/library/';
const recipeOf = (f) => {
  let m;
  if ((m = /^frame_(irr|s2|s4)_([a-z]+)_/.exec(f))) return `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
  if ((m = /^frame_uni(\d+)_/.exec(f))) return `U${m[1]}`;
  throw new Error(`no recipe for pool ${f}`);
};
// the arrow lines of a puzzle: inside row / column index -> the numbers its arrows say
function arrowLines(p) {
  const R = {}, C = {};
  for (const c of p.clues) {
    if (c.n < 0) continue;
    if (c.r === 0 || c.r === p.rows - 1) (C[c.c] ||= []).push(c.n); else (R[c.r] ||= []).push(c.n);
  }
  return { R, C };
}
const evenGap = (ks) => { if (ks.length < 3) return 0; const g = ks[1] - ks[0]; return ks.every((k, i) => !i || k - ks[i - 1] === g) ? g : 0; };
function layoutProblem(p) {
  const { R, C } = arrowLines(p), nums = [...Object.values(R), ...Object.values(C)].flat();
  const spread = Math.max(...nums) - Math.min(...nums), distinct = new Set(nums).size;
  for (const [axis, L] of [['rows', R], ['columns', C]]) {
    const gap = evenGap(Object.keys(L).map(Number).sort((a, b) => a - b));
    if (gap === 3) return `arrows on every third ${axis.slice(0, -1)}`;
    if (gap && (spread < 2 || distinct < 3)) return `evenly spaced ${axis} (${gap}) with nearly uniform numbers`;
  }
  return null;
}
const seen = new Set(), out = [];
for (const f of fs.readdirSync(dir).filter((f) => f.startsWith('frame_') && f.endsWith('.csv')).sort()) {
  for (const p of parseCsv(fs.readFileSync(dir + f, 'utf8'))) {
    const h = symmetryKey(p); if (seen.has(h)) continue; seen.add(h);
    const bad = layoutProblem(p); if (bad) throw new Error(`${f}: ${p.name} breaks the layout rule (${bad}); delete the pool`);
    p.recipe = recipeOf(f); out.push(p);
  }
}
const group = ['U1', 'U2', 'IRR', 'S2', 'S4'], pat = ['MIX', 'RISE', 'FALL', 'BELL', 'ZIG'];
const rank = (r) => { const [g, q] = r.split('-'); return group.indexOf(g) * 10 + (q ? pat.indexOf(q) : 0); };
out.sort((a, b) => Math.max(a.rows, a.cols) - Math.max(b.rows, b.cols) || rank(a.recipe) - rank(b.recipe) || (a.score ?? 0) - (b.score ?? 0));
const count = {};
for (const p of out) { const k = `${p.recipe}-${p.cols}x${p.rows}`; count[k] = (count[k] || 0) + 1; p.name = `FRAME-${k}-${count[k]}`; p.lines = arrowLines(p); delete p.recipe; }
fs.writeFileSync(root + 'data/frame-experiment.csv', toCsv(out));
const manifestPath = root + 'data/manifest.json', m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const entry = { id: 'frame-experiment', name: 'Experiment: frame', file: 'data/frame-experiment.csv', count: out.length, label: 'Frame (experiment)', group: 'Bonus', keepOrder: true, unaudited: true,
  blurb: 'All arrows are on the border, pointing in. Inspired by stefliew\'s 20x20 Yajilin on Logic Masters (logic-masters.de, puzzle 0006NR).' };
const at = m.books.findIndex((b) => b.id === entry.id);
if (at >= 0) m.books[at] = entry; else { const last = m.books.map((b, i) => (b.group === 'Bonus' ? i : -1)).filter((i) => i >= 0).pop(); m.books.splice(last + 1, 0, entry); }
fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
const tiers = {}; for (const p of out) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
const fmt = (L) => Object.entries(L).map(([k, v]) => `${k}:${[...new Set(v)].join('/')}`).join(' ');
console.log(`${out.length} puzzles in data/frame-experiment.csv`, JSON.stringify(tiers), '\n' + out.map((p) => `${p.name} ${p.tier} | rows ${fmt(p.lines.R)} | cols ${fmt(p.lines.C)}`).join('\n'));
