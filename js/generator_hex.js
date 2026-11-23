// Hex puzzle generator (spike). Solver-guided, not rule-guided: the human-style rules in rating.js are square-specific, so uniqueness is decided by
// the exhaustive solver (logic.js solve) and "how hard" is measured by how much of the board plain propagation settles.
//
//   1. findHoles: pick the cells that are not on the loop (an independent set: shaded cells never touch) so that exactly one loop runs through the
//      other cells. Start with no holes (a loop through the whole board always exists) and add holes, keeping at least one loop, until it is unique.
//      This is the necessary condition from the square generator: clues decide which holes are boxes, never how the loop routes.
//   2. Aim arrows at it: turn holes into arrow cells (a direction and the number of boxes along that line), most useful first, until the puzzle
//      (arrows + boxes + loop) has exactly one solution.
//   3. Prune: turn arrows back into boxes while the solution stays unique.
import { compile, initialState, cloneState, propagate, solve, encodeSolution, SHADED, LOOP, UNKNOWN, E_UNKNOWN, E_ON, E_OFF, hexStep } from './logic.js';

const shuffle = (arr, rng) => { for (let i = arr.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

/** Neighbour lists of the cells of a rows x cols hex board. */
export function hexAdjacency(rows, cols) {
  const adj = [];
  for (let i = 0; i < rows * cols; i++) {
    const out = [];
    for (let d = 0; d < 6; d++) {
      const [r, c] = hexStep((i / cols) | 0, i % cols, d);
      if (r >= 0 && c >= 0 && r < rows && c < cols) out.push(r * cols + c);
    }
    adj.push(out);
  }
  return adj;
}

/** How many loops (up to `limit`) run through exactly the cells that are not holes? */
export function loopCount(rows, cols, holes, { limit = 2, maxNodes = 200000 } = {}) {
  const clues = [...holes].map((i) => ({ r: (i / cols) | 0, c: i % cols, d: 0, n: -1 }));
  const P = compile({ name: 'loop', grid: 'hex', rows, cols, clues });
  const st = initialState(P);
  for (let i = 0; i < rows * cols; i++) if (!holes.has(i)) st.cell[i] = LOOP;
  return solve(P, { limit, maxNodes, state: st });
}

/**
 * A set of holes (no two touching) with exactly one loop through the other cells, or null.
 *
 * A greedy climb (add holes while a loop still exists) gets stuck: on a hex board most hole sets have no loop at all (a cell with six neighbours
 * has plenty of room, but each hole takes edges away unevenly), the sets that keep a loop usually keep several, and a maximal set cannot take
 * another hole. So this is a plateau search over hole sets: add, remove or move a hole, count the loops (capped), and accept a move that keeps at
 * least one loop and does not raise the count (rarely, one that does). It stops at the first set with exactly one loop and enough holes
 * (`minHoleShare` of the cells; fewer holes make a puzzle with hardly any boxes).
 */
export function findHoles(rows, cols, rng, { maxNodes = 100000, deadline = Infinity, minHoleShare = 0.2, cap = 20 } = {}) {
  const N = rows * cols, adj = hexAdjacency(rows, cols);
  const holes = new Set();
  const count = () => { const r = loopCount(rows, cols, holes, { limit: cap, maxNodes }); return r.exceeded ? cap + 1 : r.count; };     // 0: no loop
  let cur = count();
  while (Date.now() < deadline) {
    if (cur === 1 && holes.size >= minHoleShare * N) return holes;
    const move = rng(), g = (rng() * N) | 0;
    let removed = -1, added = -1;
    if (move < 0.45) { if (holes.has(g) || adj[g].some((j) => holes.has(j))) continue; added = g; }              // add a hole
    else if (move < 0.55) { if (!holes.has(g)) continue; removed = g; }                                          // remove one
    else {                                                                                                       // move one to another cell
      const to = (rng() * N) | 0;
      if (!holes.has(g) || holes.has(to)) continue;
      removed = g; added = to;
    }
    if (removed >= 0) holes.delete(removed);
    if (added >= 0 && adj[added].some((j) => holes.has(j))) { if (removed >= 0) holes.add(removed); continue; }
    if (added >= 0) holes.add(added);
    const c = count();
    if (c >= 1 && (c <= cur || rng() < 0.05)) cur = c;
    else { if (added >= 0) holes.delete(added); if (removed >= 0) holes.add(removed); }
  }
  return null;
}

/** The puzzle with arrow cells `arrows` (Map cell -> direction); every other hole is a box the solver has to find. */
export function hexPuzzle(rows, cols, holes, arrows, name = 'hex') {
  const clues = [];
  for (const [i, d] of arrows) {
    let [r, c] = hexStep((i / cols) | 0, i % cols, d), n = 0;
    while (r >= 0 && c >= 0 && r < rows && c < cols) { const j = r * cols + c; if (holes.has(j) && !arrows.has(j)) n++; [r, c] = hexStep(r, c, d); }
    clues.push({ r: (i / cols) | 0, c: i % cols, d, n });
  }
  return compile({ name, grid: 'hex', rows, cols, clues });
}

/** How much plain propagation leaves open: unknown cells (0 means the puzzle falls to the machine's one-step deductions alone). */
export function undecided(P) {
  const st = initialState(P);
  if (!propagate(P, st)) return Infinity;
  let u = 0;
  for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) u++;
  return u;
}

/** Is every cell decided, and every loop segment? (after propagation: the position is the solution) */
function isComplete(P, st) {
  for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) return false;
  for (let x = 0; x < P.numEdges; x++) {
    const a = P.edgeA[x];
    if (a >= 0 && st.e[x] === E_UNKNOWN && st.cell[a] !== SHADED && st.cell[a] !== 3 && st.cell[P.edgeB[x]] !== SHADED && st.cell[P.edgeB[x]] !== 3) return false;
  }
  return st.cycle;
}

/**
 * Does a one-step lookahead solve the puzzle? Propagate; then for every undecided cell and segment try each value, propagate, and if one value
 * contradicts take the other; repeat until nothing changes. This is the machine's stand-in for a person's "imagine a box or a dot here" (the
 * contradiction found is a sound deduction, so a puzzle solved this way has exactly one solution and no exhaustive search is involved).
 * Returns 0 if propagation alone solves it, 1 if lookahead was needed, -1 if it is stuck.
 */
export const probeLevel = (P) => probe(P).level;

/** probeLevel, and how many lookahead deductions it took (a measure of how hard the puzzle is to a person: 0 for a puzzle propagation settles). */
export function probe(P) {
  let steps = 0;
  const level = (() => {
  const st = initialState(P);
  if (!propagate(P, st)) return -1;
  if (isComplete(P, st)) return 0;
  for (let progress = true; progress;) {
    progress = false;
    const tryValue = (set, undo) => {                                  // true if `set` (applied to a copy) contradicts
      const t = cloneState(st);
      set(t);
      return !propagate(P, t);
    };
    for (let i = 0; i < P.N; i++) {
      if (st.cell[i] !== UNKNOWN) continue;
      const shadedBad = tryValue((t) => { t.cell[i] = SHADED; });
      const loopBad = tryValue((t) => { t.cell[i] = LOOP; });
      if (shadedBad && loopBad) return -1;
      if (shadedBad || loopBad) { st.cell[i] = shadedBad ? LOOP : SHADED; steps++; if (!propagate(P, st)) return -1; progress = true; if (isComplete(P, st)) return 1; }
    }
    for (let x = 0; x < P.numEdges; x++) {
      const a = P.edgeA[x];
      if (a < 0 || st.e[x] !== E_UNKNOWN || P.clueAt[a] >= 0 || P.clueAt[P.edgeB[x]] >= 0 || st.cell[a] === SHADED || st.cell[P.edgeB[x]] === SHADED) continue;
      const onBad = tryValue((t) => { t.e[x] = E_ON; });
      const offBad = tryValue((t) => { t.e[x] = E_OFF; });
      if (onBad && offBad) return -1;
      if (onBad || offBad) { st.e[x] = onBad ? E_OFF : E_ON; steps++; if (!propagate(P, st)) return -1; progress = true; if (isComplete(P, st)) return 1; }
    }
  }
  return isComplete(P, st) ? 1 : -1;
  })();
  return { level, steps };
}

const uniqueSolution = (P, maxNodes) => { const r = solve(P, { limit: 2, maxNodes }); return r.exceeded ? null : r.count === 1 ? r : false; };

/** For each hole, the direction whose line covers the most cells that no earlier arrow's line covers (ties random): n = 0 arrows still pin cells to the loop. */
function coveringDirections(rows, cols, holes, rng) {
  const covered = new Set(), arrows = new Map();
  for (const i of shuffle([...holes], rng)) {
    let best = 0, bestGain = -1;
    for (const d of shuffle([0, 1, 2, 3, 4, 5], rng)) {
      let [r, c] = hexStep((i / cols) | 0, i % cols, d), gain = 0;
      while (r >= 0 && c >= 0 && r < rows && c < cols) { if (!covered.has(r * cols + c)) gain++; [r, c] = hexStep(r, c, d); }
      if (gain > bestGain) { bestGain = gain; best = d; }
    }
    arrows.set(i, best);
    let [r, c] = hexStep((i / cols) | 0, i % cols, best);
    while (r >= 0 && c >= 0 && r < rows && c < cols) { covered.add(r * cols + c); [r, c] = hexStep(r, c, best); }
  }
  return arrows;
}

/**
 * One hex puzzle: { puzzle (compiled), holes, arrows, boxes, stats } or { fail: reason }.
 * Start with every hole an arrow (the most informative puzzle there is: all its numbers are 0), then take arrows away: an arrow whose cell
 * becomes a box the solver must find is dropped when the puzzle stays unique. A check that runs out of nodes counts as "not provably unique"
 * and keeps the arrow. Then `redirect` rounds try another direction for an arrow and see whether that frees a different one.
 * options: maxNodes (per exhaustive check), pruneNodes (the smaller cap used while taking arrows away: a search that big counts as not unique), budgetMs, restarts (tries at a first unique all-arrow puzzle), redirect (rounds).
 */
export function generateHex(rows, cols, rng, { name = 'hex', maxNodes = 100000, budgetMs = 60000, restarts = 30, redirect = 2, minHoleShare = 0.2, pruneNodes = 20000, mode = 'probe' } = {}) {
  const t0 = Date.now(), deadline = t0 + budgetMs;
  const holes = findHoles(rows, cols, rng, { maxNodes, deadline, minHoleShare });
  if (!holes) return { fail: 'time (finding holes)' };
  const tHoles = Date.now() - t0;
  let arrows = null, checks = 0;
  // what a puzzle must pass to keep an arrow away: 'probe' = solvable by propagation and one-step lookahead (what a person can do), 'unique' = just one solution
  const test = mode === 'unique' ? (P) => !!uniqueSolution(P, pruneNodes) : (P) => probeLevel(P) >= 0;
  for (let k = 0; k < restarts && !arrows; k++) {
    const a = coveringDirections(rows, cols, holes, rng);
    if (k > 0) for (const i of a.keys()) if (rng() < 0.2) a.set(i, (rng() * 6) | 0);        // a few random turns away from the greedy cover
    checks++;
    if (test(hexPuzzle(rows, cols, holes, a, name))) arrows = a;
  }
  if (!arrows) return { fail: 'no unique all-arrow puzzle' };
  const arrowsBeforePrune = arrows.size;
  const stillUnique = () => { checks++; return test(hexPuzzle(rows, cols, holes, arrows, name)); };
  const prune = () => {
    let removed = 0;
    for (const i of shuffle([...arrows.keys()], rng)) {
      if (Date.now() > deadline) break;
      const d = arrows.get(i);
      arrows.delete(i);
      if (stillUnique()) removed++; else arrows.set(i, d);
    }
    return removed;
  };
  prune();
  for (let round = 0; round < redirect && Date.now() < deadline; round++) {
    let gained = 0;
    for (const i of shuffle([...arrows.keys()], rng)) {
      if (Date.now() > deadline) break;
      if (!arrows.has(i)) continue;
      const d0 = arrows.get(i);
      let freed = false;
      for (const d of shuffle([0, 1, 2, 3, 4, 5].filter((x) => x !== d0), rng)) {
        arrows.set(i, d);
        if (!stillUnique()) continue;
        // the new direction keeps it unique: does it let another arrow go?
        for (const j of shuffle([...arrows.keys()].filter((x) => x !== i), rng)) {
          const dj = arrows.get(j);
          arrows.delete(j);
          if (stillUnique()) { freed = true; gained++; break; }
          arrows.set(j, dj);
        }
        if (freed) break;
      }
      if (!freed) arrows.set(i, d0);                    // nothing came of it: back to the direction it had
    }
    if (!gained) break;
  }
  const P = hexPuzzle(rows, cols, holes, arrows, name);
  const final = solve(P, { limit: 2, maxNodes });
  if (final.exceeded || final.count !== 1) return { fail: 'final check' };
  P.solution = encodeSolution(P, final.solutions[0]);
  return {
    puzzle: P, holes, arrows,
    stats: {
      level: probe(P).level, steps: probe(P).steps, cells: rows * cols, holes: holes.size, arrows: arrows.size, arrowsBeforePrune, boxes: holes.size - arrows.size, undecided: undecided(P), nodes: final.nodes,
      checks, msHoles: tHoles, msTotal: Date.now() - t0,
    },
  };
}

/** The solution of a generated puzzle as a list of the cells that are boxes (for display). */
export const boxCells = (P) => { const out = []; for (let i = 0; i < P.N; i++) if (P.solution[i] === 'x') out.push(i); return out; };
export { SHADED, E_ON };
