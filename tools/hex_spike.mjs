// Hex generator spike: node tools/hex_spike.mjs --size 6x6 --count 10 [--seed 1] [--budget 60000] [--maxNodes 200000] [--show] [--csv out.csv]
// Prints one line per puzzle and a summary: how often generation works, how many arrows a unique puzzle needs, how long it takes,
// and how much of the board plain propagation settles ("undecided" 0 means no search is needed at all).
import fs from 'node:fs';
import { makeRng } from '../js/generator.js';
import { generateHex } from '../js/generator_hex.js';
import { toCsv, HEX_ARROWS } from '../js/logic.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const [rows, cols] = String(args.size || '6x6').split('x').map(Number);
const count = +(args.count || 10), seed = +(args.seed || 1), budgetMs = +(args.budget || 60000), maxNodes = +(args.maxNodes || 200000);
const pool = [];
const stats = [];
let failed = 0;
const reasons = {};
const T0 = Date.now();
for (let k = 0; k < count; k++) {
  const rng = makeRng(seed * 1000 + k);
  const g = generateHex(rows, cols, rng, { name: `hex-${rows}x${cols}-${k + 1}`, budgetMs, maxNodes, mode: args.mode || 'probe' });
  if (g.fail) { failed++; reasons[g.fail] = (reasons[g.fail] || 0) + 1; console.log(`#${k + 1}: failed: ${g.fail}`); continue; }
  const s = g.stats;
  stats.push(s);
  console.log(`#${k + 1}: holes ${s.holes} (${(100 * s.holes / s.cells).toFixed(0)}%)  arrows ${s.arrows} (${s.arrowsBeforePrune} before pruning)  boxes ${s.boxes}  undecided ${s.undecided}  level ${s.level}  nodes ${s.nodes}  ${s.msTotal} ms (holes ${s.msHoles}), ${s.checks} checks`);
  pool.push(g.puzzle);
  if (args.show && k === 0) show(g);
}
const avg = (f) => (stats.length ? (stats.reduce((a, s) => a + f(s), 0) / stats.length).toFixed(1) : '-');
console.log(`\n${rows}x${cols} hex: ${stats.length}/${count} generated (${failed} failed${failed ? ': ' + JSON.stringify(reasons) : ''}), ${((Date.now() - T0) / 1000).toFixed(1)} s total`);
console.log(`  mean holes ${avg((s) => s.holes)} of ${rows * cols} cells, arrows ${avg((s) => s.arrows)}, boxes ${avg((s) => s.boxes)}, undecided after propagation ${avg((s) => s.undecided)}, search nodes ${avg((s) => s.nodes)}, ms ${avg((s) => s.msTotal)}`);
console.log(`  by level (0 = propagation, 1 = one-step lookahead, -1 = needs search): ${[0, 1, -1].map((l) => `${l}:${stats.filter((s) => s.level === l).length}`).join('  ')}`);
console.log(`  solved by propagation alone: ${stats.filter((s) => s.undecided === 0).length}/${stats.length}`);
if (args.csv && pool.length) { fs.writeFileSync(args.csv, toCsv(pool)); console.log(`wrote ${pool.length} puzzles to ${args.csv}`); }

/** An ASCII picture: odd rows shifted right; [n>] an arrow cell, # a box, . a loop cell. */
function show({ puzzle: P }) {
  const sol = P.solution;
  for (let r = 0; r < P.rows; r++) {
    let line = r & 1 ? '  ' : '';
    for (let c = 0; c < P.cols; c++) {
      const i = r * P.cols + c, k = P.clueAt[i];
      line += k >= 0 ? ` ${P.clues[k].n}${HEX_ARROWS[P.clues[k].d]} ` : sol[i] === 'x' ? ' ## ' : ' .  ';
    }
    console.log(line);
  }
}
