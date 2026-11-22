// One puzzle, unified rating only, with the phase counters: node [--cpu-prof] prof1.mjs <book label> [index within the sample of that book]
import { loadCorpus, compile } from './lib.mjs';
import { rateUnified, STATS } from './model.mjs';
const [label, idx] = [process.argv[2], +(process.argv[3] || 0)];
const { p } = loadCorpus().filter((x) => x.label === label)[idx];
const t = Date.now(), r = rateUnified(compile(p)), ms = Date.now() - t;
const im = r.steps.filter((s) => s.rule === 'imagine').length;
console.log(p.name, p.rows + 'x' + p.cols, ms + ' ms', r.tier, r.score, 'steps', r.steps.length, 'imagine', im, JSON.stringify(STATS));
