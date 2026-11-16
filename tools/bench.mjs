// Benchmark the hot paths and fingerprint their outputs, so an optimization can be shown to change speed and nothing else:
//
//   node tools/bench.mjs [--js DIR] [--quick] [--json out.json]
//
// --js points at another copy of the js/ folder (to compare with an older version: `git archive HEAD js | tar -x -C /tmp/old`, then
// `--js /tmp/old/js`). Times are CPU milliseconds of this process. Every section ends with a fingerprint (a hash of what the code
// returned); two versions that print the same fingerprints did the same thing.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const jsDir = path.resolve(arg('js', root + 'js'));
const quick = process.argv.includes('--quick');
const L = await import(pathToFileURL(jsDir + '/logic.js'));
const R = await import(pathToFileURL(jsDir + '/rating.js'));
const G = await import(pathToFileURL(jsDir + '/generator.js'));

const book = (id, n) => L.parseCsv(fs.readFileSync(`${root}data/${id}.csv`, 'utf8')).slice(0, n).map(L.compile);
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const out = {};
const section = (name, fn) => { const t0 = cpu(); const sig = fn(); out[name] = { ms: Math.round(cpu() - t0), fingerprint: hash(sig) }; console.log(`${name.padEnd(34)} ${String(out[name].ms).padStart(7)} ms   ${out[name].fingerprint}`); };
const k = quick ? 0.4 : 1;

// 1. the exhaustive solver, from scratch (what generate.mjs's cross-check, loopIsUnique and the audit's fallback use)
for (const [id, n] of [['8x8', 20], ['12x12', 8]]) {
  const ps = book(id, Math.ceil(n * k));
  section(`solve from scratch ${id} x${ps.length}`, () => ps.map((P) => { const r = L.solve(P, { limit: 2 }); return `${r.count}${r.exceeded}${r.solutions.map((s) => L.encodeSolution(P, s)).join('|')}`; }).join('\n'));
}
// 2. the machine's propagation on partial positions (solution minus every third cell)
section('propagate on partial positions', () => {
  const ps = [...book('8x8', Math.ceil(30 * k)), ...book('12x12', Math.ceil(15 * k)), ...book('16x16', Math.ceil(6 * k))];
  let sig = '';
  for (const P of ps) {
    const sol = L.decodeSolution(P, P.solution);
    for (let rep = 0; rep < 4; rep++) {
      const st = L.initialState(P);
      for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && (i * 7 + rep * 3) % 3 === 0) st.cell[i] = sol.cell[i];
      for (let x = 0; x < P.numEdges; x++) if (sol.e[x] === L.E_ON && (x * 5 + rep) % 4 === 0) st.e[x] = L.E_ON;
      const ok = L.propagate(P, st);
      sig += `${ok ? 1 : 0}${Array.from(st.cell).join('')}${Array.from(st.e).join('')};`;
    }
  }
  return sig;
});
// 3. scoring: rate() on stored puzzles of each size
for (const [id, n] of [['8x8', 40], ['12x12', 20], ['16x16', 8], ['20x20', 4]]) {
  const ps = book(id, Math.ceil(n * k));
  section(`rate ${id} x${ps.length}`, () => ps.map((P) => { const q = R.rate(P); return `${q.tier}/${q.score}/${q.rules}/${q.solved}`; }).join('\n'));
}
// 4. generation with fixed seeds (budgets are generous, so wall-clock never changes the result)
for (const [rows, cols, seeds] of [[8, 8, 6], [12, 12, 3], [14, 14, 2]]) {
  section(`generate ${cols}x${rows} x${Math.ceil(seeds * k) || 1}`, () => {
    let sig = '';
    for (let s = 1; s <= (Math.ceil(seeds * k) || 1); s++) {
      const r = G.generatePuzzle(rows, cols, G.makeRng(1000 + s), { budgetMs: 120000 });
      sig += r ? r.puzzle.solution + L.cluesToString(r.puzzle.clues) + ';' : 'none;';
    }
    return sig;
  });
}
const total = Object.values(out).reduce((a, v) => a + v.ms, 0);
console.log(`${'TOTAL'.padEnd(34)} ${String(total).padStart(7)} ms`);
if (arg('json', '')) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 2));
