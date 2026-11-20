// Audit every puzzle in the shipped books, independently of the generator (run before publishing, and after any rebuild):
//
//   node tools/audit_books.mjs [--book id[,id...]] [--jobs 8] [--chunk 50] [--rate]
//
// For each puzzle: the clues are in bounds, on distinct cells, with sensible numbers; the stored solution is a valid solution
// (checkSolved); and the puzzle has exactly ONE solution, proved without trusting the generator: the sound rules (everything but
// the ones that assume uniqueness) are run to a fixed point, and if they finish the puzzle the result must equal the stored solution;
// if they do not, an exhaustive search (limit 2) must find exactly one solution, equal to the stored one, without hitting its node cap.
// Per book: puzzle names are distinct, no puzzle appears twice, and the manifest count matches. With --rate, the stored tier and score
// must also equal a fresh rating (slow on big boards: the default books skip it; `tools/rescore.mjs` keeps them current).
// Exits 1 if anything fails. Work is split into chunks and run in parallel child processes.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { parseCsv, compile, solve, decodeSolution, checkSolved, symmetryKey, SHADED, E_ON } from '../js/logic.js';
import { RULES, solvedByRules, rate } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const manifest = JSON.parse(fs.readFileSync(root + 'data/manifest.json', 'utf8'));
const loadBook = (entry) => parseCsv(fs.readFileSync(root + entry.file, 'utf8'));

// ------------------------------------------------------------ worker: one chunk of one book
if (process.argv.includes('--worker')) {
  const entry = manifest.books.find((b) => b.id === arg('worker'));
  const [from, to] = arg('range').split('-').map(Number);
  const withRating = process.argv.includes('--rate');
  const upto = RULES.findIndex((r) => r.assumesUnique);        // every sound rule, trial-and-error ones included
  const out = { checked: 0, bad: [], exhaustive: 0 };
  loadBook(entry).slice(from, to).forEach((raw, k) => {
    const name = raw.name, fail = (why) => out.bad.push(`${entry.id} #${from + k + 1} ${name}: ${why}`);
    out.checked++;
    // structure
    const seen = new Set();
    for (const c of raw.clues) {
      if (c.r < 0 || c.c < 0 || c.r >= raw.rows || c.c >= raw.cols) return fail('clue outside the board');
      const cell = c.r * raw.cols + c.c;
      if (seen.has(cell)) return fail('two clues on one cell');
      seen.add(cell);
      if (c.n === -1) continue;                                            // a void cell: no arrow, no number
      if (!(c.d >= 0 && c.d <= 7) || !(c.n >= 0)) return fail('bad clue direction or number');
    }
    let P;
    try { P = compile(raw); } catch (e) { return fail(`does not compile: ${e.message}`); }
    for (const c of raw.clues) if (c.n > P.rays[raw.clues.indexOf(c)].length) return fail('a clue number is larger than its line');
    if (P.regional) {                                                      // regions: every cell in one, and each region in one piece
      for (const [g, cells] of P.regionCells.entries()) {
        if (!cells.length) return fail(`region ${g} is empty`);
        const seenCells = new Set([cells[0]]), stack = [cells[0]];
        while (stack.length) { const i = stack.pop(); for (const j of [i - P.cols, i + P.cols, i % P.cols ? i - 1 : -1, (i + 1) % P.cols ? i + 1 : -1]) if (j >= 0 && j < P.N && P.regionOf[j] === g && !seenCells.has(j)) { seenCells.add(j); stack.push(j); } }
        if (seenCells.size !== cells.length) return fail(`region ${g} is not in one piece`);
      }
    }
    if (!raw.solution || raw.solution.length !== P.N) return fail('no stored solution of the right length');
    // the stored solution is valid
    const sol = decodeSolution(P, raw.solution);
    if (!checkSolved(P, Uint8Array.from(sol.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(sol.e, (v) => (v === E_ON ? 1 : 0)))) return fail('the stored solution is not a valid solution');
    // exactly one solution
    const same = (st) => { for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && (st.cell[i] === SHADED) !== (sol.cell[i] === SHADED)) return false; for (let x = 0; x < P.numEdges; x++) if ((st.e[x] === E_ON) !== (sol.e[x] === E_ON)) return false; return true; };
    const byRules = solvedByRules(P, upto);
    if (byRules.solved) { if (!same(byRules.state)) return fail('the rules solve it to a DIFFERENT answer than the stored one'); }
    else {
      out.exhaustive++;
      const r = solve(P, { limit: 2, maxNodes: 5e6 });
      if (r.exceeded) return fail('uniqueness not proved: the rules stop short and the exhaustive search hit its node cap');
      if (r.count !== 1) return fail(`${r.count} solutions`);
      if (!same(r.solutions[0])) return fail('the only solution differs from the stored one');
    }
    if (withRating) {
      const q = rate(P);
      if (q.tier !== raw.tier || q.score !== raw.score) fail(`stored ${raw.tier}/${raw.score} but rates ${q.tier}/${q.score}`);
    }
  });
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}

// ------------------------------------------------------------ main
const only = arg('book', '') ? arg('book').split(',') : null;
const chunk = +arg('chunk', 50), jobs = +arg('jobs', Math.max(2, os.cpus().length - 1));
const withRating = process.argv.includes('--rate');
const problems = [], tasks = [], everywhere = new Map();     // everywhere: symmetry key -> book:name of the first puzzle seen
let total = 0;
for (const entry of manifest.books.filter((b) => (only ? only.includes(b.id) : !b.hidden))) {      // (a hidden book, the armory, has copies of puzzles from the others: audit it with --book)
  const ps = loadBook(entry);
  total += ps.length;
  if (ps.length !== entry.count) problems.push(`${entry.id}: the manifest says ${entry.count} puzzles, the file has ${ps.length}`);
  const names = new Set(), hashes = new Map();
  ps.forEach((p, i) => {
    if (names.has(p.name)) problems.push(`${entry.id}: the name ${p.name} appears twice`);
    names.add(p.name);
    const h = symmetryKey(p);                                   // the same puzzle, or a turned or mirrored copy of it
    if (hashes.has(h)) problems.push(`${entry.id}: ${p.name} is the same puzzle as ${hashes.get(h)} (possibly turned or mirrored)`);
    else if (everywhere.has(h)) problems.push(`${entry.id}: ${p.name} is the same puzzle as ${everywhere.get(h)} (possibly turned or mirrored)`);
    hashes.set(h, p.name);
    if (!everywhere.has(h)) everywhere.set(h, `${entry.id}:${p.name}`);
  });
  for (let from = 0; from < ps.length; from += chunk) tasks.push({ id: entry.id, range: `${from}-${Math.min(ps.length, from + chunk)}` });
}
console.log(`auditing ${total} puzzles in ${tasks.length} chunks, ${jobs} at a time${withRating ? ', with ratings' : ''}`);
let checked = 0, exhaustive = 0, running = 0, done = 0;
const t0 = Date.now();
await new Promise((resolve) => {
  const next = () => {
    if (!tasks.length && !running) return resolve();
    while (running < jobs && tasks.length) {
      const t = tasks.shift(); running++;
      const args = [new URL(import.meta.url).pathname, '--worker', t.id, '--range', t.range, ...(withRating ? ['--rate'] : [])];
      let buf = '';
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
      child.stdout.on('data', (d) => { buf += d; });
      child.on('exit', (code) => {
        running--; done++;
        try { const r = JSON.parse(buf); checked += r.checked; exhaustive += r.exhaustive; problems.push(...r.bad); } catch { problems.push(`${t.id} ${t.range}: the worker died (exit ${code})`); }
        if (done % 10 === 0) console.log(`  ${checked} puzzles checked (${Math.round((Date.now() - t0) / 1000)} s), ${problems.length} problems so far`);
        next();
      });
    }
  };
  next();
});
console.log(`${checked} of ${total} puzzles checked in ${Math.round((Date.now() - t0) / 1000)} s; ${exhaustive} needed the exhaustive search to prove uniqueness`);
if (problems.length) { console.log(`${problems.length} PROBLEMS:`); for (const p of problems) console.log('  ' + p); process.exit(1); }
console.log('all clear');
