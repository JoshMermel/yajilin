// Which candidate regional techniques finish puzzles the older rules leave stuck?
//
//   node experiments/regional/ablation.mjs [pool-glob-prefix ...]     (default: the rsch_stuck_* pools in tools/library/)
//
// Each puzzle is solved with the base rules (every rule before the trial-and-error ones, without the candidates) and with each candidate added.
// A candidate is also checked for SOUNDNESS: when it lets the rules finish, the finished position must equal the puzzle's stored solution.
import fs from 'node:fs';
import { parseCsv, compile, decodeSolution, SHADED, E_ON } from '../../js/logic.js';
import { RULES, solvedByRules } from '../../js/rating.js';

const root = new URL('../../', import.meta.url).pathname + 'tools/library/';
const prefixes = process.argv.slice(2).length ? process.argv.slice(2) : ['rsch_stuck_'];
const puzzles = [];
for (const f of fs.readdirSync(root).filter((f) => prefixes.some((p) => f.startsWith(p)) && f.endsWith('.csv')).sort()) {
  for (const raw of parseCsv(fs.readFileSync(root + f, 'utf8'))) puzzles.push(compile(raw));
}
const first = RULES.findIndex((r) => r.lookahead);
const CANDIDATES = ['colorBalance', 'regionPairs'];
const baseIds = RULES.slice(0, first).map((r) => r.id).filter((id) => !CANDIDATES.includes(id));
const configs = [['base', baseIds], ...CANDIDATES.map((c) => [`+${c}`, [...baseIds, c]]), ['+both', [...baseIds, ...CANDIDATES]]];
const same = (P, st) => { const sol = decodeSolution(P, P.solution); for (let i = 0; i < P.N; i++) if ((st.cell[i] === SHADED) !== (sol.cell[i] === SHADED)) return false; for (let x = 0; x < P.numEdges; x++) if ((st.e[x] === E_ON) !== (sol.e[x] === E_ON)) return false; return true; };
const bySize = new Map();
for (const P of puzzles) {
  const key = `${P.cols}x${P.rows}`;
  if (!bySize.has(key)) bySize.set(key, []);
  bySize.get(key).push(P);
}
console.log(`${puzzles.length} puzzles from ${prefixes.join(', ')}`);
let unsound = 0;
for (const [size, list] of bySize) {
  const row = {};
  for (const [name, ids] of configs) {
    let solved = 0, ms = 0;
    for (const P of list) {
      const t = Date.now();
      const r = solvedByRules(P, ids);
      ms += Date.now() - t;
      if (r.solved) { solved++; if (!same(P, r.state)) { unsound++; console.log(`  UNSOUND: ${P.name} with ${name}`); } }
    }
    row[name] = `${solved}/${list.length} (${ms} ms)`;
  }
  console.log(size, row);
}
console.log(unsound ? `${unsound} UNSOUND results` : 'sound: every finished position equals the stored solution');
