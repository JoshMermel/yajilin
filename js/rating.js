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
//   tightCell        a neighbour has only two cells it can ever connect to (board edge and clue cells around it): the
//                    cell is loop. Instantly visible: corners, clues touching diagonally, a gap between two clues
//   deadEndNeighbor  shading a cell would leave a neighbour with fewer than two exits: the cell is loop
//   cluePlacements   try every way to place a clue's shaded cells without two touching: a cell they all use is shaded,
//                    a cell none uses is loop
//   shadeForcesLines imagine a cell shaded and add the lines that forces (a loop cell with two exits uses both): if that
//                    makes a line end do two incompatible things (a cell gets three lines, or is left with fewer than
//                    two exits), the cell is loop
//   sameSegmentExits a loop cell has three ways out and two of them lead to the two ends of one path: using both would
//                    close the loop early, so it uses the third
//   noEarlyClose     a segment joining the two ends of one path would close the loop while other loop cells are
//                    outside it: no segment there
//   rangeSame        two clues in a line point the same way: the cells between them hold (first - second) shaded cells
//   rangeFacing      two clues point at each other: the room between them, and at each end, bounds how many shaded
//                    cells each part holds
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
    if (sets.length) out.push(firing(sets, { cell: i, on: onCount(P, st, i) }));
  }
  return out;
}

/**
 * The cell has a neighbour that, because of the board's edge and clue cells alone, has only two cells it could ever connect
 * to (a corner, two clues touching at a corner, a gap between two clues). That neighbour is shaded or uses both, so the
 * cell is loop either way. Noticed at a glance, unlike deadEndNeighbor, which depends on the marks.
 */
function tightCell(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    for (let d = 0; d < 4; d++) {
      const n = P.nb[i * 4 + d];
      if (n < 0 || st.cell[n] === SHADED) continue;
      let deg = 0;
      for (let e = 0; e < 4; e++) if (P.nb[n * 4 + e] >= 0) deg++;
      if (deg === 2) { out.push(firing([setCell(i, LOOP)], { cell: i, neighbor: n })); break; }
    }
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

// ---- ranges of cells with a known number of shaded cells

const cellOfClue = (P, cl) => cl.r * P.cols + cl.c;
/** Position of cell i along direction d (grows in the direction the arrow points). */
function posAlong(P, d, i) {
  const r = (i / P.cols) | 0, c = i % P.cols;
  return d === 0 ? -r : d === 1 ? c : d === 2 ? r : -c;
}
const sameLine = (P, d, i, j) => (d === 1 || d === 3 ? ((i / P.cols) | 0) === ((j / P.cols) | 0) : i % P.cols === j % P.cols);
const adjacent = (P, i, j) => (Math.abs(i - j) === 1 && ((i / P.cols) | 0) === ((j / P.cols) | 0)) || Math.abs(i - j) === P.cols;
const touchesShaded = (P, st, i) => { for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && st.cell[j] === SHADED) return true; } return false; };

/** Fewest and most shaded cells a range of collinear cells can end up with, given what is known: [min, max]. */
export function rangeBounds(P, st, cells) {
  let mn = 0, extra = 0, run = 0, prev = -1;
  for (const i of cells) {
    if (st.cell[i] === SHADED) mn++;
    const ok = st.cell[i] === UNKNOWN && !touchesShaded(P, st, i);
    if (ok) run = run > 0 && adjacent(P, prev, i) ? run + 1 : (extra += Math.ceil(run / 2), 1);
    else { extra += Math.ceil(run / 2); run = 0; }
    prev = i;
  }
  extra += Math.ceil(run / 2);
  return [mn, mn + extra];
}

/**
 * Every way to put between kmin and kmax shaded cells in `cells` (a range of collinear cells, in order) with no two
 * touching: a cell that is shaded in all of them must be shaded, a cell shaded in none of them is loop.
 * Returns the sets (empty if nothing new, or if no placement exists: that is the contradiction check's business).
 */
export function rangeDeduce(P, st, cells, kmin, kmax) {
  if (!cells.length) return [];
  let s = 0;
  const elig = [];
  for (const i of cells) {
    if (st.cell[i] === SHADED) s++;
    else if (st.cell[i] === UNKNOWN && !touchesShaded(P, st, i)) elig.push(i);
  }
  const n = elig.length;
  const lo = Math.max(0, kmin - s), hi = Math.min(kmax - s, n);
  if (kmax - s < 0 || lo > hi) return [];
  // Count placements instead of listing them (a 35-cell line has millions): f[p][c][t] = ways to choose c of the first
  // p cells with t = "cell p-1 is chosen"; g[p][c][t] = ways to choose c of the cells from p on, given t for cell p-1.
  const K = hi + 1;
  const idx = (p, c, t) => (p * K + c) * 2 + t;
  const touch = (p) => p > 0 && adjacent(P, elig[p - 1], elig[p]); // can cell p be chosen after a chosen p-1? (no, if they touch)
  const f = new Float64Array((n + 1) * K * 2), g = new Float64Array((n + 1) * K * 2);
  f[idx(0, 0, 0)] = 1;
  for (let p = 0; p < n; p++) {
    for (let c = 0; c < K; c++) for (let t = 0; t < 2; t++) {
      const v = f[idx(p, c, t)];
      if (!v) continue;
      f[idx(p + 1, c, 0)] += v;
      if (c + 1 < K && !(t && touch(p))) f[idx(p + 1, c + 1, 1)] += v;
    }
  }
  g[idx(n, 0, 0)] = 1; g[idx(n, 0, 1)] = 1;
  for (let p = n - 1; p >= 0; p--) {
    for (let t = 0; t < 2; t++) for (let c = 0; c < K; c++) {
      let v = g[idx(p + 1, c, 0)];
      if (c >= 1 && !(t && touch(p))) v += g[idx(p + 1, c - 1, 1)];
      g[idx(p, c, t)] = v;
    }
  }
  let total = 0;
  for (let c = lo; c <= hi; c++) total += f[idx(n, c, 0)] + f[idx(n, c, 1)];
  if (!total) return [];
  const sets = [];
  for (let p = 0; p < n; p++) {
    let with_ = 0;
    for (let t = 0; t < 2; t++) {
      if (t && touch(p)) continue;
      for (let c1 = 0; c1 < K; c1++) {
        const v = f[idx(p, c1, t)];
        if (!v) continue;
        for (let c2 = 0; c1 + 1 + c2 <= hi; c2++) {
          if (c1 + 1 + c2 < lo) continue;
          with_ += v * g[idx(p + 1, c2, 1)];
        }
      }
    }
    if (with_ === total) sets.push(setCell(elig[p], SHADED));
    else if (with_ === 0) sets.push(setCell(elig[p], LOOP));
  }
  return sets;
}

/** Every way to place the clue's shaded cells without two touching includes (or excludes) a cell. */
function cluePlacements(P, st) {
  const out = [];
  P.clues.forEach((cl, k) => {
    const sets = rangeDeduce(P, st, P.rays[k], cl.n, cl.n);
    if (sets.length) out.push(firing(sets, { clue: k, cells: P.rays[k] }));
  });
  return out;
}

/**
 * Two clues in one line pointing the same way: the second one's cells are part of the first one's line, so the cells
 * between them hold exactly (first number - second number) shaded cells.
 */
function rangeSame(P, st) {
  const out = [];
  P.clues.forEach((A, a) => {
    P.clues.forEach((B, b) => {
      if (a === b || A.d !== B.d) return;
      const ia = cellOfClue(P, A), ib = cellOfClue(P, B);
      if (!sameLine(P, A.d, ia, ib) || posAlong(P, A.d, ib) <= posAlong(P, A.d, ia)) return;
      const count = A.n - B.n;
      if (count < 0) return;
      const between = P.rays[a].filter((i) => posAlong(P, A.d, i) < posAlong(P, A.d, ib));
      const sets = rangeDeduce(P, st, between, count, count);
      if (sets.length) out.push(firing(sets, { clue: a, other: b, count, cells: between }));
    });
  });
  return out;
}

/**
 * Two clues in one line pointing at each other. With M the cells between them, R the cells beyond the second and L
 * the cells beyond the first: first = M + R and second = M + L, so how many shaded cells M can hold (given what R and
 * L can hold) pins down how many R and L need.
 */
function rangeFacing(P, st) {
  const out = [];
  P.clues.forEach((A, a) => {
    P.clues.forEach((B, b) => {
      if (a === b || B.d !== (A.d + 2) % 4) return;
      const ia = cellOfClue(P, A), ib = cellOfClue(P, B);
      if (!sameLine(P, A.d, ia, ib) || posAlong(P, A.d, ib) <= posAlong(P, A.d, ia)) return;
      const pa = posAlong(P, A.d, ia), pb = posAlong(P, A.d, ib);
      const M = P.rays[a].filter((i) => posAlong(P, A.d, i) < pb);
      const R = P.rays[a].filter((i) => posAlong(P, A.d, i) > pb);
      const L = P.rays[b].filter((i) => posAlong(P, A.d, i) < pa);
      const [mnM, mxM] = rangeBounds(P, st, M), [mnR, mxR] = rangeBounds(P, st, R), [mnL, mxL] = rangeBounds(P, st, L);
      const lo = Math.max(mnM, A.n - mxR, B.n - mxL), hi = Math.min(mxM, A.n - mnR, B.n - mnL);
      if (lo > hi) return;
      const sets = [
        ...rangeDeduce(P, st, M, lo, hi),
        ...rangeDeduce(P, st, R, A.n - hi, A.n - lo),
        ...rangeDeduce(P, st, L, B.n - hi, B.n - lo),
      ];
      if (sets.length) out.push(firing(sets, { clue: a, other: b, between: [lo, hi], cells: [...M, ...R, ...L] }));
    });
  });
  return out;
}

/**
 * The "lines only" consequences of a position: shaded cells make their neighbours loop, a loop cell with exactly two
 * exits uses both, a cell with two lines has no more. No clue reasoning. Returns the first cell that ends up with
 * three lines or with too few exits, or -1. Mutates `st`.
 */
function followLines(P, st) {
  for (let guard = 0; guard < 500; guard++) {
    let changed = false;
    const put = (arr, idx, v) => { if (arr[idx] === 0) { arr[idx] = v; changed = true; } };
    for (let i = 0; i < P.N; i++) {
      const s = st.cell[i];
      if (s === CLUE) continue;
      if (s === SHADED) {
        for (let d = 0; d < 4; d++) {
          const x = P.ed[i * 4 + d];
          if (x < 0) continue;
          put(st.e, x, E_OFF);
          put(st.cell, P.nb[i * 4 + d], LOOP);
        }
        continue;
      }
      const on = onCount(P, st, i);
      if (on > 0 && s === UNKNOWN) put(st.cell, i, LOOP);
      const ex = exits(P, st, i);
      if ((s === LOOP || on > 0) && (on > 2 || ex < 2)) return i;
      if (s === LOOP || on > 0) {
        for (let d = 0; d < 4; d++) {
          const x = P.ed[i * 4 + d];
          if (x < 0 || st.e[x] !== E_UNKNOWN || st.cell[P.nb[i * 4 + d]] === SHADED) continue;
          if (on === 2) put(st.e, x, E_OFF);
          else if (ex === 2) put(st.e, x, E_ON);
        }
      }
    }
    for (let x = 0; x < P.numEdges; x++) {
      if (st.e[x] !== E_ON) continue;
      for (const c of edgeCells(P, x)) put(st.cell, c, LOOP);
    }
    if (!changed) return -1;
  }
  return -1;
}

/** Imagine a cell is shaded and add the lines that forces: if some cell gets three lines (or is left stranded), it is loop. */
function shadeForcesLines(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const st2 = cloneState(st);
    st2.cell[i] = SHADED;
    const bad = followLines(P, st2);
    if (bad >= 0) out.push(firing([setCell(i, LOOP)], { cell: i, stranded: bad }));
  }
  return out;
}

/**
 * A loop cell with three ways out where two of them lead to the two ends of one path: using both would close the loop
 * too early (other loop cells lie outside), so the cell uses the third way out.
 */
function sameSegmentExits(P, st) {
  const { find } = components(P, st);
  const perRoot = new Map();
  let loopTotal = 0;
  for (let i = 0; i < P.N; i++) if (st.cell[i] === LOOP) { loopTotal++; const r = find(i); perRoot.set(r, (perRoot.get(r) || 0) + 1); }
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== LOOP || onCount(P, st, i) !== 0) continue;
    const ex = [];
    for (let d = 0; d < 4; d++) {
      const x = P.ed[i * 4 + d];
      if (x < 0 || st.e[x] === E_OFF || st.cell[P.nb[i * 4 + d]] === SHADED) continue;
      ex.push({ x, j: P.nb[i * 4 + d] });
    }
    if (ex.length !== 3) continue;
    for (let a = 0; a < 3; a++) {
      for (let b = a + 1; b < 3; b++) {
        const ra = find(ex[a].j);
        if (ra !== find(ex[b].j) || loopTotal <= (perRoot.get(ra) || 0) + 1) continue; // closing would finish the loop: fine
        const third = ex[3 - a - b];
        out.push(firing([setEdge(third.x, E_ON)], { cell: i, a: ex[a].j, b: ex[b].j, third: third.j }));
      }
    }
  }
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
  { id: 'tightCell', tier: 'Beginner', weight: 0.5, find: tightCell, label: 'a corner-like cell with only two neighbours: both are loop' },
  { id: 'deadEndNeighbor', tier: 'Beginner', weight: 2, find: deadEndNeighbor, label: 'shading this cell would strand a neighbour: it is loop' },
  { id: 'sameSegmentExits', tier: 'Medium', weight: 3, find: sameSegmentExits, label: 'two of a cell\'s three ways out lead to the same path: it uses the third' },
  { id: 'noEarlyClose', tier: 'Medium', weight: 3, find: noEarlyClose, label: 'a segment would close the loop too early' },
  { id: 'cluePlacements', tier: 'Medium', weight: 4, find: cluePlacements, label: 'every way to place a clue\'s shaded cells includes (or leaves out) this cell' },
  { id: 'rangeSame', tier: 'Medium', weight: 6, find: rangeSame, label: 'two clues point the same way: the cells between them hold the difference of their numbers' },
  { id: 'shadeForcesLines', tier: 'Hard', weight: 8, find: shadeForcesLines, label: 'a box here would force a line end to do two incompatible things' },
  { id: 'rangeFacing', tier: 'Hard', weight: 10, find: rangeFacing, label: 'two clues point at each other: how many shaded cells fit between them decides how many each end needs' },
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

/**
 * The easiest rule that has a deduction in `st`, with every firing of it: { rule, tier, weight, firings: [{sets, info}] },
 * or null if the rules are stuck. Bookkeeping is applied to `st` first (silently), so `st` is the position the rules saw.
 */
export function nextSteps(P, st) {
  for (;;) {
    let any = false;
    for (const r of RULES) {
      if (!r.free) continue;
      for (const f of r.find(P, st, {})) { if (applySets(st, f.sets)) any = true; else return null; }
    }
    if (!any) break;
  }
  for (const rule of RULES) {
    if (rule.free) continue;
    const firings = rule.find(P, st, { upto: FIRST_LOOKAHEAD });
    if (firings.length) return { rule: rule.id, tier: rule.tier, weight: rule.weight, firings };
  }
  return null;
}

/** The easiest deduction available in `st`, or null: { rule, tier, weight, sets, info }. */
export function nextStep(P, st) {
  const r = nextSteps(P, st);
  return r ? { rule: r.rule, tier: r.tier, weight: r.weight, sets: r.firings[0].sets, info: r.firings[0].info } : null;
}

/** Fully decided? Every cell known, every loop cell has two segments. */
export function isComplete(P, st) {
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
    if (!contradiction(P, st) && isComplete(P, st)) break;
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
  const solved = isComplete(P, st) && checkSolved(P, shaded, edges);
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

/**
 * Do the rules below the lookahead rules solve the puzzle (no trial and error)? Used by the generator: the rules are
 * sound, so a puzzle they solve has exactly one solution without any exhaustive search. `upto` limits the rules used
 * (default: all but the lookahead rules). Returns { solved, state, steps }.
 */
export function solvedByRules(P, upto = FIRST_LOOKAHEAD) {
  const st = initialState(P);
  const r = closure(P, st, upto);
  return { solved: !r.contradiction && isComplete(P, st), state: st, steps: r.steps };
}

export { FIRST_LOOKAHEAD };
