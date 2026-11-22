// Profile rateUnified on a few puzzles: node --cpu-prof --cpu-prof-dir=<dir> prof.mjs [count] [maxCells]
import { loadCorpus, compile, rate } from './lib.mjs';
import { rateUnified } from './model.mjs';
const count = +(process.argv[2] || 6), maxCells = +(process.argv[3] || 256);
const corpus = loadCorpus().filter(({ p }) => p.rows * p.cols <= maxCells).filter((_, i) => i % 11 === 0).slice(0, count);
let tOld = 0, tNew = 0;
for (const { label, p } of corpus) {
  const P = compile(p);
  let t = Date.now(); rate(P); const a = Date.now() - t; tOld += a;
  t = Date.now(); rateUnified(P); const b = Date.now() - t; tNew += b;
  console.log(label, p.name, p.rows + 'x' + p.cols, 'old', a, 'ms new', b, 'ms');
}
console.log('total old', tOld, 'new', tNew);
