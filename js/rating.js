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
//   closingCell      a cell has only two ways out and both lead to the two ends of one path: using them would close the
//                    loop early, so it is shaded
//   noEarlyClose     a segment joining the two ends of one path would close the loop while other loop cells are
//                    outside it: no segment there
//   parityForces     a move (a cell shaded, a segment drawn or missing) would cut off a group of cells holding an odd
//                    number of open ends, which can never be completed: it is the other way
//   segmentForcesLines  shadeForcesLines for a segment: imagine it missing (or drawn), add the forced lines, and a cell is left with
//                    three lines or too few ways out
//   uniqueRoute      (assumes ONE solution) a way of pairing the open ends of a group that can be drawn two ways is not the real one
//   closingNeighbor  imagine a cell shaded: its neighbour would be a dot whose only two ways out are the ends of one path
//   pairedEnds       the open ends of a group of cells that can still be joined pair up inside it: whatever pairings do not close
//                    the loop early, two far ends always end up as the ends of one line, so no segment joins them
//   crossingParity   the loop crosses the border of any rectangle an even number of times: when all but one crossing is
//                    settled, the last is forced
//   rangeSame        two clues in a line point the same way: the cells between them hold (first - second) shaded cells
//   rangeFacingKnown two clues point at each other and one of the three parts of the line (between them, beyond either)
//                    holds a known number of boxes: that fixes the other two
//   rangeFacing      the same when no part is exact: the room between them, and at each end, bounds how many shaded
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
    if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue; // a full cell takes no more segments
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

/**
 * Parity of open ends. A cell "needs" segments if it is not a clue or shaded and has fewer than two. Join two needy cells
 * that an undecided segment could connect; every segment still to be drawn adds one end to each of two cells in the same
 * group, so each group must hold an even number of open ends (cells with one segment that still need their second).
 * Returns the open ends of the smallest group with an odd number, or null if every group is even.
 */
function openEndGroups(P, st) {
  const { N } = P;
  const needy = new Uint8Array(N);
  const ends = [];
  for (let i = 0; i < N; i++) {
    if (st.cell[i] === CLUE || st.cell[i] === SHADED) continue;
    const on = onCount(P, st, i);
    if (on < 2) needy[i] = 1;
    if (on === 1) ends.push(i);
  }
  if (!ends.length) return null;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    if (needy[a] && needy[b]) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  }
  return { find, ends, needy };
}

export function oddOpenEnds(P, st) {
  const g = openEndGroups(P, st);
  if (!g) return null;
  const { find, ends } = g;
  const count = new Map();
  for (const i of ends) { const r = find(i); count.set(r, (count.get(r) || 0) + 1); }
  // Odd groups come in pairs (the total number of open ends is always even). Report the smallest: the enclosed region.
  let best = null;
  for (const [r, c] of count) if (c % 2 && (!best || c < best[1])) best = [r, c];
  return best ? ends.filter((i) => find(i) === best[0]) : null;
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
  return oddOpenEnds(P, st) !== null;
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
      if (onCount(P, st, P.nb[i * 4 + d]) >= 2) continue; // a full neighbour is not one of the two ways out
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
 * Two clues in one line pointing at each other split the line into three parts: M, the cells between them (seen by both),
 * R, the cells beyond the second (seen only by the first) and L, the cells beyond the first (seen only by the second).
 * first = M + R and second = M + L. How many shaded cells each part can hold (rangeBounds) pins down the other two.
 *   rangeFacingKnown   some part already holds an exact number (filled in, or no room for more): the other two follow
 *   rangeFacing        no part is exact, only the room each has: the bounds still pin the counts
 * Each firing goes to exactly one of the two rules.
 */
function facing(P, st, known) {
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
      const exact = ['R', 'L', 'M'].find((k) => ({ M: mnM === mxM, R: mnR === mxR, L: mnL === mxL })[k]);
      const isKnown = exact !== undefined && lo === hi;
      if (isKnown !== known) return;
      const sets = [
        ...rangeDeduce(P, st, M, lo, hi),
        ...rangeDeduce(P, st, R, A.n - hi, A.n - lo),
        ...rangeDeduce(P, st, L, B.n - hi, B.n - lo),
      ];
      if (!sets.length) return;
      const info = { clue: a, other: b, between: [lo, hi], cells: [...M, ...R, ...L], bounds: { M: [mnM, mxM], R: [mnR, mxR], L: [mnL, mxL] } };
      if (isKnown) { info.known = exact; info.counts = { M: lo, R: A.n - lo, L: B.n - lo }; }
      out.push(firing(sets, info));
    });
  });
  return out;
}
const rangeFacingKnown = (P, st) => facing(P, st, true);
const rangeFacing = (P, st) => facing(P, st, false);

/**
 * The "lines only" consequences of a position: shaded cells make their neighbours loop, a loop cell with exactly two
 * exits uses both, a cell with two lines has no more. No clue reasoning. Returns the first cell that ends up with
 * three lines or with too few exits, or a cell of a cycle that closes the loop too early (and sets st.closedEarly), or -1. Mutates `st`.
 */
export function followLines(P, st) {
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
          else if (ex === 2 && onCount(P, st, P.nb[i * 4 + d]) < 2) put(st.e, x, E_ON); // a full neighbour is not one of the two ways out
        }
      }
    }
    for (let x = 0; x < P.numEdges; x++) {
      if (st.e[x] !== E_ON) continue;
      for (const c of edgeCells(P, x)) put(st.cell, c, LOOP);
    }
    if (!changed) {
      const c = closedEarly(P, st);
      if (c >= 0) { st.closedEarly = true; return c; }
      return -1;
    }
  }
  return -1;
}

/** A cell of a closed cycle of segments when loop cells lie outside it (the loop closed too early), else -1. */
function closedEarly(P, st) {
  const { find, cycleRoot } = components(P, st);
  if (cycleRoot < 0) return -1;
  let outside = false, on = -1;
  for (let i = 0; i < P.N; i++) {
    if (find(i) === cycleRoot) { if (on < 0 && onCount(P, st, i) > 0) on = i; }
    else if (st.cell[i] === LOOP) outside = true;
  }
  return outside ? on : -1;
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
 * Like shadeForcesLines, for a segment: imagine it missing (or drawn) next to a loop cell, add the lines that forces, and if
 * some cell ends up with three lines or too few ways out, the segment is there (or is not). A loop cell with three ways out
 * that cannot skip one of them without a contradiction must use it.
 */
function segmentForcesLines(P, st) {
  const out = [];
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const [a, b] = edgeCells(P, x);
    if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
    if (st.cell[a] !== LOOP && st.cell[b] !== LOOP && !onCount(P, st, a) && !onCount(P, st, b)) continue; // next to the known loop only
    for (const v of [E_OFF, E_ON]) {
      const st2 = cloneState(st);
      st2.e[x] = v;
      const bad = followLines(P, st2);
      if (bad >= 0) { out.push(firing([setEdge(x, v === E_OFF ? E_ON : E_OFF)], { edge: x, assumed: v === E_OFF ? 'off' : 'on', stranded: bad })); break; }
    }
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
      const j = x < 0 ? -1 : P.nb[i * 4 + d];
      if (x < 0 || st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
      if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue; // a full cell takes no more segments
      ex.push({ x, j });
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

/**
 * A cell with only two ways out, both leading to the two ends of one path: taking both would close the loop too early
 * (other loop cells lie outside), so the cell cannot be on the loop and is shaded.
 */
function closingCell(P, st) {
  const { find } = components(P, st);
  const perRoot = new Map();
  let loopTotal = 0;
  for (let i = 0; i < P.N; i++) if (st.cell[i] === LOOP) { loopTotal++; const r = find(i); perRoot.set(r, (perRoot.get(r) || 0) + 1); }
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN || onCount(P, st, i) > 0) continue; // a cell with a segment is already on the loop
    const ex = [];
    for (let d = 0; d < 4; d++) {
      const x = P.ed[i * 4 + d];
      const j = P.nb[i * 4 + d];
      if (x < 0 || st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
      if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue; // a full cell takes no more segments
      ex.push(j);
    }
    if (ex.length !== 2) continue;
    const ra = find(ex[0]);
    if (ra !== find(ex[1])) continue;                  // the two neighbours are not on one path
    if (loopTotal <= (perRoot.get(ra) || 0)) continue; // closing would finish the loop: fine
    out.push(firing([setCell(i, SHADED)], { cell: i, a: ex[0], b: ex[1] }));
  }
  return out;
}

/**
 * Imagine a cell shaded: its undecided neighbour then has to be a loop cell, and if its only two remaining ways out lead to the
 * two ends of one path, using both would close the loop too early (other loop cells lie outside). So the cell is loop.
 * (closingCell, one step removed: the neighbour had three ways out, the shaded cell being the third.)
 */
function closingNeighbor(P, st) {
  const { find } = components(P, st);
  const perRoot = new Map();
  let loopTotal = 0;
  for (let i = 0; i < P.N; i++) if (st.cell[i] === LOOP) { loopTotal++; const r = find(i); perRoot.set(r, (perRoot.get(r) || 0) + 1); }
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    for (let d = 0; d < 4; d++) {
      const n = P.nb[i * 4 + d];
      if (n < 0 || st.cell[n] !== UNKNOWN || onCount(P, st, n) > 0) continue;
      const ex = [];
      for (let e = 0; e < 4; e++) {
        const x = P.ed[n * 4 + e];
        const j = P.nb[n * 4 + e];
        if (x < 0 || j === i || st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
        if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue;
        ex.push(j);
      }
      if (ex.length !== 2) continue;
      const ra = find(ex[0]);
      if (ra !== find(ex[1]) || loopTotal <= (perRoot.get(ra) || 0)) continue;
      out.push(firing([setCell(i, LOOP)], { cell: i, neighbor: n, a: ex[0], b: ex[1] }));
      break;
    }
  }
  return out;
}

/** The cell at the other end of the path that starts at the end cell u (or -1). */
function farEnd(P, st, u) {
  let prev = -1, cur = u;
  for (let guard = 0; guard < P.N + 2; guard++) {
    let next = -1;
    for (let d = 0; d < 4; d++) {
      const x = P.ed[cur * 4 + d];
      if (x < 0 || st.e[x] !== E_ON) continue;
      const j = P.nb[cur * 4 + d];
      if (j !== prev) { next = j; break; }
    }
    if (next < 0) return cur;
    prev = cur; cur = next;
  }
  return -1;
}

/** Every way to pair up the items of `list` (an even number of them). */
function perfectMatchings(list) {
  if (!list.length) return [[]];
  const [first, ...rest] = list;
  const out = [];
  for (let k = 0; k < rest.length; k++) {
    const others = rest.filter((_, q) => q !== k);
    for (const m of perfectMatchings(others)) out.push([[first, rest[k]], ...m]);
  }
  return out;
}

/**
 * Group the cells that can still be joined (see oddOpenEnds). Every open end in a group has to be joined to another open end of
 * the same group, through the group. List every way to pair them up and throw away those that close a loop too early (an end joined
 * to the other end of its own path, say, while other loop cells lie outside). Then look at what the remaining pairings share: in every
 * one, some two ends outside the group (the far ends of the paths that enter it) end up as the two ends of ONE line. A segment between
 * those two would close the loop early, so it is not there. With two open ends there is one pairing: they join each other.
 */
function pairedEnds(P, st) {
  const g = openEndGroups(P, st);
  if (!g) return [];
  const { find, ends, needy } = g;
  const byRoot = new Map();
  for (const i of ends) { const r = find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(i); }
  const { find: path } = components(P, st);
  const out = [];
  for (const [root, es] of byRoot) {
    if (es.length < 2 || es.length > 6) continue;
    const group = [];
    const inGroup = new Set();
    for (let i = 0; i < P.N; i++) if (needy[i] && find(i) === root) { group.push(i); inGroup.add(i); }
    const far = new Map(es.map((u) => [u, farEnd(P, st, u)]));
    if ([...far.values()].some((w) => w < 0)) continue;
    const outsideOf = (roots) => { for (let i = 0; i < P.N; i++) if (st.cell[i] === LOOP && !inGroup.has(i) && !roots.has(path(i))) return true; return false; };
    let common = null;      // "a,b|outside": pairs of free ends that every valid pairing leaves as the two ends of one line
    let valid = 0;
    for (const m of perfectMatchings(es)) {
      const partner = new Map();
      for (const [u, v] of m) { partner.set(u, v); partner.set(v, u); }
      // Follow the lines: from a free end (the far end of a path entering the group) go to the open end of that path, jump to its
      // partner, follow the partner's path to its far end, and so on until a free end is reached again.
      const free = [...new Set(es.map((u) => far.get(u)).filter((w) => !es.includes(w)))];
      const chains = [], done = new Set();
      for (const f0 of free) {
        if (done.has(f0)) continue;
        let u = es.find((q) => far.get(q) === f0), end = -1;
        const roots = new Set([path(f0)]);
        for (let guard = 0; guard < 32; guard++) {
          const v = partner.get(u);
          roots.add(path(v));
          const w = far.get(v);
          if (!es.includes(w)) { end = w; break; }
          u = w;
        }
        if (end < 0) { chains.length = 0; break; }
        done.add(f0); done.add(end);
        chains.push({ a: f0, b: end, roots });
      }
      // paths the pairing closes into a loop without reaching a free end: only possible if that loop holds every loop cell
      const reached = new Set(chains.flatMap((c) => [...c.roots]));
      const cycle = new Set();
      for (const u of es) if (!reached.has(path(u))) cycle.add(path(u));
      if (cycle.size && outsideOf(cycle)) continue;
      valid++;
      const keys = new Set(chains.map((c) => `${Math.min(c.a, c.b)},${Math.max(c.a, c.b)}|${outsideOf(c.roots) ? 1 : 0}`));
      common = common === null ? keys : new Set([...common].filter((k) => keys.has(k)));
    }
    if (!valid || !common) continue;
    for (const key of common) {
      const [ab, outside] = key.split('|');
      if (outside !== '1') continue;
      const [a, b] = ab.split(',').map(Number);
      if (inGroup.has(a) || inGroup.has(b)) continue;
      for (let d = 0; d < 4; d++) {
        const x = P.ed[a * 4 + d];
        if (x < 0 || P.nb[a * 4 + d] !== b || st.e[x] !== E_UNKNOWN) continue;
        out.push(firing([setEdge(x, E_OFF)], { edge: x, pair: es.slice(0, 2), ends: es, far: [a, b], cells: group, k: es.length }));
      }
    }
  }
  return out;
}

/**
 * UNIQUENESS. A group of cells that can still be joined, all of them known loop cells, holds some open ends that must be paired up
 * through the group. A pairing that can be drawn in two different ways (same cells, different segments) cannot be the real one:
 * swapping one drawing for the other would give a second solution (the clues count boxes, and the boxes did not change). Drop those
 * pairings; if something is then settled (a segment in every drawing left, or in none), say so. This rule ASSUMES THE PUZZLE HAS ONE
 * SOLUTION, so it is not used where rule-solved is taken to prove uniqueness (see ASSUMES_UNIQUE).
 */
function uniqueRoute(P, st) {
  const g = openEndGroups(P, st);
  if (!g) return [];
  const { find, ends, needy } = g;
  const roots = new Set(ends.map((i) => find(i)));
  const out = [];
  for (const root of roots) {
    const cells = [];
    for (let i = 0; i < P.N; i++) if (needy[i] && find(i) === root) cells.push(i);
    if (cells.length > 12 || cells.some((i) => st.cell[i] !== LOOP)) continue;
    const inGroup = new Set(cells);
    const need = new Map(cells.map((i) => [i, 2 - onCount(P, st, i)]));
    const xs = [];
    for (let x = 0; x < P.numEdges; x++) {
      if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
      const [a, b] = edgeCells(P, x);
      if (inGroup.has(a) && inGroup.has(b)) xs.push(x);
    }
    if (xs.length > 18) continue;
    const endsHere = cells.filter((i) => need.get(i) === 1);
    // every way to give each cell exactly its missing segments
    const deg = new Map(cells.map((i) => [i, 0]));
    const picked = [], solutions = [];
    const dfs = (k) => {
      if (k === xs.length) { if (cells.every((i) => deg.get(i) === need.get(i))) solutions.push(picked.slice()); return; }
      const [a, b] = edgeCells(P, xs[k]);
      if (deg.get(a) < need.get(a) && deg.get(b) < need.get(b)) {
        deg.set(a, deg.get(a) + 1); deg.set(b, deg.get(b) + 1); picked.push(xs[k]);
        dfs(k + 1);
        picked.pop(); deg.set(a, deg.get(a) - 1); deg.set(b, deg.get(b) - 1);
      }
      dfs(k + 1);
    };
    dfs(0);
    // the pairing each drawing makes of the open ends (a drawing with a closed loop of its own is no drawing at all)
    const byPairing = new Map();
    for (const sol of solutions) {
      const adj = new Map(cells.map((i) => [i, []]));
      for (const x of sol) { const [a, b] = edgeCells(P, x); adj.get(a).push(b); adj.get(b).push(a); }
      const seen = new Set(), pairs = [];
      for (const u of endsHere) {
        if (seen.has(u)) continue;
        let prev = -1, cur = u; seen.add(u);
        for (let guard = 0; guard < 40; guard++) {
          const nxt = adj.get(cur).find((j) => j !== prev);
          if (nxt === undefined) break;
          prev = cur; cur = nxt; seen.add(cur);
          if (need.get(cur) === 1) break;
        }
        pairs.push([Math.min(u, cur), Math.max(u, cur)]);
      }
      if (cells.some((i) => !seen.has(i))) continue;
      const key = pairs.sort((p, q) => p[0] - q[0]).map((p) => p.join('-')).join(',');
      if (!byPairing.has(key)) byPairing.set(key, []);
      byPairing.get(key).push(sol);
    }
    const kept = [];
    let dropped = false;
    for (const sols of byPairing.values()) { if (sols.length === 1) kept.push(sols[0]); else dropped = true; }
    if (!dropped || !kept.length) continue;
    const sets = [];
    for (const x of xs) {
      const n = kept.filter((sol) => sol.includes(x)).length;
      if (n === kept.length) sets.push(setEdge(x, E_ON));
      else if (n === 0) sets.push(setEdge(x, E_OFF));
    }
    sets.sort((p, q) => (q[2] === E_ON) - (p[2] === E_ON));   // segments that are there first: they make the better headline
    if (sets.length) out.push(firing(sets, { cells, ends: endsHere, edge: sets[0][1], value: sets[0][2] }));
  }
  return out;
}

/**
 * The loop crosses the border of any rectangle of cells an even number of times: every loop cell uses exactly two segments,
 * so the segments leaving the rectangle (counted once per crossing) pair up. When all but one crossing is settled, the last
 * one is forced. Checked for every small rectangle (up to 4x4), every rectangle anchored in a corner of the board, and every
 * full-width or full-height band; each is O(1) with prefix sums.
 */
function crossingParity(P, st) {
  const { rows, cols } = P;
  const live = (a, b) => P.clueAt[a] < 0 && P.clueAt[b] < 0 && st.cell[a] !== SHADED && st.cell[b] !== SHADED;
  // prefix sums along each row of the down-edges, and along each column of the right-edges: [on, unknown]
  const dOn = new Int16Array(rows * (cols + 1)), dUn = new Int16Array(rows * (cols + 1));
  const rOn = new Int16Array(cols * (rows + 1)), rUn = new Int16Array(cols * (rows + 1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let on = 0, un = 0;
      if (r < rows - 1 && live(i, i + cols)) { const v = st.e[2 * i + 1]; if (v === E_ON) on = 1; else if (v === E_UNKNOWN) un = 1; }
      dOn[r * (cols + 1) + c + 1] = dOn[r * (cols + 1) + c] + on; dUn[r * (cols + 1) + c + 1] = dUn[r * (cols + 1) + c] + un;
      on = 0; un = 0;
      if (c < cols - 1 && live(i, i + 1)) { const v = st.e[2 * i]; if (v === E_ON) on = 1; else if (v === E_UNKNOWN) un = 1; }
      rOn[c * (rows + 1) + r + 1] = rOn[c * (rows + 1) + r] + on; rUn[c * (rows + 1) + r + 1] = rUn[c * (rows + 1) + r] + un;
    }
  }
  const found = new Map();
  const check = (r0, c0, r1, c1) => {
    let on = 0, un = 0;
    if (r0 > 0) { const b = (r0 - 1) * (cols + 1); on += dOn[b + c1 + 1] - dOn[b + c0]; un += dUn[b + c1 + 1] - dUn[b + c0]; }
    if (r1 < rows - 1) { const b = r1 * (cols + 1); on += dOn[b + c1 + 1] - dOn[b + c0]; un += dUn[b + c1 + 1] - dUn[b + c0]; }
    if (c0 > 0) { const b = (c0 - 1) * (rows + 1); on += rOn[b + r1 + 1] - rOn[b + r0]; un += rUn[b + r1 + 1] - rUn[b + r0]; }
    if (c1 < cols - 1) { const b = c1 * (rows + 1); on += rOn[b + r1 + 1] - rOn[b + r0]; un += rUn[b + r1 + 1] - rUn[b + r0]; }
    if (un !== 1) return;
    // find the one unknown crossing
    let x = -1;
    if (r0 > 0) for (let c = c0; c <= c1 && x < 0; c++) { const i = (r0 - 1) * cols + c; if (live(i, i + cols) && st.e[2 * i + 1] === E_UNKNOWN) x = 2 * i + 1; }
    if (x < 0 && r1 < rows - 1) for (let c = c0; c <= c1 && x < 0; c++) { const i = r1 * cols + c; if (live(i, i + cols) && st.e[2 * i + 1] === E_UNKNOWN) x = 2 * i + 1; }
    if (x < 0 && c0 > 0) for (let r = r0; r <= r1 && x < 0; r++) { const i = r * cols + c0 - 1; if (live(i, i + 1) && st.e[2 * i] === E_UNKNOWN) x = 2 * i; }
    if (x < 0 && c1 < cols - 1) for (let r = r0; r <= r1 && x < 0; r++) { const i = r * cols + c1; if (live(i, i + 1) && st.e[2 * i] === E_UNKNOWN) x = 2 * i; }
    if (x < 0 || found.has(x)) return;
    found.set(x, { edge: x, value: on % 2 ? E_ON : E_OFF, rect: [r0, c0, r1, c1], crossings: on });
  };
  for (let r0 = 0; r0 < rows; r0++) for (let c0 = 0; c0 < cols; c0++) {
    for (let h = 1; h <= 4 && r0 + h <= rows; h++) for (let w = 1; w <= 4 && c0 + w <= cols; w++) check(r0, c0, r0 + h - 1, c0 + w - 1);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { // rectangles anchored in each corner
    check(0, 0, r, c); check(0, c, r, cols - 1); check(r, 0, rows - 1, c); check(r, c, rows - 1, cols - 1);
  }
  for (let a = 0; a < rows; a++) for (let b = a; b < rows; b++) check(a, 0, b, cols - 1); // bands
  for (let a = 0; a < cols; a++) for (let b = a; b < cols; b++) check(0, a, rows - 1, b);
  return [...found.values()].map((f) => firing([setEdge(f.edge, f.value)], f));
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

/**
 * A move that cuts off a region with an odd number of open ends is impossible: imagine the cell shaded (or the segment
 * missing, or drawn) and look at the groups of cells that can still be joined; an odd group cannot be completed.
 */
function parityForces(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const st2 = cloneState(st);
    st2.cell[i] = SHADED;
    for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st2.e[x] === E_UNKNOWN) st2.e[x] = E_OFF; }
    const ends = oddOpenEnds(P, st2);
    if (ends) out.push(firing([setCell(i, LOOP)], { cell: i, assumed: 'shaded', ends }));
  }
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const [a, b] = edgeCells(P, x);
    if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
    const off = cloneState(st); off.e[x] = E_OFF;
    const endsOff = oddOpenEnds(P, off);
    if (endsOff) { out.push(firing([setEdge(x, E_ON)], { edge: x, assumed: 'off', ends: endsOff })); continue; }
    const on = cloneState(st); on.e[x] = E_ON; on.cell[a] = LOOP; on.cell[b] = LOOP;
    const endsOn = oddOpenEnds(P, on);
    if (endsOn) out.push(firing([setEdge(x, E_OFF)], { edge: x, assumed: 'on', ends: endsOn }));
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

// Beginner weights are a quarter of what they were at first: those steps are the bulk of any solve (about half the old score) yet
// nearly the same for every puzzle of a size, so they only blurred the difference between an easy and a hard puzzle.
// The rule table. THIS is where rules are binned into tiers and given weights: re-bin a rule by changing its tier
// here (and rescoring), change a weight by editing it. Listed easiest first; the solver tries them in this order.
export const RULES = [
  { id: 'edgesOffShaded', tier: 'Beginner', weight: 0, free: true, find: bookkeepingShadedEdges, label: 'segments touching a shaded cell are off' },
  { id: 'edgeEnds', tier: 'Beginner', weight: 0, free: true, find: bookkeepingEdgeEnds, label: 'a segment makes both its cells loop cells' },
  { id: 'fullCells', tier: 'Beginner', weight: 0, free: true, find: bookkeepingFullCells, label: 'a loop cell with two segments has no others' },
  { id: 'clueDone', tier: 'Beginner', weight: 0.25, find: clueDone, label: 'a clue has all its shaded cells: the rest of its line is loop' },
  { id: 'clueFull', tier: 'Beginner', weight: 0.25, find: clueFull, label: 'a clue needs every open cell left in its line: shade them' },
  { id: 'shadedNeighbor', tier: 'Beginner', weight: 0.25, find: shadedNeighbor, label: 'cells next to a shaded cell are loop' },
  { id: 'deadEnd', tier: 'Beginner', weight: 0.5, find: deadEnd, label: 'a cell with fewer than two exits is shaded' },
  { id: 'forcedExits', tier: 'Beginner', weight: 0.075, find: forcedExits, label: 'a loop cell with two exits left uses both' },
  { id: 'tightCell', tier: 'Beginner', weight: 0.125, find: tightCell, label: 'a box here would turn a corner-like neighbour into a dot with just one way out: this cell is a dot' },
  { id: 'deadEndNeighbor', tier: 'Beginner', weight: 0.5, find: deadEndNeighbor, label: 'shading this cell would strand a neighbour: it is loop' },
  { id: 'sameSegmentExits', tier: 'Medium', weight: 3, find: sameSegmentExits, label: 'two of a cell\'s three ways out lead to the same path: it uses the third' },
  { id: 'closingCell', tier: 'Medium', weight: 3, find: closingCell, label: 'a cell whose only two ways out lead to the ends of one path would close the loop early: it is a box' },
  { id: 'noEarlyClose', tier: 'Medium', weight: 3, find: noEarlyClose, label: 'a segment would close the loop too early' },
  { id: 'closingNeighbor', tier: 'Medium', weight: 4, find: closingNeighbor, label: 'a box here would turn a neighbour into a dot whose only two ways out are the ends of one path: this cell is a dot' },
  { id: 'cluePlacements', tier: 'Medium', weight: 4, find: cluePlacements, label: 'every way to place a clue\'s shaded cells includes (or leaves out) this cell' },
  { id: 'rangeSame', tier: 'Medium', weight: 6, find: rangeSame, label: 'two clues point the same way: the cells between them hold the difference of their numbers' },
  { id: 'crossingParity', tier: 'Hard', weight: 6, find: crossingParity, label: 'the loop crosses the border of a rectangle an even number of times' },
  { id: 'pairedEnds', tier: 'Hard', weight: 7, find: pairedEnds, label: 'however the open ends of a sealed-off area pair up, two lines end up as one: their far ends cannot be joined' },
  { id: 'shadeForcesLines', tier: 'Hard', weight: 8, find: shadeForcesLines, label: 'a box here would force a line end to do two incompatible things' },
  { id: 'segmentForcesLines', tier: 'Hard', weight: 8, find: segmentForcesLines, label: 'a loop cell cannot skip (or take) this segment: the lines that forces leave a cell with three lines or too few ways out' },
  { id: 'parityForces', tier: 'Hard', weight: 9, find: parityForces, label: 'a move here would cut off a region with an odd number of open ends' },
  { id: 'rangeFacingKnown', tier: 'Hard', weight: 10, find: rangeFacingKnown, label: 'two clues point at each other and one part of the line has a known number of boxes: that fixes the other two parts' },
  { id: 'rangeFacing', tier: 'Hard', weight: 12, find: rangeFacing, label: 'two clues point at each other: how many shaded cells fit in each part of the line fixes how many it holds' },
  { id: 'tryCell', tier: 'Hard', weight: 12, lookahead: true, find: lookahead('cell'), label: 'trying a cell one way leads to a contradiction' },
  { id: 'tryEdge', tier: 'Hard', weight: 14, lookahead: true, find: lookahead('edge'), label: 'trying a segment one way leads to a contradiction' },
  { id: 'uniqueRoute', tier: 'Hard', weight: 11, assumesUnique: true, find: uniqueRoute, label: 'a way of joining the open ends here could be drawn two ways, which would give two solutions: so it is not the way' },
];

// Rules flagged assumesUnique are valid only if the puzzle has exactly one solution. They sit after the lookahead rules in the table
// so that everything that takes "solved by the rules" as proof of uniqueness (solvedByRules, closure, the generator) never uses them;
// nextSteps (rating and hints) tries them after the plain rules and before trial and error.
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
  // easiest first; the rules that assume a unique solution come after the plain ones but before trial and error
  for (const rule of [...RULES.slice(0, FIRST_LOOKAHEAD), ...RULES.filter((r) => r.assumesUnique), ...RULES.filter((r) => r.lookahead)]) {
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
    const rank = (id) => RULES[RULE_IDS.indexOf(id)].weight * 1000 + RULE_IDS.indexOf(id);   // the heaviest rule used (ties: later in the table)
    hardest = steps.length ? steps.reduce((best, s) => (rank(s.rule) > rank(best) ? s.rule : best), steps[0].rule) : 'clueDone';
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

/**
 * Like solvedByRules, but also with the rules that assume a unique solution: what a person solving a (unique) puzzle may use short of
 * trial and error. NOT a proof of uniqueness. Used to decide where a person is stuck. Returns { solved, state, steps }.
 */
export function solvedByHumanRules(P) {
  const st = initialState(P);
  const order = [...RULES.slice(0, FIRST_LOOKAHEAD), ...RULES.filter((r) => r.assumesUnique)];
  let steps = 0;
  for (let guard = 0; guard < 5000; guard++) {
    if (contradiction(P, st)) return { solved: false, state: st, steps };
    let fired = false;
    for (const rule of order) {
      const fs = rule.find(P, st, { upto: FIRST_LOOKAHEAD });
      if (!fs.length) continue;
      for (const f of fs) if (!applySets(st, f.sets)) return { solved: false, state: st, steps };
      steps++; fired = true;
      break;
    }
    if (!fired) break;
  }
  return { solved: isComplete(P, st), state: st, steps };
}

export { FIRST_LOOKAHEAD };
