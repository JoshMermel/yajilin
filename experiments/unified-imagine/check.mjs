// Regression check: node check.mjs <model module> [count] [maxCells] -> one line per puzzle (tier, score, step sequence hash) and the total time
import { loadCorpus, compile } from './lib.mjs';
const mod = await import(process.argv[2] || './model.mjs');
const count = +(process.argv[3] || 40), maxCells = +(process.argv[4] || 256);
const corpus = loadCorpus().filter(({ p }) => p.rows * p.cols <= maxCells).filter((_, i) => i % 5 === 0).slice(0, count);
const t0 = Date.now();
for (const { p } of corpus) {
  const r = mod.rateUnified(compile(p));
  let h = 0; for (const s of r.steps) for (const c of `${s.rule}${s.cost}${JSON.stringify(s.sets || '')}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  console.log(p.name, r.tier, r.score, r.steps.length, h);
}
console.error('ms', Date.now() - t0);
