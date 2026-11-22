// Time old vs unified rating on the big boards: node bigprof.mjs <shard> <shards> [perBook]  (one line per puzzle, as JSON, to stdout)
import { loadCorpus, compile, rate } from './lib.mjs';
import { rateUnified } from './model.mjs';
const [shard, shards, per] = [+(process.argv[2] || 0), +(process.argv[3] || 1), +(process.argv[4] || 1)];
const seen = {};
const big = loadCorpus().filter(({ p }) => p.rows * p.cols > 256).filter(({ label }) => (seen[label] = (seen[label] || 0) + 1) <= per);
big.filter((_, i) => i % shards === shard).forEach(({ label, p }) => {
  const P = compile(p);
  let t = Date.now(); const a = rate(P); const old = Date.now() - t;
  t = Date.now(); const b = rateUnified(P); const neu = Date.now() - t;
  console.log(JSON.stringify({ label, name: p.name, size: p.rows + 'x' + p.cols, old, neu, ratio: +(neu / Math.max(old, 1)).toFixed(1), tier: [a.tier, b.tier], score: [a.score, b.score] }));
});
