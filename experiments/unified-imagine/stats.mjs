import { loadCorpus, compile } from './lib.mjs';
import { rateUnified, STATS } from './model.mjs';
const want = process.argv.slice(2);
for (const { p } of loadCorpus().filter(({ p }) => want.includes(p.name))) {
  for (const k in STATS) STATS[k] = 0;
  const t = Date.now(), r = rateUnified(compile(p)), ms = Date.now() - t;
  const im = r.steps.filter((s) => s.rule === 'imagine').length;
  console.log(p.name, p.rows + 'x' + p.cols, ms + 'ms', 'steps', r.steps.length, 'imagine steps', im, JSON.stringify(STATS), 'runs/imagine', (STATS.runs / Math.max(im, 1)).toFixed(0));
}
