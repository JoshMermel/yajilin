// Shared by the book builders: keep only the wanted board sizes and take an even share of `limit` puzzles from each, thinned evenly by
// rated score within a size. A size that has fewer puzzles than its share gives the unused part to the sizes that have more.
// Sizes are written "10x10", "4x36": the order of the two numbers does not matter (a 36x4 board counts as 4x36).
import { compareRatings } from '../js/rating.js';

/** The order of every book: easiest tier first, then lowest score (the rated difficulty) within a tier. */
export const byTierScore = (a, b) => compareRatings({ tier: a.tier, score: a.score ?? 0 }, { tier: b.tier, score: b.score ?? 0 });
export const sizeKey = (p) => `${Math.min(p.rows, p.cols)}x${Math.max(p.rows, p.cols)}`;
export const normSize = (s) => { const [a, b] = s.split('x').map(Number); return `${Math.min(a, b)}x${Math.max(a, b)}`; };

export function pickBySize(puzzles, sizes, limit) {
  const want = sizes.map(normSize);
  const groups = new Map(want.map((k) => [k, []]));
  for (const p of puzzles) if (groups.has(sizeKey(p))) groups.get(sizeKey(p)).push(p);
  for (const g of groups.values()) g.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const take = new Map(want.map((k) => [k, 0]));
  let left = limit || Infinity;
  for (let progress = true; progress && left > 0;) {            // hand out one puzzle at a time, round-robin, to sizes that still have some
    progress = false;
    for (const k of want) if (left > 0 && take.get(k) < groups.get(k).length) { take.set(k, take.get(k) + 1); left--; progress = true; }
  }
  const out = [];
  for (const k of want) {
    const g = groups.get(k), c = take.get(k);
    for (let j = 0; j < c; j++) out.push(g[Math.floor(((j + 0.5) * g.length) / c)]);
  }
  out.sort(byTierScore);
  return out;
}

/** Sizes spoken as the generator's COLSxROWS from the command line: "--sizes 10x10,12x12" -> ['10x10','12x12'] (or null if not given). */
export const sizesArg = (argv) => { const i = argv.indexOf('--sizes'); return i > 0 ? argv[i + 1].split(',') : null; };
