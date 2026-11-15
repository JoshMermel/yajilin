// Where does the human-style solver get stuck? Export every such position as JSON, then render images with tools/render_stuck.py.
//
//   node tools/stuck_report.mjs [--min-cells 100] [--max-cells N] [--no-existing] [--out tools/calibration/stuck] [--derive 30] [--max-undecided 14] [--seed 1] [--from data/large.csv,...]
//
// Cases: (1) every puzzle in data/ and tools/library/ the non-lookahead rules cannot finish; (2) --derive N more, made from our
// own generated puzzles by removing clues one at a time (a removed clue's cell becomes a box the solver must find) for as long as
// a COMPLETE exhaustive search confirms the puzzle is still unique, stopping at the first position where the rules run out with at
// most --max-undecided cells left. Those are the "one missing inference" cases.
//
// For each case the JSON holds the position the rules reach (cells and segments known), the undecided cells, the solution, and the
// cheapest lookahead deductions (tryCell / tryEdge) with the chain of forced moves that ends in a contradiction.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compile, parseCsv, solve, decodeSolution, encodeSolution, cloneState, checkSolved, UNKNOWN, SHADED, LOOP, E_ON, E_OFF } from '../js/logic.js';
import { solvedByRules, solvedByHumanRules, RULES, FIRST_LOOKAHEAD, contradiction, oddOpenEnds } from '../js/rating.js';
import { makeRng } from '../js/generator.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const outDir = path.resolve(root, arg('out', 'tools/calibration/stuck'));
const derive = +arg('derive', 30), maxUnd = +arg('max-undecided', 14), seed = +arg('seed', 1), minutes = +arg('minutes', 8);
const minCells = +arg('min-cells', 100), maxCells = +arg('max-cells', 1e9), noExisting = process.argv.includes('--no-existing'), scan = process.argv.includes('--scan');   // --scan: look for already-stuck puzzles in --from instead of in data/
const t0 = Date.now();
const sources = arg('from', 'data/large.csv,data/large-nk.csv,data/bonus-longway.csv,data/bonus-onedir.csv,data/bonus-bignum.csv,data/experiment-tall.csv,data/range-samples.csv').split(',');
fs.mkdirSync(path.join(outDir, 'json'), { recursive: true });
const rng = makeRng(seed);

const undecidedOf = (P, st) => { const u = []; for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && st.cell[i] === UNKNOWN) u.push(i); return u; };

// ---- say WHAT is contradictory (the same checks as rating.contradiction), and where
const colName = (c) => String.fromCharCode(65 + c);
const nameOf = (P, i) => `${colName(i % P.cols)}${((i / P.cols) | 0) + 1}`;
function whyContradiction(P, st) {
  const on = (i) => { let n = 0; for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_ON) n++; } return n; };
  const exits = (i) => { let n = 0; for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x < 0) continue; const j = P.nb[i * 4 + d]; if (st.e[x] === E_OFF || st.cell[j] === SHADED) continue; if (st.e[x] !== E_ON && on(j) >= 2) continue; n++; } return n; };
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] === 3) continue;
    if (st.cell[i] === SHADED) for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && st.cell[j] === SHADED) return { cells: [i, j], text: `boxes ${nameOf(P, i)} and ${nameOf(P, j)} would touch` }; }
    else {
      const o = on(i);
      if (o > 2) return { cells: [i], text: `${nameOf(P, i)} would need ${o} lines` };
      if ((st.cell[i] === LOOP || o > 0) && exits(i) < 2) return { cells: [i], text: `${nameOf(P, i)} is on the loop but has fewer than two ways out` };
    }
  }
  for (let k = 0; k < P.clues.length; k++) {
    let sh = 0, un = 0; for (const i of P.rays[k]) { if (st.cell[i] === SHADED) sh++; else if (st.cell[i] === UNKNOWN) un++; }
    const cl = P.clues[k], ci = cl.r * P.cols + cl.c;
    if (sh > cl.n) return { cells: [ci], text: `the clue at ${nameOf(P, ci)} would have more than ${cl.n} boxes` };
    if (sh + un < cl.n) return { cells: [ci], text: `the clue at ${nameOf(P, ci)} could no longer reach ${cl.n} boxes` };
  }
  const odd = oddOpenEnds(P, st);
  if (odd) return { cells: odd, text: `a part of the board would hold an odd number (${odd.length}) of open ends: ${odd.map((i) => nameOf(P, i)).join(' ')}` };
  return { cells: [], text: 'the loop would close with other loop cells left outside it' };
}

// ---- the chain of consequences from an assumption, up to the contradiction (the engine inside tryCell / tryEdge)
const applySets = (st, sets) => { for (const [k, i, v] of sets) { const a = k === 'c' ? st.cell : st.e; if (a[i] === 0) a[i] = v; else if (a[i] !== v) return false; } return true; };
function chainOf(P, st, assumption) {
  const s2 = cloneState(st);
  applySets(s2, assumption);
  const steps = [];
  for (let guard = 0; guard < 2000; guard++) {
    if (contradiction(P, s2)) return { contradiction: true, steps, why: whyContradiction(P, s2) };
    let fired = false;
    for (let r = 0; r < FIRST_LOOKAHEAD; r++) {
      const fs_ = RULES[r].find(P, s2, { upto: r });
      if (!fs_.length) continue;
      const sets = [];
      for (const f of fs_) { if (!applySets(s2, f.sets)) return { contradiction: true, steps, why: { cells: [], text: 'two rules force opposite things' } }; sets.push(...f.sets); }
      steps.push({ rule: RULES[r].id, sets }); fired = true; break;
    }
    if (!fired) return { contradiction: false, steps };
  }
  return { contradiction: false, steps };
}

function reportOf(name, source, p) {
  const P = compile({ ...p, clues: p.clues.map((c) => ({ ...c })) });
  const r = solvedByHumanRules(P);   // stuck for a person: the plain rules plus the ones that assume a unique solution
  if (r.solved) return null;
  const st = r.state;
  const sol = decodeSolution(P, p.solution);
  const lookahead = [];
  for (const id of ['tryCell', 'tryEdge']) {
    const rule = RULES.find((q) => q.id === id);
    for (const f of rule.find(P, st, { upto: FIRST_LOOKAHEAD }).slice(0, 3)) {
      const assumption = id === 'tryCell'
        ? [['c', f.info.cell, f.info.assumed === 'shaded' ? SHADED : LOOP]]
        : [['e', f.info.edge, f.info.assumed === 'on' ? E_ON : E_OFF]];
      lookahead.push({ rule: id, info: f.info, cost: f.cost, concludes: f.sets, assumption, chain: chainOf(P, st, assumption) });
    }
  }
  lookahead.sort((a, b) => a.cost - b.cost);
  return {
    name, source, rows: P.rows, cols: P.cols, clues: P.clues, boxes: P.boxIdx,
    cell: Array.from(st.cell), e: Array.from(st.e), undecided: undecidedOf(P, st),
    solCell: Array.from(sol.cell), solE: Array.from(sol.e), lookahead: lookahead.slice(0, 4), stepsBeforeStuck: r.steps,
  };
}

const cases = [];
// 1. puzzles that are already stuck
const files = [path.join(root, 'data/tmp.csv'), ...fs.readdirSync(path.join(root, 'data')).filter((f) => f.endsWith('.csv') && f !== 'tmp.csv').map((f) => path.join(root, 'data', f))];
for (const f of scan ? sources.map((q) => path.join(root, q)) : noExisting ? [] : files) for (const p of parseCsv(fs.readFileSync(f, 'utf8')).filter((q) => q.rows * q.cols >= minCells && q.rows * q.cols <= maxCells)) {
  const rep = reportOf(p.name, path.relative(root, f), p);
  if (rep) cases.push(rep);
}
console.log(`${cases.length} puzzle(s) already stuck`);

// 2. derive near-stuck positions by removing clues while the puzzle stays unique
const pool = [];
const seenStuck = new Set();
for (const s of sources) { const f = path.join(root, s); if (fs.existsSync(f)) pool.push(...parseCsv(fs.readFileSync(f, 'utf8')).filter((p) => p.rows * p.cols >= minCells && p.rows * p.cols <= maxCells)); }
let attempts = 0;
while (cases.filter((c) => c.source === 'derived').length < derive && attempts < derive * 40 && pool.length && Date.now() - t0 < minutes * 60000) {
  attempts++;
  const base = pool[(rng() * pool.length) | 0];
  let cur = { ...base, clues: base.clues.map((c) => ({ ...c })) };
  const order = cur.clues.map((_, k) => k).sort(() => rng() - 0.5);
  let removed = 0;
  for (const k of order) {
    const cl = base.clues[k];
    const idx = cur.clues.findIndex((c) => c.r === cl.r && c.c === cl.c);
    if (idx < 0) continue;
    // the removed clue's cell becomes a box in the solution (it was not on the loop); it may not touch another box
    const P0 = compile({ ...cur, clues: cur.clues.map((c) => ({ ...c })) });
    const sol0 = decodeSolution(P0, cur.solution);
    const i = cl.r * P0.cols + cl.c;
    let touches = false;
    for (let d = 0; d < 4; d++) { const j = P0.nb[i * 4 + d]; if (j >= 0 && sol0.cell[j] === SHADED) touches = true; }
    if (touches) continue;
    const next = { ...cur, clues: cur.clues.filter((_, q) => q !== idx) };
    const chars = [...cur.solution]; chars[i] = 'x'; next.solution = chars.join('');
    const Q = compile({ ...next, clues: next.clues.map((c) => ({ ...c })) });
    // the new box also counts for any clue whose line it lies in, so the stored solution may no longer be a solution: skip those
    const solQ = decodeSolution(Q, next.solution);
    if (!checkSolved(Q, Uint8Array.from(solQ.cell, (v) => (v === SHADED ? 1 : 0)), Int8Array.from(solQ.e, (v) => (v === E_ON ? 1 : 0)))) continue;
    const rr = solvedByRules(Q);
    if (rr.solved) { cur = next; removed++; continue; }          // still solved by the plain rules: unique by soundness; keep removing
    const rh = solvedByHumanRules(Q);                              // what a person can do, using the one-solution rules too
    const und = undecidedOf(Q, rh.state).length;
    if (!rh.solved && und > maxUnd) continue;                      // too stuck to be an instructive case: try another clue (cheap test first)
    const u = solve(Q, { limit: 2, state: rr.state, maxNodes: 200000 });   // from the plain rules' position this is nearly instant
    if (u.exceeded || u.count !== 1) continue;                     // not unique: not a valid puzzle
    if (rh.solved) { cur = next; removed++; continue; }            // the one-solution rules finish it: not stuck yet, keep removing
    cur = next; removed++;
    // the stronger the rules, the more often several removals end at the same stuck position of the same puzzle: report it once
    const key = `${base.name}:${undecidedOf(Q, rh.state).join(',')}`;
    if (seenStuck.has(key)) break;
    seenStuck.add(key);
    const rep = reportOf(`derived-${String(cases.length + 1).padStart(2, '0')}`, 'derived', cur);
    if (rep) { rep.derivedFrom = base.name; rep.cluesRemoved = removed; cases.push(rep); fs.writeFileSync(path.join(outDir, 'json', `${rep.name}.json`), JSON.stringify(rep)); console.log(`  found ${rep.name}: ${rep.undecided.length} open cells, from ${base.name} (${removed} clue(s) removed), ${Math.round((Date.now() - t0) / 1000)} s`); }
    break;
  }
}
console.log(`${cases.filter((c) => c.source === 'derived').length} derived case(s) after ${attempts} attempts`);

for (const c of cases) fs.writeFileSync(path.join(outDir, 'json', `${c.name}.json`), JSON.stringify(c));
console.log(`wrote ${cases.length} case(s) to ${path.join(outDir, 'json')}`);
