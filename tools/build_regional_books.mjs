// The Regional books (layout-first puzzles: experiments/regional/LAYOUTS.md) from the pools made by tools/make_regional_layout_pools.sh,
// and the Regional group of the book picker: one sub-category per kind of layout.
//
//   node tools/build_regional_books.mjs [--kinds pentominoes,dominoes,rooms,symmetric] [--limit 100]
//
// Every puzzle is re-rated (the pools may predate the current rules); a puzzle whose hardest step is trial and error is left out, as is a
// turned or mirrored copy of one already in. Books run easiest first, named REGIONAL-<KIND>-<SIZE>-NNN (REGIONAL-<KIND>-NNN for a kind
// marked `merge`, whose sizes make one book: Pentominoes, 12x5 and 10x6).
import fs from 'node:fs';
import { parseCsv, toCsv, compile, symmetryKey } from '../js/logic.js';
import { rate } from '../js/rating.js';
import { byTierScore } from './quota.mjs';
import { sizeBlurb } from './bonus_manifest.mjs';

const root = new URL('..', import.meta.url).pathname, dir = root + 'tools/library/';
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const limit = +arg('limit', 100);

export const KINDS = {
  pentominoes: { sub: 'Pentominoes', icon: '🧩', sizes: ['12x5', '10x6'], merge: true, blurb: 'The board is cut into the twelve pentominoes, one of each.' },
  dominoes: { sub: 'Dominoes', icon: '🎲', sizes: ['8x8', '10x10'], blurb: 'Every region is a domino, so every number is 0 or 1.' },
  rooms: { sub: 'Rooms', icon: '🏠', sizes: ['8x8', '10x10'], blurb: 'Every region is a rectangle.' },
  symmetric: { sub: 'Symmetric', icon: '🔄', sizes: ['8x8', '10x10'], blurb: 'Turn the board half a way round and every region lands on another one.' },
  tetrominoes: { sub: 'Tetrominoes', icon: '🧱', sizes: ['8x8', '10x10'], blurb: 'Every region is four cells.' },
  jigsaw: { sub: 'Jigsaw', icon: '🗺️', sizes: ['8x8', '10x10'], blurb: 'Irregular pieces of three to six cells, like a jigsaw: never a rectangle or a straight bar.' },
};
const GROUP = { name: 'Regional', icon: '🗺️', blurb: 'No arrows: thick lines cut the board into regions, and a number says how many boxes its region holds.' };

const kinds = arg('kinds', 'pentominoes,dominoes,rooms,symmetric').split(',');
const manifestPath = root + 'data/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// the group, after Sparse (before Bonus), with its sub-categories in the order of KINDS
let g = manifest.groups.find((x) => x.name === GROUP.name);
if (!g) { g = { ...GROUP }; const at = manifest.groups.findIndex((x) => x.name === 'Bonus'); manifest.groups.splice(at < 0 ? manifest.groups.length : at, 0, g); }
const subs = {};
for (const [k, K] of Object.entries(KINDS)) if (kinds.includes(k) || g.subs?.[K.sub]) subs[K.sub] = { icon: K.icon, blurb: K.blurb };
Object.assign(g, GROUP, { subs });

// the old regional corpus (in Bonus, then briefly Regional / Mixed) was dropped on 2026-11-22
manifest.books = manifest.books.filter((b) => b.id !== 'regional-corpus');
const bonus = manifest.groups.find((x) => x.name === 'Bonus');
if (bonus?.subs) delete bonus.subs.Regional;

const entries = [], retired = new Set();          // retired: per-size books of a kind that is now one book
const name = (P, id, i) => { P.name = `${id.toUpperCase()}-${String(i + 1).padStart(3, '0')}`; };
for (const kind of kinds) {
  const K = KINDS[kind];
  const books = [];                                // [{ size, chosen, line }]
  for (const size of K.sizes) {
    const file = `${dir}regl_${kind}_${size}.csv`;
    if (!fs.existsSync(file)) { console.log(`${kind} ${size}: no pool yet`); continue; }
    const seen = new Set(), keep = []; let trial = 0, dup = 0, all = 0;
    for (const p of parseCsv(fs.readFileSync(file, 'utf8'))) {
      all++;
      const P = compile({ ...p, clues: p.clues.map((c) => ({ ...c })) });
      const r = rate(P);
      if (!r.solved || (r.steps || []).some((s) => s.rule === 'tryCell' || s.rule === 'tryEdge')) { trial++; continue; }
      const h = symmetryKey(P);
      if (seen.has(h)) { dup++; continue; }
      seen.add(h);
      P.solution = p.solution; P.rules = r.rules; P.tier = r.tier; P.score = r.score;
      keep.push(P);
    }
    keep.sort(byTierScore);
    books.push({ size, chosen: keep.slice(0, limit), line: `pool ${all}; ${trial} need trial and error, ${dup} repeats` });
  }
  const write = (id, chosen, nice, label, note) => {
    chosen.forEach((p, i) => name(p, id, i));
    fs.writeFileSync(`${root}data/${id}.csv`, toCsv(chosen));
    const tiers = {}; for (const p of chosen) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
    console.log(`${id}: ${chosen.length} puzzles (${note}), tiers ${JSON.stringify(tiers)}`);
    entries.push({ id, name: `Regional: ${kind}${K.merge ? '' : ' ' + nice}`, file: `data/${id}.csv`, count: chosen.length, label, group: GROUP.name, sub: K.sub, blurb: sizeBlurb(nice, tiers) });
  };
  if (K.merge) {                                   // one book for every size, easiest first
    const chosen = books.flatMap((b) => b.chosen).sort(byTierScore);
    const nice = books.map((b) => b.size.replace('x', '×')).join(' and ');
    write(`regional-${kind}`, chosen, nice, K.sub, books.map((b) => `${b.size}: ${b.chosen.length} of ${b.line}`).join('; '));
    for (const size of K.sizes) retired.add(`regional-${kind}-${size}`);
  } else for (const b of books) { const nice = b.size.replace('x', '×'); write(`regional-${kind}-${b.size}`, b.chosen, nice, `${K.sub} ${nice}`, b.line); }
}
for (const id of retired) if (fs.existsSync(`${root}data/${id}.csv`)) { fs.unlinkSync(`${root}data/${id}.csv`); console.log(`removed data/${id}.csv (now part of one book)`); }
// the books go together, in the order built: where the first of them (or of the books they replace) was, or at the end
const ids = new Set(entries.map((e) => e.id)), gone = (b) => ids.has(b.id) || retired.has(b.id);
const before = manifest.books.findIndex(gone);
const kept = manifest.books.filter((b) => !gone(b));
const at = before < 0 ? kept.length : manifest.books.slice(0, before).filter((b) => !gone(b)).length;
kept.splice(at, 0, ...entries);
manifest.books = kept;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
