// Difficulty range of a set of pools: rate every puzzle, print the distribution, and write sample puzzles spread across the range.
//
//   node tools/range_report.mjs --pools experiments/range/pools --out experiments/range [--samples 5]
//
// Writes <out>/range.json (per puzzle stats), <out>/report.md, <out>/samples.csv (a playable book: for each size, puzzles at
// evenly spaced difficulty quantiles, hardest to easiest).
import fs from 'node:fs';
import path from 'node:path';
import { compile, parseCsv, toCsvRow, CSV_HEADER } from '../js/logic.js';
import { rate } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const poolDir = path.resolve(root, arg('pools', 'experiments/range/pools')), outDir = path.resolve(root, arg('out', 'experiments/range'));
const nSamples = +arg('samples', 5);

const all = [];
for (const f of fs.readdirSync(poolDir).filter((f) => f.endsWith('.csv')).sort()) {
  for (const raw of parseCsv(fs.readFileSync(path.join(poolDir, f), 'utf8'))) {
    const P = compile(raw);
    const rating = rate(P);
    const N = P.rows * P.cols;
    const boxes = [...P.solution].filter((c) => c === 'x').length;
    all.push({ P, raw, size: `${P.cols}x${P.rows}`, N, score: rating.score, tier: rating.tier, rule: rating.rules, steps: rating.steps.length, counts: rating.counts,
      clues: P.clues.length / N, boxes: boxes / N, solved: rating.solved, name: P.name });
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const q = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const md = ['# Difficulty range', '', `Pools: \`${path.relative(root, poolDir)}\` (Nikoli-style settings: --edge-bias 0.8 --shade 0.7). Difficulty = the human-style solver's score; every puzzle is rule-solved, hence unique.`, ''];
const samples = [];
const sizes = [...new Set(all.map((p) => p.size))];
for (const size of sizes) {
  const G = all.filter((p) => p.size === size).sort((a, b) => a.score - b.score);
  const S = G.map((p) => p.score);
  md.push(`## ${size} (${G.length} puzzles)`, '');
  md.push(`score: min ${S[0].toFixed(0)}, 10% ${q(S, 0.1).toFixed(0)}, 25% ${q(S, 0.25).toFixed(0)}, median ${q(S, 0.5).toFixed(0)}, 75% ${q(S, 0.75).toFixed(0)}, 90% ${q(S, 0.9).toFixed(0)}, max ${S[S.length - 1].toFixed(0)} (mean ${mean(S).toFixed(0)}, sd ${sd(S).toFixed(0)}, max/min ${(S[S.length - 1] / S[0]).toFixed(2)})  `);
  md.push(`score per cell: mean ${mean(G.map((p) => p.score / p.N)).toFixed(2)}, sd ${sd(G.map((p) => p.score / p.N)).toFixed(2)}  `);
  md.push(`clue cells ${(100 * mean(G.map((p) => p.clues))).toFixed(1)}%, boxes ${(100 * mean(G.map((p) => p.boxes))).toFixed(1)}%  `);
  const tiers = {}; for (const p of G) tiers[p.tier] = (tiers[p.tier] || 0) + 1;
  md.push(`tiers: ${Object.entries(tiers).map(([k, v]) => `${k} ${v}`).join(', ')}  `);
  const rules = {}; for (const p of G) rules[p.rule] = (rules[p.rule] || 0) + 1;
  md.push(`hardest rule needed: ${Object.entries(rules).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');
  // histogram
  const lo = S[0], hi = S[S.length - 1], bins = 10, w = (hi - lo) / bins || 1;
  const h = new Array(bins).fill(0); for (const s of S) h[Math.min(bins - 1, Math.floor((s - lo) / w))]++;
  md.push('```', ...h.map((c, i) => `${String(Math.round(lo + i * w)).padStart(4)}-${String(Math.round(lo + (i + 1) * w)).padEnd(4)} ${'#'.repeat(c)} ${c}`), '```', '');
  // what separates easy from hard inside this size: mean uses of each rule in the easiest vs hardest quarter
  const k = Math.max(1, Math.floor(G.length / 4)), easy = G.slice(0, k), hard = G.slice(-k);
  const ruleIds = [...new Set(G.flatMap((p) => Object.keys(p.counts)))];
  const rows = ruleIds.map((r) => [r, mean(easy.map((p) => p.counts[r] || 0)), mean(hard.map((p) => p.counts[r] || 0))]).filter(([, a, b]) => a + b >= 0.5).sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]));
  md.push(`Steps by rule, easiest quarter vs hardest quarter (mean uses per puzzle):`, '', '| rule | easiest quarter | hardest quarter |', '| --- | --- | --- |', ...rows.map(([r, a, b]) => `| ${r} | ${a.toFixed(1)} | ${b.toFixed(1)} |`), '');
  // samples at evenly spaced quantiles, hardest first
  const ids = [];
  for (let i = 0; i < nSamples; i++) ids.push(Math.round((1 - i / (nSamples - 1)) * (G.length - 1)));
  md.push('Samples (in `samples.csv`):', '', '| name | score | tier | hardest rule | clue cells | boxes |', '| --- | --- | --- | --- | --- | --- |');
  ids.forEach((id, i) => {
    const p = G[id];
    const P = { ...p.raw, rules: p.rule, tier: p.tier, score: Math.round(p.score), name: `${size} d${nSamples - i} (score ${Math.round(p.score)})` };
    samples.push(P);
    md.push(`| ${P.name} | ${p.score.toFixed(0)} | ${p.tier} | ${p.rule} | ${(100 * p.clues).toFixed(1)}% | ${(100 * p.boxes).toFixed(1)}% |`);
  });
  md.push('');
}
fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n'));
fs.writeFileSync(path.join(outDir, 'samples.csv'), CSV_HEADER + '\n' + samples.map(toCsvRow).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'range.json'), JSON.stringify(all.map(({ P, raw, ...r }) => r)));
console.log(md.join('\n'));
