// Print the style of every puzzle in one or more CSV files: clue numbers, arrow directions and how many arrows point at the
// nearer board edge (Nikoli: 66-84%; PuzzleMadness and the default generator: far fewer).
//
//   node tools/style_stats.mjs data/large.csv data/bonus-longway.csv
import fs from 'node:fs';
import { compile, parseCsv } from '../js/logic.js';

for (const f of process.argv.slice(2)) {
  for (const p of parseCsv(fs.readFileSync(f, 'utf8'))) {
    const P = compile(p);
    const n = P.clues.map((c) => c.n);
    const dirs = [0, 1, 2, 3].map((d) => P.clues.filter((c) => c.d === d).length);
    let near = 0;
    for (const c of P.clues) {
      const e = [c.r, p.cols - 1 - c.c, p.rows - 1 - c.r, c.c];
      const mine = e[c.d], opp = e[(c.d + 2) % 4];
      near += mine < opp ? 1 : mine === opp ? 0.5 : 0;
    }
    const mean = n.reduce((a, b) => a + b, 0) / n.length;
    console.log(`${p.name.padEnd(18)} ${`${p.cols}x${p.rows}`.padEnd(6)} clues ${String(n.length).padStart(3)}  mean n ${mean.toFixed(2)}  n<=1 ${String(Math.round((100 * n.filter((v) => v <= 1).length) / n.length)).padStart(3)}%  zeros ${String(n.filter((v) => v === 0).length).padStart(2)}  U/R/D/L ${dirs.join('/').padEnd(11)} nearer edge ${String(Math.round((100 * near) / n.length)).padStart(3)}%  ${p.tier || ''}${p.rules ? ' / ' + p.rules : ''}`);
  }
}
