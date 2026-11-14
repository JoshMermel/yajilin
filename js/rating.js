// Rates yajilin puzzles by the deduction rules a human needs to solve them. The same rule table will drive the
// Hint button, so ratings, hints and docs cannot drift apart (see README, "Difficulty").
//
// The solver always applies the easiest applicable rule and never looks at the stored solution. A puzzle's `rules`
// value is the hardest rule it needed ('unsolved' if the rules got stuck); its `tier` is that rule's tier and its
// `score` the weighted sum of every step taken (plus a penalty per cell left undetermined).
//
// Rules, easiest first (cells are "loop" = on the loop, "shaded"; an "exit" of a cell is a neighbour it could connect to):
//   clueDone         a clue already has all its shaded cells: the rest of its row/column is loop
//   clueFull         a clue needs exactly as many shaded cells as it has open cells left: shade them all
//   shadedNeighbor   a cell next to a shaded cell is loop (shaded cells never touch)
//   deadEnd          a cell with fewer than two exits cannot be on the loop: it is shaded
//   forcedExits      a loop cell with exactly two exits left uses both
//   deadEndNeighbor  shading a cell would leave a neighbour with fewer than two exits: the cell is loop
//   clueCapacity     a clue needs as many shaded cells as the open stretches of its ray can hold at most
//                    (every other cell in each odd-length stretch): shade those, the cells between are loop
//   noEarlyClose     a segment joining the two ends of one path would close the loop while other loop cells are
//                    outside it: no segment there
//   tryCell          assume a cell is shaded (or loop), follow the consequences with the rules above, and meet
//                    a contradiction: it is the other
//   tryEdge          the same for a segment (on / off)
// Bookkeeping that is not counted as a step (weight 0): a segment touching a shaded cell is off, a segment makes its
// two cells loop, a loop cell with two segments has no others.
import {
  UNKNOWN, SHADED, LOOP, CLUE, E_UNKNOWN, E_ON, E_OFF,
  initialState, cloneState, edgeCells, checkSolved,
} from './logic.js';

export const TIERS = ['Beginner', 'Medium', 'Hard', 'Expert'];

export const TIER_INFO = {
  Beginner: { name: 'Beginner', blurb: 'clues that are already full or must be filled, dead ends and cells next to shaded cells' },
  Medium: { name: 'Medium', blurb: 'needs a clue that exactly fills the room it has, or spotting a segment that would close the loop too early' },
  Hard: { name: 'Hard', blurb: 'needs trying one cell or segment and following what it forces until something breaks' },
  Expert: { name: 'Expert', blurb: "the hint rules can't finish it: somewhere you have to look further ahead than Hint can explain" },
};

export const beyondHints = (puzzle) => puzzle.rules === 'unsolved';

export const UNDETERMINED_WEIGHT = 10; // per cell the rules leave undecided

// ------------------------------------------------------------ helpers

/** Number of exits of cell i: neighbours it could connect to (not off, not shaded). `ignore` is treated as shaded. */
function exits(P, st, i, ignore = -1) {
  let n = 0;
  for (let d = 0; d < 4; d++) {
    const x = P.ed[i * 4 + d];
    if (x < 0) continue;
    const j = P.nb[i * 4 + d];
    if (j === ignore || st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
    n++;
  }
  return n;
}

function onCount(P, st, i) {
  let n = 0;
  for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_ON) n++; }
  return n;
}

/** Union-find over segments that are on. Returns { find, hasCycle, cycleRoot }. */
function components(P, st) {
  const parent = new Int16Array(P.N);
  for (let i = 0; i < P.N; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  let cycleRoot = -1;
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_ON) continue;
    const [a, b] = edgeCells(P, x);
    const ra = find(a), rb = find(b);
    if (ra === rb) cycleRoot = ra; else parent[ra] = rb;
  }
  return { find, cycleRoot: cycleRoot >= 0 ? find(cycleRoot) : -1 };
}

/** Apply [['c'|'e', index, value], ...]. Returns false if one disagrees with what is already known. */
function applySets(st, sets) {
  for (const [kind, idx, v] of sets) {
    const arr = kind === 'c' ? st.cell : st.e;
    if (arr[idx] === v) continue;
    if (arr[idx] !== 0) return false;
    arr[idx] = v;
  }
  return true;
}

/** Is the position impossible? (Used by the lookahead rules.) */
export function contradiction(P, st) {
  const { N, nb } = P;
  for (let i = 0; i < N; i++) {
    const s = st.cell[i];
    if (s === CLUE) continue;
    if (s === SHADED) {
      for (let d = 0; d < 4; d++) {
        const j = nb[i * 4 + d];
        if (j >= 0 && st.cell[j] === SHADED) return true;
        const x = P.ed[i * 4 + d];
        if (x >= 0 && st.e[x] === E_ON) return true;
      }
      continue;
    }
    const on = onCount(P, st, i);
    if (on > 2) return true;
    if ((s === LOOP || on > 0) && exits(P, st, i) < 2) return true;
  }
  for (let k = 0; k < P.clues.length; k++) {
    let s = 0, u = 0;
    for (const i of P.rays[k]) { if (st.cell[i] === SHADED) s++; else if (st.cell[i] === UNKNOWN) u++; }
    if (s > P.clues[k].n || s + u < P.clues[k].n) return true;
  }
  const { find, cycleRoot } = components(P, st);
  if (cycleRoot >= 0) {
    // a closed loop is only allowed if nothing else is on the loop
    for (let i = 0; i < N; i++) if (st.cell[i] === LOOP && find(i) !== cycleRoot) return true;
  }
  return false;
}

/** Does edge index x join two real, non-clue cells? (Edge indexes also cover off-board "edges" past the last column/row.) */
function validEdge(P, x) {
  const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
  if (b >= P.N || (!(x & 1) && b % P.cols === 0)) return false;
  return P.clueAt[a] < 0 && P.clueAt[b] < 0;
}

const firing = (sets, info) => ({ sets, info });
const setCell = (i, v) => ['c', i, v];
const setEdge = (x, v) => ['e', x, v];

// ------------------------------------------------------------ the rules (each returns every firing it finds)

function bookkeepingShadedEdges(P, st) {
  const sets = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== SHADED) continue;
    for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_UNKNOWN) sets.push(setEdge(x, E_OFF)); }
  }
  return sets.length ? [firing(sets, {})] : [];
}

function bookkeepingEdgeEnds(P, st) {
  const sets = [];
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_ON) continue;
    for (const c of edgeCells(P, x)) if (st.cell[c] === UNKNOWN) sets.push(setCell(c, LOOP));
  }
  return sets.length ? [firing(sets, {})] : [];
}

function bookkeepingFullCells(P, st) {
  const sets = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] === CLUE || st.cell[i] === SHADED || onCount(P, st, i) !== 2) continue;
    for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_UNKNOWN) sets.push(setEdge(x, E_OFF)); }
  }
  return sets.length ? [firing(sets, {})] : [];
}

function clueCounts(P, st, k) {
  let s = 0; const unk = [];
  for (const i of P.rays[k]) { if (st.cell[i] === SHADED) s++; else if (st.cell[i] === UNKNOWN) unk.push(i); }
  return { s, unk };
}

function clueDone(P, st) {
  const out = [];
  P.clues.forEach((cl, k) => {
    const { s, unk } = clueCounts(P, st, k);
    if (s === cl.n && unk.length) out.push(firing(unk.map((i) => setCell(i, LOOP)), { clue: k, cells: unk }));
  });
  return out;
}

function clueFull(P, st) {
  const out = [];
  P.clues.forEach((cl, k) => {
    const { s, unk } = clueCounts(P, st, k);
    if (unk.length && cl.n - s === unk.length) out.push(firing(unk.map((i) => setCell(i, SHADED)), { clue: k, cells: unk }));
  });
  return out;
}

function shadedNeighbor(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== SHADED) continue;
    const sets = [];
    for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && st.cell[j] === UNKNOWN) sets.push(setCell(j, LOOP)); }
    if (sets.length) out.push(firing(sets, { cell: i }));
  }
  return out;
}

function deadEnd(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] === UNKNOWN && exits(P, st, i) < 2) out.push(firing([setCell(i, SHADED)], { cell: i }));
  }
  return out;
}

function forcedExits(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== LOOP || exits(P, st, i) !== 2) continue;
    const sets = [];
    for (let d = 0; d < 4; d++) {
      const x = P.ed[i * 4 + d];
      if (x < 0 || st.e[x] !== E_UNKNOWN || st.cell[P.nb[i * 4 + d]] === SHADED) continue;
      sets.push(setEdge(x, E_ON));
    }
    if (sets.length) out.push(firing(sets, { cell: i }));
  }
  return out;
}

function deadEndNeighbor(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    for (let d = 0; d < 4; d++) {
      const n = P.nb[i * 4 + d];
      if (n < 0 || st.cell[n] === SHADED) continue;
      if (exits(P, st, n, i) < 2) { out.push(firing([setCell(i, LOOP)], { cell: i, neighbor: n })); break; }
    }
  }
  return out;
}

function clueCapacity(P, st) {
  const out = [];
  P.clues.forEach((cl, k) => {
    const ray = P.rays[k];
    let s = 0;
    for (const i of ray) if (st.cell[i] === SHADED) s++;
    const need = cl.n - s;
    if (need <= 0) return;
    const step = cl.d === 1 || cl.d === 3 ? 1 : P.cols;
    const runs = [];
    let run = [];
    for (const i of ray) {
      if (st.cell[i] === UNKNOWN && (run.length === 0 || Math.abs(i - run[run.length - 1]) === step)) run.push(i);
      else { if (run.length) runs.push(run); run = st.cell[i] === UNKNOWN ? [i] : []; }
    }
    if (run.length) runs.push(run);
    const cap = runs.reduce((a, r) => a + Math.ceil(r.length / 2), 0);
    if (cap !== need) return;
    const sets = [];
    for (const r of runs) {
      if (r.length % 2 === 0) continue; // an even stretch can be packed in several ways
      r.forEach((i, p) => sets.push(setCell(i, p % 2 === 0 ? SHADED : LOOP)));
    }
    if (sets.length) out.push(firing(sets, { clue: k, runs }));
  });
  return out;
}

function noEarlyClose(P, st) {
  const { find } = components(P, st);
  const loopRoots = new Set();
  let loopCells = 0;
  for (let i = 0; i < P.N; i++) if (st.cell[i] === LOOP) { loopCells++; loopRoots.add(find(i)); }
  if (loopRoots.size < 2) return []; // closing is fine only if everything known is on this one path
  const out = [];
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const [a, b] = edgeCells(P, x);
    if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
    if (find(a) === find(b)) out.push(firing([setEdge(x, E_OFF)], { edge: x }));
  }
  return out;
}

/** Try each undecided cell / segment both ways with the rules below this one; a contradiction decides it. */
function lookahead(kind) {
  return (P, st, ctx) => {
    const out = [];
    const upto = ctx.upto;
    const attempt = (set, other, info) => {
      const st2 = cloneState(st);
      applySets(st2, set);
      const r = closure(P, st2, upto);
      if (r.contradiction) out.push({ ...firing(other, info), cost: r.steps });
    };
    if (kind === 'cell') {
      for (let i = 0; i < P.N; i++) {
        if (st.cell[i] !== UNKNOWN) continue;
        attempt([setCell(i, SHADED)], [setCell(i, LOOP)], { cell: i, assumed: 'shaded' });
        attempt([setCell(i, LOOP)], [setCell(i, SHADED)], { cell: i, assumed: 'loop' });
      }
    } else {
      for (let x = 0; x < P.numEdges; x++) {
        if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
        const [a, b] = edgeCells(P, x);
        if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
        attempt([setEdge(x, E_ON)], [setEdge(x, E_OFF)], { edge: x, assumed: 'on' });
        attempt([setEdge(x, E_OFF)], [setEdge(x, E_ON)], { edge: x, assumed: 'off' });
      }
    }
    out.sort((p, q) => p.cost - q.cost);
    return out;
  };
}

// The rule table. THIS is where rules are binned into tiers and given weights: re-bin a rule by changing its tier
// here (and rescoring), change a weight by editing it. Listed easiest first; the solver tries them in this order.
export const RULES = [
  { id: 'edgesOffShaded', tier: 'Beginner', weight: 0, free: true, find: bookkeepingShadedEdges, label: 'segments touching a shaded cell are off' },
  { id: 'edgeEnds', tier: 'Beginner', weight: 0, free: true, find: bookkeepingEdgeEnds, label: 'a segment makes both its cells loop cells' },
  { id: 'fullCells', tier: 'Beginner', weight: 0, free: true, find: bookkeepingFullCells, label: 'a loop cell with two segments has no others' },
  { id: 'clueDone', tier: 'Beginner', weight: 1, find: clueDone, label: 'a clue has all its shaded cells: the rest of its line is loop' },
  { id: 'clueFull', tier: 'Beginner', weight: 1, find: clueFull, label: 'a clue needs every open cell left in its line: shade them' },
  { id: 'shadedNeighbor', tier: 'Beginner', weight: 1, find: shadedNeighbor, label: 'cells next to a shaded cell are loop' },
  { id: 'deadEnd', tier: 'Beginner', weight: 2, find: deadEnd, label: 'a cell with fewer than two exits is shaded' },
  { id: 'forcedExits', tier: 'Beginner', weight: 0.3, find: forcedExits, label: 'a loop cell with two exits left uses both' },
  { id: 'deadEndNeighbor', tier: 'Beginner', weight: 2, find: deadEndNeighbor, label: 'shading this cell would strand a neighbour: it is loop' },
  { id: 'clueCapacity', tier: 'Medium', weight: 4, find: clueCapacity, label: 'a clue needs as many shaded cells as its line can hold' },
  { id: 'noEarlyClose', tier: 'Medium', weight: 3, find: noEarlyClose, label: 'a segment would close the loop too early' },
  { id: 'tryCell', tier: 'Hard', weight: 12, lookahead: true, find: lookahead('cell'), label: 'trying a cell one way leads to a contradiction' },
  { id: 'tryEdge', tier: 'Hard', weight: 14, lookahead: true, find: lookahead('edge'), label: 'trying a segment one way leads to a contradiction' },
];

const FIRST_LOOKAHEAD = RULES.findIndex((r) => r.lookahead);
export const RULE_IDS = RULES.map((r) => r.id);
export const tierOfRule = (id) => (id === 'unsolved' ? 'Expert' : RULES.find((r) => r.id === id).tier);
export const ruleLabel = (id) => (id === 'unsolved' ? 'none of the current rules finishes it' : RULES.find((r) => r.id === id).label);

/**
 * Apply every rule below index `upto` until nothing changes or a contradiction appears (the engine inside the
 * lookahead rules: "follow what it forces"). Mutates `st`. Returns { contradiction, steps }.
 */
export function closure(P, st, upto = FIRST_LOOKAHEAD) {
  let steps = 0;
  for (let guard = 0; guard < 5000; guard++) {
    if (contradiction(P, st)) return { contradiction: true, steps };
    let fired = false;
    for (let r = 0; r < upto; r++) {
      const fs = RULES[r].find(P, st, { upto: r });
      if (!fs.length) continue;
      for (const f of fs) if (!applySets(st, f.sets)) return { contradiction: true, steps };
      steps++; fired = true;
      break;
    }
    if (!fired) return { contradiction: false, steps };
  }
  throw new Error('closure did not settle');
}

/** The easiest deduction available in `st`, or null: { rule, tier, weight, sets, info }. Bookkeeping is applied first. */
export function nextStep(P, st) {
  for (;;) { // bookkeeping first, all of it, silently
    let any = false;
    for (const r of RULES) {
      if (!r.free) continue;
      for (const f of r.find(P, st, {})) { if (applySets(st, f.sets)) any = true; else return null; }
    }
    if (!any) break;
  }
  for (let r = 0; r < RULES.length; r++) {
    const rule = RULES[r];
    if (rule.free) continue;
    const fs = rule.find(P, st, { upto: FIRST_LOOKAHEAD });
    if (fs.length) return { rule: rule.id, tier: rule.tier, weight: rule.weight, sets: fs[0].sets, info: fs[0].info };
  }
  return null;
}

/** Fully decided? Every cell known, every loop cell has two segments. */
function complete(P, st) {
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] === UNKNOWN) return false;
    if (st.cell[i] === LOOP && onCount(P, st, i) !== 2) return false;
  }
  return true;
}

/**
 * Solve like a human. Returns { solved, rules (hardest rule id or 'unsolved'), tier, score, steps, counts, state }.
 * `steps` lists every counted step { rule, tier, weight, sets, info }; `counts` maps rule id -> times used.
 */
export function rate(P) {
  const st = initialState(P);
  const steps = [];
  const counts = {};
  for (let guard = 0; guard < 2000; guard++) {
    if (!contradiction(P, st) && complete(P, st)) break;
    const step = nextStep(P, st);
    if (!step) break;
    if (!applySets(st, step.sets)) break;
    steps.push(step);
    counts[step.rule] = (counts[step.rule] || 0) + 1;
  }
  // run the bookkeeping one last time so the final state is tidy
  nextStep(P, st);
  const shaded = Uint8Array.from(st.cell, (v) => (v === SHADED ? 1 : 0));
  const edges = Int8Array.from(st.e, (v) => (v === E_ON ? 1 : 0));
  const solved = complete(P, st) && checkSolved(P, shaded, edges);
  let hardest = 'unsolved';
  if (solved) {
    hardest = steps.length ? steps.reduce((best, s) => (RULE_IDS.indexOf(s.rule) > RULE_IDS.indexOf(best) ? s.rule : best), steps[0].rule) : 'clueDone';
  }
  let unknown = 0;
  for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) unknown++;
  const score = Math.round((steps.reduce((a, s) => a + s.weight, 0) + (solved ? 0 : unknown * UNDETERMINED_WEIGHT)) * 10) / 10;
  return { solved, rules: hardest, tier: tierOfRule(hardest), score, steps, counts, state: st };
}

/** Rate a CSV-style puzzle object in place (rules, tier, score), as the library tools do. */
export function ratePuzzle(P) {
  const r = rate(P);
  P.rules = r.rules; P.tier = r.tier; P.score = r.score;
  return r;
}

export const compareRatings = (a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || a.score - b.score;
