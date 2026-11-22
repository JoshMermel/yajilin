// Does rate() in js/rating.js (the adopted rule) give the prototype's tier and score? node parity.mjs <expected file from check.mjs> [count]
import fs from 'node:fs';
import { loadCorpus, compile, rate } from './lib.mjs';
const exp = Object.fromEntries(fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => { const [name, tier, score, n] = l.split(' '); return [name, { tier, score: +score, n: +n }]; }));
const count = +(process.argv[3] || 40), maxCells = +(process.argv[4] || 256);
const corpus = loadCorpus().filter(({ p }) => p.rows * p.cols <= maxCells).filter((_, i) => i % 5 === 0).slice(0, count);
let bad = 0; const t0 = Date.now();
for (const { p } of corpus) {
  const r = rate(compile(p)), e = exp[p.name];
  if (!e) continue;
  if (r.tier !== e.tier || r.score !== e.score || r.steps.length !== e.n) { bad++; console.log('DIFF', p.name, 'expected', e.tier, e.score, e.n, 'got', r.tier, r.score, r.steps.length); }
}
console.log('checked', corpus.length, 'different', bad, 'ms', Date.now() - t0);
