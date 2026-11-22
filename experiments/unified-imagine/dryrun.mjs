import fs from 'node:fs';
import { loadCorpus, compile, rate } from './lib.mjs';
import { rateUnified } from './model.mjs';
const [shard, K] = [+process.argv[2], +process.argv[3]];
const corpus = loadCorpus().filter((_, i) => i % 3 === 0).filter(({ p }) => p.rows * p.cols <= 256).filter((_, i) => i % K === shard);
const out = [];
for (const { label, p } of corpus) {
  const P = compile(p);
  const a = rate(P), t = Date.now(), b = rateUnified(P);
  const im = b.steps.filter((s) => s.rule === 'imagine');
  out.push({ label, name: p.name, old: [a.tier, a.score, a.solved], neu: [b.tier, b.score, b.solved],
    imagine: im.length, box: im.filter((s) => s.hyp === 'box').length, dot: im.filter((s) => s.hyp === 'dot').length, area: im.filter((s) => s.area).length,
    fallback: b.steps.filter((s) => s.fallback).length, maxCost: Math.max(0, ...im.map((s) => s.cost)),
    oldFam: a.steps.filter((s) => ['deadEndNeighbor', 'shadeShortChain', 'boxStarvesClue', 'closingNeighbor', 'dotShortChain', 'shadeFewLines', 'boxStarvesClueByLines', 'shadeForcesLines', 'shadeClosesLoop', 'dotForcesLines'].includes(s.rule)).length, ms: Date.now() - t });
}
fs.writeFileSync(`dry_${process.env.MODEL || 'A'}_${shard}.json`, JSON.stringify(out));
console.log('shard', shard, 'done', out.length);
