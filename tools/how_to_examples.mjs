// Find one worked example for every rule the Hint button can show, for docs/how_to_solve.md and the hidden "armory" book.
//
// An example is a position a player reaches by pressing Hint and marking what it says, again and again, from the empty board (just
// what js/main.js does: the solver position is rebuilt from the marks, nextMarkableStep picks the step, the player marks its first
// firing). The first time a rule is the one shown, that position is the example, and the Hint button there shows that rule. Pressing
// Hint all the way through the puzzle therefore always reaches it.
//
//   node tools/how_to_examples.mjs scan [--max-cells 144] [--jobs 8] [--dir data|tools/library] [--merge]
//                                                                       replay every puzzle in the directory's CSVs, keep the best few per
//                                                                       rule (writes docs/examples/candidates.json; --merge adds to it)
//   node tools/how_to_examples.mjs build                                pick one example per rule from the candidates: writes
//                                                                       data/armory.csv, docs/examples/examples.json and the manifest entry
//
// Then tools/capture_how_to_images.py takes the screenshots and tools/build_how_to_solve.mjs writes docs/how_to_solve.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { compile, parseCsv, toCsv, initialState, decodeSolution, SHADED, LOOP, E_ON } from '../js/logic.js';
import { RULES, rate } from '../js/rating.js';
import { nextMarkableStep } from '../js/hintstep.js';
import { explainStep } from '../js/explain.js';

const root = new URL('..', import.meta.url).pathname;
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const KEEP = 6;                                       // candidates kept per rule

/** The solver position for a set of marks (cells: 0 blank, 1 box, 2 dot; edges: 0/1), as main.js's solverState builds it. */
function positionOf(P, cells, edges) {
  const st = initialState(P);
  for (let i = 0; i < P.N; i++) {
    if (P.clueAt[i] >= 0) continue;
    if (cells[i] === 1) st.cell[i] = SHADED; else if (cells[i] === 2) st.cell[i] = LOOP;
  }
  for (let x = 0; x < P.numEdges; x++) if (edges[x]) st.e[x] = E_ON;
  return st;
}

/** Press Hint and mark the first firing until the solver has nothing more to say. Returns the steps shown, or null if it never finishes. */
export function replay(P) {
  const cells = new Uint8Array(P.N), edges = new Uint8Array(P.numEdges);
  for (const i of P.boxIdx) cells[i] = 1;
  const steps = [];
  for (let n = 0; n < 600; n++) {
    const st = positionOf(P, cells, edges);
    const next = nextMarkableStep(P, st);
    if (!next) break;
    const f = next.res.firings[0];
    steps.push({ rule: next.res.rule, weight: next.res.weight, firings: next.res.firings.length, cells: Array.from(cells).join(''), edges: Array.from(edges).join(''), at: steps.length });
    for (const [kind, idx, v] of f.sets) {
      if (kind === 'c') cells[idx] = v === SHADED ? 1 : 2;
      else if (v === E_ON) edges[idx] = 1;
    }
  }
  const sol = P.solution && decodeSolution(P, P.solution);
  if (!sol) return null;
  for (let i = 0; i < P.N; i++) {
    if (P.clueAt[i] >= 0) continue;
    if ((cells[i] === 1) !== (sol.cell[i] === SHADED)) return null;       // not finished: the solver got stuck
  }
  return steps;
}

// ------------------------------------------------------------ scan

if (process.argv[2] === 'scan-file') {
  const [file, out, maxCells] = process.argv.slice(3);
  const found = {};
  for (const p of parseCsv(fs.readFileSync(file, 'utf8'))) {
    if (p.rows * p.cols > +maxCells) continue;
    const P = compile(p);
    const steps = replay(P);
    if (!steps) continue;
    const hardest = Math.max(...steps.map((s) => s.weight));
    const seen = new Set();
    for (const s of steps) {
      if (seen.has(s.rule)) continue;
      seen.add(s.rule);
      (found[s.rule] ||= []).push({ file: path.relative(root, file), name: p.name, rows: p.rows, cols: p.cols, regional: !!(p.regions && p.regions.length), at: s.at, total: steps.length, firings: s.firings, hardest, weight: s.weight, cells: s.cells, edges: s.edges });
    }
  }
  fs.writeFileSync(out, JSON.stringify(found));
  process.exit(0);
}

// better = an ordinary board (unless the rule is about regions), then the fewest hints before it (a reader who opens the puzzle has to
// play them), then a puzzle whose hardest step is this rule, then the smaller board
const REGION_RULES = new Set(['colorBalance', 'regionPairs']);
const better = (rule) => (a, b) => {
  const wantRegional = REGION_RULES.has(rule);
  if (a.regional !== b.regional) return a.regional === wantRegional ? -1 : 1;
  if (a.at !== b.at) return a.at - b.at;
  if ((a.hardest === a.weight) !== (b.hardest === b.weight)) return a.hardest === a.weight ? -1 : 1;
  return a.rows * a.cols - b.rows * b.cols || a.name.localeCompare(b.name);
};

async function scan() {
  const maxCells = arg('max-cells', '144'), jobs = +arg('jobs', Math.max(2, os.cpus().length - 1));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yj-examples-'));
  const dir = arg('dir', 'data');                    // data (the books) or tools/library (the pools they were picked from: more kinds of puzzle)
  const files = fs.readdirSync(root + dir).filter((f) => f.endsWith('.csv') && f !== 'armory.csv').map((f) => root + dir + '/' + f);
  const outs = [];
  let next = 0, running = 0;
  await new Promise((resolve) => {
    const launch = () => {
      while (running < jobs && next < files.length) {
        const f = files[next++], out = path.join(tmp, `${next}.json`);
        outs.push(out); running++;
        fork(new URL(import.meta.url).pathname, ['scan-file', f, out, maxCells], { stdio: 'inherit' }).on('exit', () => { running--; console.log(`  ${path.basename(f)} done`); launch(); if (!running && next >= files.length) resolve(); });
      }
    };
    launch();
  });
  const all = process.argv.includes('--merge') ? JSON.parse(fs.readFileSync(root + 'docs/examples/candidates.json', 'utf8')) : {};
  for (const o of outs) for (const [rule, list] of Object.entries(JSON.parse(fs.readFileSync(o, 'utf8')))) (all[rule] ||= []).push(...list);
  for (const rule of Object.keys(all)) all[rule] = all[rule].sort(better(rule)).slice(0, KEEP);
  fs.mkdirSync(root + 'docs/examples', { recursive: true });
  fs.writeFileSync(root + 'docs/examples/candidates.json', JSON.stringify(all));
  const missing = RULES.filter((r) => !r.free && !all[r.id]).map((r) => r.id);
  console.log(`candidates for ${Object.keys(all).length} rules; none found for: ${missing.join(', ') || '(none)'}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------------------ build

function build() {
  const cand = JSON.parse(fs.readFileSync(root + 'docs/examples/candidates.json', 'utf8'));
  const books = {};
  const bookOf = (f) => books[f] ||= parseCsv(fs.readFileSync(root + f, 'utf8'));
  const chosen = [], puzzles = [], examples = [];
  for (const rule of RULES) {
    if (rule.free || !cand[rule.id]) continue;
    const c = cand[rule.id][+arg('rank', '0')];
    const raw = bookOf(c.file).find((p) => p.name === c.name);
    const P = compile(raw);
    const have = puzzles.findIndex((p) => p.name === raw.name);
    const num = have >= 0 ? have + 1 : puzzles.push(raw);
    // what the Hint button says in that position
    const cells = Uint8Array.from(c.cells, Number), edges = Uint8Array.from(c.edges, Number);
    const st = positionOf(P, cells, edges);
    const nx = nextMarkableStep(P, st);
    const f = nx.res.firings[0];
    const e = explainStep(P, { rule: nx.res.rule, tier: nx.res.tier, weight: nx.res.weight, sets: f.sets, info: f.info }, st);
    if (nx.res.rule !== rule.id) throw new Error(`${rule.id}: replay position shows ${nx.res.rule}`);
    examples.push({ rule: rule.id, tier: rule.tier, weight: rule.weight, puzzle: num, name: raw.name, rows: raw.rows, cols: raw.cols, hints: c.at, firings: c.firings, hardest: c.hardest === c.weight, cells: c.cells, edges: c.edges, text: e.text });
    chosen.push(rule.id);
  }
  for (const p of puzzles) { const r = rate(compile(p)); p.rules = r.rules; p.tier = r.tier; p.score = r.score; }       // (the pools these came from were not rescored)
  fs.writeFileSync(root + 'data/armory.csv', toCsv(puzzles));
  fs.writeFileSync(root + 'docs/examples/examples.json', JSON.stringify(examples, null, 1) + '\n');
  const mpath = root + 'data/manifest.json', manifest = JSON.parse(fs.readFileSync(mpath, 'utf8'));
  manifest.books = manifest.books.filter((b) => b.id !== 'armory');
  manifest.books.push({ id: 'armory', name: 'Armory', file: 'data/armory.csv', count: puzzles.length, hidden: true, blurb: 'The worked examples of docs/how_to_solve.md (not listed in the app).' });
  fs.writeFileSync(mpath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${examples.length} examples from ${puzzles.length} puzzles: ${chosen.join(' ')}`);
}

if (process.argv[2] === 'scan') await scan();
else if (process.argv[2] === 'build') build();
else if (process.argv[2] !== 'scan-file') console.log('usage: node tools/how_to_examples.mjs scan | build');
