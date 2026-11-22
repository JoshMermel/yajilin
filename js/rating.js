// Rates yajilin puzzles by the deduction rules a human needs to solve them. The same rule table will drive the
// Hint button, so ratings, hints and docs cannot drift apart (see README, "Difficulty").
//
// The solver always applies the easiest applicable rule and never looks at the stored solution. A puzzle's `rules`
// value is the hardest rule it needed ('unsolved' if the rules got stuck); its `tier` is that rule's tier and its
// `score` the weighted sum of every step taken (plus a penalty per cell left undetermined).
//
// The rules are in the RULES table at the bottom (each with its tier, cost and a one-line label) and in README.md, "Difficulty", which
// lists them in the order a person meets them (cheapest first) with an example each. In short, by tier:
//   Beginner  clue counting (clueDone, clueFull, clueTight, rangeSameOne), boxes never touch (shadedNeighbor), dead ends and forced exits,
//             corners and corridors (tightCell), not closing the loop early (noEarlyClose, sameSegmentExits, closingCell)
//   Medium    placing a clue's boxes (cluePlacements, placementDeadEnd, rangeSame, rangeFacingKnown), and imagining ONE box, dot or segment
//             and following a short chain: deadEndNeighbor, shadeShortChain, boxStarvesClue, closingNeighbor, dotShortChain, twoEndsJoin,
//             shadeFewLines, segmentShortChain, boxStarvesClueByLines, parityPocket, chokepoint
//   Hard      counting with bounds (rangeFacing), colour balance, chokepoints around large areas (chokepointArea), the long chains (shadeForcesLines, boxStarvesClueByPlacements,
//             segmentStarvesClue, shadeClosesLoop, dotForcesLines, segmentForcesLines, segmentClosesLoop), parity of large areas
//             (crossingParity, parityForces), pairing four or six open ends (pairedEnds), uniqueRoute (assumes one solution), and trial
//             and error (tryCell, tryEdge)
// The rules whose arguments grow add an extra cost per line, open end or step (the `extra` functions), and the costly "imagine" rules are
// left out of prefix closures (see closure()).
// Bookkeeping (cost 1, charged once per step in which it had something to do): a segment touching a shaded cell is off, a segment makes its
// two cells loop, a loop cell with two segments has no others.
import {
  UNKNOWN, SHADED, LOOP, CLUE, E_UNKNOWN, E_ON, E_OFF, oppositeDir,
  initialState, cloneState, edgeCells, checkSolved,
} from './logic.js';

export const TIERS = ['Beginner', 'Medium', 'Hard', 'Expert'];

export const TIER_INFO = {
  Beginner: { name: 'Beginner', blurb: 'clue counting, cells next to boxes, dead ends, corners and corridors, and not closing the loop early' },
  Medium: { name: 'Medium', blurb: "placing a clue's boxes, and imagining one box, dot or segment and following a short chain of forced lines" },
  Hard: { name: 'Hard', blurb: 'long chains of forced lines, counting with bounds along facing clues, parity of large areas, and at worst trial and error' },
  Expert: { name: 'Expert', blurb: "the hint rules can't finish it: somewhere you have to look further ahead than Hint can explain" },
};

export const beyondHints = (puzzle) => puzzle.rules === 'unsolved';

export const UNDETERMINED_WEIGHT = 100; // per cell the rules leave undecided (about one Hard step)

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

/** Segments on at every cell, as an array (for the rules that ask about many cells while the segments stay as they are). */
function segmentCounts(P, st) {
  const onc = new Int8Array(P.N);
  for (let x = 0; x < P.numEdges; x++) if (st.e[x] === E_ON) { const a = x >> 1; onc[a]++; onc[(x & 1) ? a + P.cols : a + 1]++; }
  return onc;
}

/** exits() with the segment counts handed in (`onc` from segmentCounts: valid while no segment is added or removed). */
function exitsWith(P, st, i, onc) {
  let n = 0;
  for (let d = 0; d < 4; d++) {
    const x = P.ed[i * 4 + d];
    if (x < 0) continue;
    const j = P.nb[i * 4 + d];
    if (st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
    if (st.e[x] !== E_ON && onc[j] >= 2) continue;          // a full cell takes no more segments
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
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    const ra = find(a), rb = find(b);
    if (ra === rb) cycleRoot = ra; else parent[ra] = rb;
  }
  return { find, cycleRoot: cycleRoot >= 0 ? find(cycleRoot) : -1 };
}

/** Apply [['c'|'e', index, value], ...]. Returns false if one disagrees with what is already known. */
export function applySets(st, sets) {
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

/** oddOpenEnds with the size of the area: { ends, area } (area = the cells of that group, the cells that still need lines), or null. */
export function oddOpenGroup(P, st) {
  const g = openEndGroups(P, st);
  if (!g) return null;
  const { find, ends, needy } = g;
  const count = new Map();
  for (const i of ends) { const r = find(i); count.set(r, (count.get(r) || 0) + 1); }
  let best = null;
  for (const [r, c] of count) if (c % 2 && (!best || c < best[1])) best = [r, c];
  if (!best) return null;
  let area = 0;
  for (let i = 0; i < P.N; i++) if (needy[i] && find(i) === best[0]) area++;
  return { ends: ends.filter((i) => find(i) === best[0]), area };
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
    if (P.clues[k].n < 0) continue;                      // a void cell has no count
    let s = 0, u = 0;
    for (const i of P.rays[k]) { if (st.cell[i] === SHADED) s++; else if (st.cell[i] === UNKNOWN) u++; }
    if (s > P.clues[k].n || s + u < P.clues[k].n) return true;
  }
  if (balanceBroken(P, st)) return true;
  if (chokepointCheck(P, st)) return true;              // a single cell between two parts that both hold loop cells
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
    { const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1; if (st.cell[a] === UNKNOWN) sets.push(setCell(a, LOOP)); if (st.cell[b] === UNKNOWN) sets.push(setCell(b, LOOP)); }
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
    if (cl.n < 0) return;
    const { s, unk } = clueCounts(P, st, k);
    if (s === cl.n && unk.length) out.push(firing(unk.map((i) => setCell(i, LOOP)), { clue: k, cells: unk }));
  });
  return out;
}

function clueFull(P, st) {
  const out = [];
  P.clues.forEach((cl, k) => {
    if (cl.n < 0) return;
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

/**
 * Imagine a box at a cell: boxes never touch, so its open neighbours would be dots. If that takes so many open cells out of a clue's
 * line that it could no longer reach its number (the boxes it has plus the open cells it has left are fewer than it needs), the cell
 * is a dot. Seen at a glance next to a clue: "a box here leaves the clue no room". With `withLines`, a neighbour of the box that is left
 * with exactly two ways out (a dot on the edge, a box on its other side) uses both, so the cells at the ends of those lines are dots too.
 */
function boxStarves(P, st, withLines) {
  const cluesAt = Array.from({ length: P.N }, () => []);         // the clues whose line (or region) holds each cell
  const have = new Int16Array(P.clues.length), open = new Int16Array(P.clues.length);
  P.clues.forEach((cl, k) => {
    if (cl.n < 0) return;
    for (const i of P.rays[k]) {
      cluesAt[i].push(k);
      if (st.cell[i] === SHADED) have[k]++; else if (st.cell[i] === UNKNOWN) open[k]++;
    }
  });
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const touched = [i];                                         // the cell and the open neighbours that would turn into dots
    const forced = [];                                 // cells whose line is then forced (a dot left with exactly two ways out uses both), and the dots that force them
    const viaOf = new Map();
    for (let d = 0; d < 4; d++) {
      const j = P.nb[i * 4 + d];
      if (j < 0 || st.cell[j] === SHADED) continue;
      if (st.cell[j] === UNKNOWN) touched.push(j);
      const outs = [];                                           // j's ways out once i is a box
      for (let e = 0; e < 4; e++) {
        const x = P.ed[j * 4 + e], m = P.nb[j * 4 + e];
        if (x < 0 || m === i || st.e[x] === E_OFF || st.cell[m] === SHADED) continue;
        if (st.e[x] !== E_ON && onCount(P, st, m) >= 2) continue;
        outs.push(m);
      }
      if (withLines && outs.length === 2) for (const m of outs) if (st.cell[m] === UNKNOWN) { if (!viaOf.has(m)) { viaOf.set(m, []); forced.push(m); } viaOf.get(m).push(j); }
    }
    touched.push(...forced);
    const lost = new Map();                                      // clue -> how many of its open cells the box takes away
    for (const j of touched) for (const k of cluesAt[j]) lost.set(k, (lost.get(k) || 0) + 1);
    for (const [k, gone] of lost) {
      const boxes = have[k] + (cluesAt[i].includes(k) ? 1 : 0), room = open[k] - gone;
      if (boxes + room >= P.clues[k].n) continue;
      const dots = touched.slice(1).filter((j) => cluesAt[j].includes(k)).sort((a, b) => a - b);
      const chain = dots.filter((j) => forced.includes(j));        // the dots that come from a neighbour's forced line, not from touching the box
      const through = [...new Set(chain.flatMap((j) => viaOf.get(j)))].sort((a, b) => a - b);
      out.push(firing([setCell(i, LOOP)], { cell: i, clue: k, dots, most: boxes + room, ...(chain.length ? { chain, through } : {}) }));
      break;
    }
  }
  return out;
}

/** Medium: a box's open neighbours are dots (boxes never touch), and that alone leaves a clue short of room. */
const boxStarvesClue = (P, st) => boxStarves(P, st, false);
/**
 * Hard: the same, but the dots come further: a neighbour of the box left with exactly two ways out must use both, and the cells at the far
 * ends of those lines are dots too. Only the cells the plain rule (boxStarvesClue) misses; info.chain/through say how the lines lead there.
 */
const boxStarvesClueByLines = (P, st) => {
  const plain = new Set(boxStarves(P, st, false).map((f) => f.info.cell));
  return boxStarves(P, st, true).filter((f) => !plain.has(f.info.cell));
};

// ---- ranges of cells with a known number of shaded cells

const cellOfClue = (P, cl) => cl.r * P.cols + cl.c;
/** Position of cell i along direction d (grows in the direction the arrow points). */
function posAlong(P, d, i) {
  const r = (i / P.cols) | 0, c = i % P.cols;
  return d === 0 ? -r : d === 1 ? c : d === 2 ? r : d === 3 ? -c : d === 4 || d === 5 ? c : -c;       // (a diagonal grows with its column)
}
const sameLine = (P, d, i, j) => {
  const ri = (i / P.cols) | 0, rj = (j / P.cols) | 0, ci = i % P.cols, cj = j % P.cols;
  return d === 1 || d === 3 ? ri === rj : d === 0 || d === 2 ? ci === cj : d === 4 || d === 6 ? ri + ci === rj + cj : ri - ci === rj - cj;   // (diagonals: up-right/down-left share r + c, the others r - c)
};
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

/**
 * rangeDeduce for any set of cells (a region of a regional puzzle), where the cells touch in two dimensions instead of in a line:
 * every way to put between kmin and kmax shaded cells in `cells`, no two touching, and what is the same in all of them. The cells that
 * can still be shaded split into groups that touch each other; each group's independent sets are listed (regions are small) and counted
 * by size, and the groups are combined by size. Gives up (returns nothing) on a group too big to list.
 */
const REGION_CAP = 400000;
export function regionDeduce(P, st, cells, kmin, kmax) {
  let s = 0;
  const elig = [];
  for (const i of cells) {
    if (st.cell[i] === SHADED) s++;
    else if (st.cell[i] === UNKNOWN && !touchesShaded(P, st, i)) elig.push(i);
  }
  const lo = Math.max(0, kmin - s), hi = Math.min(kmax - s, elig.length);
  if (kmax - s < 0 || lo > hi || !elig.length) return [];
  // groups of eligible cells that touch each other
  const at = new Map(elig.map((i, q) => [i, q]));
  const groupOf = new Int32Array(elig.length).fill(-1);
  const groups = [];
  for (let q0 = 0; q0 < elig.length; q0++) {
    if (groupOf[q0] >= 0) continue;
    const g = groups.length, members = [q0];
    groupOf[q0] = g;
    for (let h = 0; h < members.length; h++) {
      for (let d = 0; d < 4; d++) {
        const j = P.nb[elig[members[h]] * 4 + d];
        const q = j >= 0 ? at.get(j) : undefined;
        if (q !== undefined && groupOf[q] < 0) { groupOf[q] = g; members.push(q); }
      }
    }
    if (members.length > 30) return [];
    groups.push(members);
  }
  let nodes = 0;
  const sizes = [], withCell = [];                         // per group: placements by size, and per cell the placements it is in by size
  for (const members of groups) {
    const m = members.length;
    const local = new Map(members.map((q, x) => [elig[q], x]));
    const nbMask = members.map((q) => { let mask = 0; for (let d = 0; d < 4; d++) { const x = local.get(P.nb[elig[q] * 4 + d]); if (x !== undefined) mask |= 1 << x; } return mask; });
    const cnt = new Float64Array(m + 1), wc = Array.from({ length: m }, () => new Float64Array(m + 1));
    let over = false;
    const rec = (x, chosen, size) => {
      if (over) return;
      if (x === m) {
        if (++nodes > REGION_CAP) { over = true; return; }
        cnt[size]++;
        for (let b = 0; b < m; b++) if (chosen & (1 << b)) wc[b][size]++;
        return;
      }
      rec(x + 1, chosen, size);
      if (!(nbMask[x] & chosen)) rec(x + 1, chosen | (1 << x), size + 1);
    };
    rec(0, 0, 0);
    if (over) return [];
    sizes.push(cnt); withCell.push(wc);
  }
  const times = (a, b) => { const out = new Float64Array(a.length + b.length - 1); for (let x = 0; x < a.length; x++) if (a[x]) for (let y = 0; y < b.length; y++) out[x + y] += a[x] * b[y]; return out; };
  const product = (skip) => { let acc = Float64Array.of(1); sizes.forEach((c, g) => { if (g !== skip) acc = times(acc, c); }); return acc; };
  const validSum = (poly, shift) => { let t = 0; for (let c = lo; c <= hi; c++) { const k = c - shift; if (k >= 0 && k < poly.length) t += poly[k]; } return t; };
  const total = validSum(product(-1), 0);
  if (!total) return [];
  const sets = [];
  groups.forEach((members, g) => {
    const others = product(g);
    members.forEach((q, x) => {
      let w = 0;
      for (let size = 1; size < withCell[g][x].length; size++) if (withCell[g][x][size]) w += withCell[g][x][size] * validSum(others, size);
      if (w === total) sets.push(setCell(elig[q], SHADED));
      else if (w === 0) sets.push(setCell(elig[q], LOOP));
    });
  });
  return sets;
}

/**
 * The special case of cluePlacements a person sees at a glance: a clue that still needs r >= 2 boxes whose open cells (not touching a box,
 * not a dot or a clue) form runs that can hold exactly r boxes between them, every run an odd length 2m-1 (it holds m boxes only on its
 * every other cell). Boxes cannot touch, so each run's boxes sit on its 1st, 3rd, ... cell and the cells between them are dots. With one run
 * this is a k-arrow with just enough room (Nikoli's setters love them); with several, the dots and clues between the runs fix the room.
 */
function clueTight(P, st) {
  const out = [];
  P.clues.forEach((cl, k) => {
    if (cl.n < 2 || cl.region) return;                    // (also skips voids; a region is not a line, so it has no runs)
    let boxes = 0, run = [];
    const runs = [];
    for (const i of P.rays[k]) {
      if (st.cell[i] === SHADED) boxes++;
      if (st.cell[i] === UNKNOWN && !touchesShaded(P, st, i)) {
        if (run.length && !adjacent(P, run[run.length - 1], i)) { runs.push(run); run = []; }   // rays skip other clue cells: a gap
        run.push(i);
      } else { if (run.length) runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    const need = cl.n - boxes;
    if (need < 2 || !runs.length || runs.some((r) => r.length % 2 === 0)) return;
    if (runs.reduce((a, r) => a + (r.length + 1) / 2, 0) !== need) return;
    out.push(firing(runs.flatMap((r) => r.map((i, q) => (q % 2 === 0 ? setCell(i, SHADED) : setCell(i, LOOP)))), { clue: k, cells: runs.flat(), need, runs: runs.length }));
  });
  return out;
}

/** Every way to place the clue's shaded cells without two touching includes (or excludes) a cell. */
function cluePlacements(P, st) {
  const out = [];
  P.clues.forEach((cl, k) => {
    if (cl.n < 0) return;
    const sets = (cl.region ? regionDeduce : rangeDeduce)(P, st, P.rays[k], cl.n, cl.n);
    if (sets.length) out.push(firing(sets, { clue: k, cells: P.rays[k] }));
  });
  return out;
}

/**
 * cluePlacements that also throws out the placements a person sees fail at a glance: one that boxes in a neighbour so it is left with
 * fewer than two ways out (for example a 2-arrow down the right edge with room in rows 12, 14 and 20: boxes in rows 12 and 14 would
 * leave the edge cell in row 13 with just one way out, so one box must go in row 20). Boxes in the placements are tried against the
 * dots they create: the neighbours of every box must keep two exits. Gives up on a line with too many placements to look through.
 */
const PLACEMENT_CAP = 3000;
function placementDeadEnd(P, st) {
  const out = [];
  const onc = segmentCounts(P, st);                         // the boxes tried below are only cells: the segments stay as they are
  // A placement is rejected when some neighbour of one of its boxes is left with fewer than two exits. That is kept up to date as boxes
  // are put down and taken back (adjCnt: how many chosen boxes touch a cell; viol: it is such a neighbour and has too few exits; bad: how
  // many cells violate), so a leaf of the search is judged in constant time instead of re-checking every box (the search itself, the leaves
  // it visits and the node cap are exactly as before). The boxes are marked on `st` while the search is below them.
  const adjCnt = new Int8Array(P.N), viol = new Uint8Array(P.N);
  let bad = 0;
  const refresh = (u) => {
    const v = adjCnt[u] > 0 && st.cell[u] !== SHADED && exitsWith(P, st, u, onc) < 2 ? 1 : 0;
    if (v !== viol[u]) { bad += v - viol[u]; viol[u] = v; }
  };
  const mark = (i, on) => {
    st.cell[i] = on ? SHADED : UNKNOWN;
    for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0) adjCnt[j] += on ? 1 : -1; }
    refresh(i);
    for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0) refresh(j); }
  };
  P.clues.forEach((cl, k) => {
    if (cl.n < 0) return;
    const ray = P.rays[k];
    let have = 0;
    const elig = [];
    for (const i of ray) {
      if (st.cell[i] === SHADED) have++;
      else if (st.cell[i] === UNKNOWN && !touchesShaded(P, st, i)) elig.push(i);
    }
    const need = cl.n - have;
    if (need < 1 || elig.length < need) return;
    const chosen = [];
    const hits = new Map(elig.map((i) => [i, 0]));          // in how many surviving placements each cell is a box
    let total = 0, nodes = 0, gaveUp = false;
    const go = (from) => {
      if (gaveUp) return;
      if (chosen.length === need) {
        if (bad === 0) { total++; for (const i of chosen) hits.set(i, hits.get(i) + 1); }
        return;
      }
      if (++nodes > PLACEMENT_CAP) { gaveUp = true; return; }
      for (let q = from; q < elig.length; q++) {
        if (elig.length - q < need - chosen.length) break;
        if (chosen.length && (cl.region ? touchesShaded(P, st, elig[q]) : adjacent(P, chosen[chosen.length - 1], elig[q]))) continue;   // (the chosen boxes are marked on st)
        chosen.push(elig[q]); mark(elig[q], true);
        go(q + 1);
        mark(elig[q], false); chosen.pop();
      }
    };
    go(0);
    if (gaveUp || !total) return;                          // no placement left is the contradiction check's business
    const sets = [];
    for (const i of elig) { const h = hits.get(i); if (h === total) sets.push(setCell(i, SHADED)); else if (h === 0) sets.push(setCell(i, LOOP)); }
    if (sets.length) out.push(firing(sets, { clue: k, cells: ray }));
  });
  return out;
}

/**
 * Two clues in one line pointing the same way: the second one's cells are part of the first one's line, so the cells
 * between them hold exactly (first number - second number) shaded cells.
 */
function sameDirection(P, st, one) {
  const out = [];
  for (const { a, b, count, between } of arrowPairs(P).same) {
    if ((between.length === 1) !== one) continue;
    const sets = rangeDeduce(P, st, between, count, count);
    if (sets.length) out.push(firing(sets, { clue: a, other: b, count, cells: between }));
  }
  return out;
}

/**
 * The pairs of arrows the two line rules below look at. They depend only on the puzzle, so they are worked out once and remembered on it
 * (the rules run on every step of every rating, and used to redo this for every pair of clues each time: 15% of rating a 20x36 board).
 *   same: B is further along A's line and points the same way (A's number is at least B's); between = A's cells before B
 *   face: B is further along A's line and points back at A; M between them, R beyond B in A's line, L beyond A in B's line
 * Both lists keep the order the nested loops over the clues used to produce.
 */
function arrowPairs(P) {
  if (P._arrowPairs) return P._arrowPairs;
  const same = [], face = [];
  P.clues.forEach((A, a) => {
    P.clues.forEach((B, b) => {
      if (a === b || A.n < 0 || B.n < 0 || A.region || B.region) return;
      const sameWay = A.d === B.d, facing = B.d === oppositeDir(A.d);
      if (!sameWay && !facing) return;
      const ia = cellOfClue(P, A), ib = cellOfClue(P, B);
      if (!sameLine(P, A.d, ia, ib) || posAlong(P, A.d, ib) <= posAlong(P, A.d, ia)) return;
      if (sameWay) {
        const count = A.n - B.n;
        if (count < 0) return;
        same.push({ a, b, count, between: P.rays[a].filter((i) => posAlong(P, A.d, i) < posAlong(P, A.d, ib)) });
      } else {
        const pa = posAlong(P, A.d, ia), pb = posAlong(P, A.d, ib);
        face.push({ a, b, A, B,
          M: P.rays[a].filter((i) => posAlong(P, A.d, i) < pb),
          R: P.rays[a].filter((i) => posAlong(P, A.d, i) > pb),
          L: P.rays[b].filter((i) => posAlong(P, A.d, i) < pa) });
      }
    });
  });
  return (P._arrowPairs = { same, face });
}
const rangeSameOne = (P, st) => sameDirection(P, st, true);     // a single cell between them: box or dot by the difference of the numbers
const rangeSame = (P, st) => sameDirection(P, st, false);

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
  for (const { a, b, A, B, M, R, L } of arrowPairs(P).face) {
    const [mnM, mxM] = rangeBounds(P, st, M), [mnR, mxR] = rangeBounds(P, st, R), [mnL, mxL] = rangeBounds(P, st, L);
    const lo = Math.max(mnM, A.n - mxR, B.n - mxL), hi = Math.min(mxM, A.n - mnR, B.n - mnL);
    if (lo > hi) continue;
    const exact = ['R', 'L', 'M'].find((k) => ({ M: mnM === mxM, R: mnR === mxR, L: mnL === mxL })[k]);
    const isKnown = exact !== undefined && lo === hi;
    if (isKnown !== known) continue;
    const sets = [
      ...rangeDeduce(P, st, M, lo, hi),
      ...rangeDeduce(P, st, R, A.n - hi, A.n - lo),
      ...rangeDeduce(P, st, L, B.n - hi, B.n - lo),
    ];
    if (!sets.length) continue;
    const info = { clue: a, other: b, between: [lo, hi], cells: [...M, ...R, ...L], bounds: { M: [mnM, mxM], R: [mnR, mxR], L: [mnL, mxL] } };
    if (isKnown) { info.known = exact; info.counts = { M: lo, R: A.n - lo, L: B.n - lo }; }
    out.push(firing(sets, info));
  }
  return out;
}
const rangeFacingKnown = (P, st) => facing(P, st, true);
const rangeFacing = (P, st) => facing(P, st, false);

/**
 * The "lines only" consequences of a position: shaded cells make their neighbours loop, a loop cell with exactly two
 * exits uses both, a cell with two lines has no more. No clue reasoning. Returns the first cell that ends up with
 * three lines or with too few exits, or a cell of a cycle that closes the loop too early (and sets st.closedEarly), or -1. Mutates `st`.
 * Sets st.forced to the number of segments it had to draw. With `cap`, gives up (-1) as soon as it has drawn more than that many: the
 * "short chain" version, which only sees contradictions a person reaches in a few forced steps.
 * `why` (optional, for explanations): pass { off: new Map(), ev: new Map(), events: [] } and it is filled with where everything came from:
 * events[k] = { edges, deps } is a cell that had exactly two ways and so drew `edges`, because of the drawn segments `deps`; ev maps a
 * drawn segment to its event; off maps a segment ruled out by a full cell to the segments that filled it; why.fail = { cell, kind, deps }
 * is the contradiction ('three' lines, or too few 'ways') and the drawn segments it rests on. Following deps back through ev gives just
 * the lines that matter to the contradiction.
 */
export function followLines(P, st, cap = Infinity, why = null) {
  const { N, ed, nb } = P, cols = P.cols;
  // the number of segments on at each cell, kept up to date as segments are added (this used to be recounted from the four edges of a cell
  // and of each neighbour, many times per cell on every pass: the largest cost of the lookahead rules)
  const onc = new Int8Array(N);
  for (let x = 0; x < P.numEdges; x++) if (st.e[x] === E_ON) { const a = x >> 1; onc[a]++; onc[(x & 1) ? a + cols : a + 1]++; }
  let changed = false, forced = 0;
  const start = why ? { cell: Uint8Array.from(st.cell), on: Int8Array.from(onc) } : null;
  const onAt = (c) => { const o = []; for (let d = 0; d < 4; d++) { const x = ed[c * 4 + d]; if (x >= 0 && st.e[x] === E_ON) o.push(x); } return o; };
  const rootLoop = (c) => { if (start.cell[c] === LOOP || start.on[c] > 0) return true; for (let d = 0; d < 4; d++) { const j = nb[c * 4 + d]; if (j >= 0 && start.cell[j] === SHADED) return true; } return false; };
  const excludedDeps = (c) => {                                  // the drawn segments behind each way out that `c` has lost
    const o = [];
    for (let d = 0; d < 4; d++) {
      const x = ed[c * 4 + d]; if (x < 0) continue;
      const j = nb[c * 4 + d];
      if (st.e[x] === E_OFF) { const w = why.off.get(x); if (w) o.push(...w); }
      else if (st.cell[j] !== SHADED && st.e[x] !== E_ON && onc[j] >= 2) o.push(...onAt(j));
    }
    return o;
  };
  const done = (v) => { st.forced = forced; return v; };
  const putCell = (idx, v) => { if (st.cell[idx] === 0) { st.cell[idx] = v; changed = true; } };
  const putEdge = (x, v) => {
    if (st.e[x] !== 0) return;
    st.e[x] = v; changed = true;
    if (v === E_ON) { const a = x >> 1; onc[a]++; onc[(x & 1) ? a + cols : a + 1]++; forced++; }
  };
  for (let guard = 0; guard < 500; guard++) {
    changed = false;
    for (let i = 0; i < N; i++) {
      const s = st.cell[i];
      if (s === CLUE) continue;
      if (s === SHADED) {
        for (let d = 0; d < 4; d++) {
          const x = ed[i * 4 + d];
          if (x < 0) continue;
          putEdge(x, E_OFF);
          putCell(nb[i * 4 + d], LOOP);
        }
        continue;
      }
      const on = onc[i];
      if (on > 0 && s === UNKNOWN) putCell(i, LOOP);
      let ex = 0;                                                   // exits(): neighbours it could still connect to
      for (let d = 0; d < 4; d++) {
        const x = ed[i * 4 + d];
        if (x < 0) continue;
        const j = nb[i * 4 + d];
        if (st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
        if (st.e[x] !== E_ON && onc[j] >= 2) continue;              // a full cell takes no more segments
        ex++;
      }
      if ((s === LOOP || on > 0) && (on > 2 || ex < 2)) {
        if (why) why.fail = { cell: i, kind: on > 2 ? 'three' : 'ways', deps: on > 2 ? onAt(i) : [...excludedDeps(i), ...(rootLoop(i) ? [] : onAt(i))] };
        return done(i);
      }
      if (s === LOOP || on > 0) {
        const deps = why && on !== 2 && ex === 2 ? [...excludedDeps(i), ...(rootLoop(i) ? [] : onAt(i))] : null, drawn = [];
        for (let d = 0; d < 4; d++) {
          const x = ed[i * 4 + d];
          if (x < 0 || st.e[x] !== E_UNKNOWN || st.cell[nb[i * 4 + d]] === SHADED) continue;
          if (on === 2) { if (why) why.off.set(x, onAt(i)); putEdge(x, E_OFF); }
          else if (ex === 2 && onc[nb[i * 4 + d]] < 2) { putEdge(x, E_ON); drawn.push(x); } // a full neighbour is not one of the two ways out
        }
        if (why && drawn.length) { for (const x of drawn) why.ev.set(x, why.events.length); why.events.push({ edges: drawn, deps }); }
        if (forced > cap) return done(-1);
      }
    }
    for (let x = 0; x < P.numEdges; x++) {
      if (st.e[x] !== E_ON) continue;
      const a = x >> 1;
      putCell(a, LOOP); putCell((x & 1) ? a + cols : a + 1, LOOP);
    }
    if (!changed) {
      const c = closedEarly(P, st);
      if (c >= 0) { st.closedEarly = true; return done(c); }
      return done(-1);
    }
  }
  return done(-1);
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

/**
 * Imagine a cell is shaded and add the lines that forces: if some cell gets three lines (or is left stranded), it is loop.
 * `closes`: which kind of contradiction counts (true: the loop closes early; false: three lines or too few ways out; null: either).
 * `cap`: give up on a box whose lines take more than this many forced segments. The firings come shortest chain first (then by cell),
 * so Hint shows the one a person can follow most easily; info.forced is the number of segments the box forces.
 */
function shadeForces(P, st, closes, cap = Infinity) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const st2 = cloneState(st);
    st2.cell[i] = SHADED;
    const bad = followLines(P, st2, cap);
    if (bad >= 0 && (closes === null || !!st2.closedEarly === closes)) out.push(firing([setCell(i, LOOP)], { cell: i, stranded: bad, forced: st2.forced }));
  }
  return out.sort((a, b) => a.info.forced - b.info.forced || a.info.cell - b.info.cell);
}
const shadeForcesLines = (P, st) => shadeForces(P, st, false);   // a cell ends up with three lines or too few ways out
const shadeClosesLoop = (P, st) => shadeForces(P, st, true);     // the forced lines close the loop too early

// ---- how many boxes a line has room for, counting the cells a box would starve
//
// A clue's boxes never touch, and there is one more thing a person sees along a line: if the cell BETWEEN two boxes (one cell apart) is a loop cell
// with fewer than two other ways out, those two boxes cannot both stand. cluePlacements knows only that boxes do not touch, and placementDeadEnd,
// which does see this, lists every placement and gives up on a long line. Here the room is counted in one pass along the line.

/** Ways out a loop cell m would have if the cells in `skip` (boxes) were taken away. */
function exitsSkipping(P, st, m, skip) {
  let n = 0;
  for (let d = 0; d < 4; d++) {
    const x = P.ed[m * 4 + d], j = P.nb[m * 4 + d];
    if (x < 0 || j < 0 || skip.includes(j) || st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
    if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue;
    n++;
  }
  return n;
}

/**
 * The most boxes the line of an orthogonal clue can still take, in `st`: the open cells of the line (not touching a box) are lined up and the
 * best choice is counted, where two cells cannot both be boxes when they touch, or when the cell between them would be left with fewer than
 * two ways out, and a cell cannot be a box when it would leave a neighbour on the line with fewer than two. Returns { room, shaded }: the boxes
 * the line can end up with are shaded + room at the most.
 */
function lineModel(P, st, k) {
  const cl = P.clues[k], d = cl.d;
  let shaded = 0;
  const cand = [];
  for (const i of P.rays[k]) {
    if (st.cell[i] === SHADED) { shaded++; continue; }
    if (st.cell[i] !== UNKNOWN || touchesShaded(P, st, i)) continue;
    const back = P.nb[i * 4 + (d + 2) % 4], ahead = P.nb[i * 4 + d];
    if ((back >= 0 && st.cell[back] !== SHADED && exitsSkipping(P, st, back, [i]) < 2) || (ahead >= 0 && st.cell[ahead] !== SHADED && exitsSkipping(P, st, ahead, [i]) < 2)) continue;
    cand.push(i);
  }
  const conflict = (a, b) => {
    if (adjacent(P, a, b)) return true;
    const m = P.nb[a * 4 + d];                                    // one cell apart on the line, with a loop cell between
    return m >= 0 && P.nb[m * 4 + d] === b && st.cell[m] !== SHADED && exitsSkipping(P, st, m, [a, b]) < 2;
  };
  return { shaded, cand, conflict };
}

export function lineRoom(P, st, k) {
  const { shaded, cand, conflict } = lineModel(P, st, k);
  // best[t]: most boxes among the cells so far, t = which of the last two cells are boxes (bit 0: the last one, bit 1: the one before)
  let best = [0, -Infinity, -Infinity, -Infinity];
  for (let p = 0; p < cand.length; p++) {
    const next = [-Infinity, -Infinity, -Infinity, -Infinity];
    for (let t = 0; t < 4; t++) {
      const v = best[t];
      if (v === -Infinity) continue;
      const skip = (t & 1) << 1;                                  // the cell is not a box: the last one becomes "the one before"
      if (v > next[skip]) next[skip] = v;
      const clash = ((t & 1) && p > 0 && conflict(cand[p - 1], cand[p])) || ((t & 2) && p > 1 && conflict(cand[p - 2], cand[p]));
      if (!clash && v + 1 > next[skip | 1]) next[skip | 1] = v + 1;
    }
    best = next;
  }
  return { room: Math.max(...best), shaded };
}

/**
 * The open cells of a clue's line split into groups of cells that pairwise cannot both be boxes (for the hint: "each group holds at most one"),
 * taken from the first cell on. The number of groups is an upper bound on the room; it equals it for the lines the hints are about.
 */
export function roomGroups(P, st, k) {
  const { cand, conflict } = lineModel(P, st, k);
  const groups = [];
  for (const i of cand) {
    const last = groups[groups.length - 1];
    if (last && last.every((j) => conflict(j, i))) last.push(i); else groups.push([i]);
  }
  return groups;
}

const orthogonalClues = (P) => P._orthoClues || (P._orthoClues = P.clues.map((cl, k) => (cl.n >= 0 && !cl.region && cl.d < 4 ? k : -1)).filter((k) => k >= 0));

/**
 * Hard: imagine a box at a cell and follow only the lines it forces (the neighbours' dots, the cells left with two ways out, as in
 * shadeForcesLines). If some clue's line is then left without room for the boxes it still needs, counting the room with lineRoom, the cell is a
 * dot. The lines themselves are not contradictory here (that is shadeForcesLines): it is the clue that cannot place its boxes.
 * info: { cell, clue, need, room, probe } where probe is the position after the box and its forced lines.
 */
function boxStarvesClueByPlacements(P, st) {
  const out = [];
  const clues = orthogonalClues(P);
  const near = new Uint8Array(P.N);
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const probe = cloneState(st);
    probe.cell[i] = SHADED;
    if (followLines(P, probe) >= 0) continue;                    // a contradiction of the lines alone: shadeForcesLines' business
    // the clues whose line the probe changed, or whose line lies right next to a change (a cell's ways out depend on its neighbours)
    near.fill(0);
    for (let j = 0; j < P.N; j++) {
      let changed = probe.cell[j] !== st.cell[j];
      for (let d = 0; d < 4 && !changed; d++) { const x = P.ed[j * 4 + d]; if (x >= 0 && probe.e[x] !== st.e[x]) changed = true; }
      if (!changed) continue;
      near[j] = 1;
      for (let d = 0; d < 4; d++) { const m = P.nb[j * 4 + d]; if (m >= 0) near[m] = 1; }
    }
    for (const k of clues) {
      if (!P.rays[k].some((j) => near[j])) continue;
      const { room, shaded } = lineRoom(P, probe, k), need = P.clues[k].n - shaded;
      if (need > room) { out.push(firing([setCell(i, LOOP)], { cell: i, clue: k, need, room })); break; }
    }
  }
  return out;
}
/**
 * The lines that matter when a box leads to a contradiction (for the explanation, and the cost of shadeShortChain): follow the forced
 * lines (followLines with its provenance) back from the contradiction and keep only the segments it depends on. A cell that had exactly
 * two ways out draws both, but a person only needs the one that feeds the contradiction, so its partner is not counted. Returns
 *   { edges, bad, three, cells, s2 }: `edges` the segments that matter (as edge indexes, none of them drawn yet), `s2` the position after
 *   the box and everything it forces, `bad` the cell followLines found stranded. `three` is true when the picture is "some cells end up
 *   with three lines" (`cells`): `bad` itself gets three, or it has just two ways out, both forced, and one leads into a cell the forced
 *   lines already filled (the line into that cell is counted too: it is the third). Otherwise `three` is false and `cells` is empty.
 * Null when there is no contradiction, or the loop closes early. `cap`: give up on a box whose lines take more than this many segments.
 */
export function boxProof(P, st, box, cap = Infinity) {
  return hypothesisProof(P, st, [setCell(box, SHADED)], cap);
}

/** boxProof for any imagined move (`sets`, as in a firing: a box, a dot, a segment drawn or ruled out). */
export function hypothesisProof(P, st, sets, cap = Infinity) {
  const s2 = cloneState(st);
  for (const [kind, idx, v] of sets) (kind === 'c' ? s2.cell : s2.e)[idx] = v;
  const why = { off: new Map(), ev: new Map(), events: [] };
  const bad = followLines(P, s2, cap, why);
  if (bad < 0 || s2.closedEarly || !why.fail) return null;
  const need = new Set(), stack = [...why.fail.deps];
  while (stack.length) {
    const x = stack.pop(), id = why.ev.get(x);
    if (id === undefined || need.has(x)) continue;
    need.add(x);
    stack.push(...why.events[id].deps);
  }
  const out = { edges: [], bad, three: false, cells: [], s2 };
  if (why.fail.kind === 'three') { out.three = true; out.cells = [bad]; }
  else {
    const ways = [];                                             // everywhere `bad` could go, if the box's lines did not fill cells
    for (let d = 0; d < 4; d++) {
      const x = P.ed[bad * 4 + d]; if (x < 0) continue;
      const j = P.nb[bad * 4 + d];
      if (st.e[x] === E_OFF || s2.cell[j] === SHADED || s2.cell[j] === CLUE) continue;
      if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue;       // already full before the box: not a way out anyway
      ways.push([x, j]);
    }
    const full = ways.filter(([x, j]) => s2.e[x] !== E_ON && onCount(P, s2, j) >= 2);
    if (ways.length === 2 && full.length) {
      for (const [x] of full) need.add(x);
      out.three = true; out.cells = full.map(([, j]) => j);
    }
  }
  out.edges = [...need].filter((x) => st.e[x] === E_UNKNOWN).sort((a, b) => a - b);
  return out;
}

/** DRAFT: the most segments a contradiction may need (see boxProof) for shadeShortChain: two lines you can see at once. */
export const SHORT_CHAIN = 2;
const SHORT_SEARCH = 8;                       // the most segments followLines draws (needed or not) before shadeShortChain gives up on a box
/**
 * A box makes some cell end up with three lines, and only a couple of lines are needed to get there (SHORT_CHAIN). The firings come
 * fewest lines first; the cell is a dot. A contradiction of another kind (a cell left stranded, the loop closing) is left to the
 * unlimited rules, shadeForcesLines and shadeClosesLoop, which are Hard.
 */
function shadeShortChain(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const probe = cloneState(st); probe.cell[i] = SHADED;
    if (followLines(P, probe, SHORT_SEARCH) < 0) continue;       // (cheap check first; the trace below costs more)
    const pr = boxProof(P, st, i, SHORT_SEARCH);
    if (pr && pr.three && pr.edges.length <= SHORT_CHAIN) out.push(firing([setCell(i, LOOP)], { cell: i, stranded: pr.bad, forced: pr.edges.length }));
  }
  return out.sort((a, b) => a.info.forced - b.info.forced || a.info.cell - b.info.cell);
}

/**
 * Like shadeForcesLines, for a segment: imagine it missing (or drawn) next to a loop cell, add the lines that forces, and if
 * some cell ends up with three lines or too few ways out, the segment is there (or is not). A loop cell with three ways out
 * that cannot skip one of them without a contradiction must use it.
 */
function segmentForces(P, st, closes) {
  const out = [];
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
    if (st.cell[a] !== LOOP && st.cell[b] !== LOOP && !onCount(P, st, a) && !onCount(P, st, b)) continue; // next to the known loop only
    for (const v of [E_OFF, E_ON]) {
      const st2 = cloneState(st);
      st2.e[x] = v;
      const bad = followLines(P, st2);
      if (bad >= 0) {
        if (!!st2.closedEarly === closes) out.push(firing([setEdge(x, v === E_OFF ? E_ON : E_OFF)], { edge: x, assumed: v === E_OFF ? 'off' : 'on', stranded: bad, forced: st2.forced }));
        break;
      }
    }
  }
  return out;
}
const segmentForcesLines = (P, st) => segmentForces(P, st, false);
const segmentClosesLoop = (P, st) => segmentForces(P, st, true);

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
    const linkRoots = new Map();   // for each such pair: the paths of the chains that join them, over every valid pairing
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
      for (const c of chains) {
        const k = `${Math.min(c.a, c.b)},${Math.max(c.a, c.b)}`;
        if (!linkRoots.has(k)) linkRoots.set(k, new Set());
        for (const r of c.roots) linkRoots.get(k).add(r);
      }
      common = common === null ? keys : new Set([...common].filter((k) => keys.has(k)));
    }
    if (!valid || !common) continue;
    for (const key of common) {
      const [ab, outside] = key.split('|');
      if (outside !== '1') continue;
      const [a, b] = ab.split(',').map(Number);
      if (inGroup.has(a) || inGroup.has(b)) continue;
      // a and b are the two ends of one line, whatever the pairing: everything that would join them (or only be able to) is out
      const info = { pair: es.slice(0, 2), ends: es, far: [a, b], cells: group, k: es.length };
      const waysOut = (c, ignore = -1) => {
        const ex = [];
        for (let d = 0; d < 4; d++) {
          const x = P.ed[c * 4 + d];
          const j = P.nb[c * 4 + d];
          if (x < 0 || j === ignore || st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
          if (st.e[x] !== E_ON && onCount(P, st, j) >= 2) continue;
          ex.push({ x, j });
        }
        return ex;
      };
      const isAB = (e) => e.length >= 2 && [a, b].every((t) => e.some((o) => o.j === t));
      for (let d = 0; d < 4; d++) {                      // a segment between them
        const x = P.ed[a * 4 + d];
        if (x < 0 || P.nb[a * 4 + d] !== b || st.e[x] !== E_UNKNOWN) continue;
        out.push(firing([setEdge(x, E_OFF)], { ...info, kind: 'edge', edge: x }));
      }
      for (let c = 0; c < P.N; c++) {
        if (c === a || c === b || inGroup.has(c)) continue;
        if (st.cell[c] === UNKNOWN && onCount(P, st, c) === 0) {
          const ex = waysOut(c);
          if (ex.length === 2 && isAB(ex)) out.push(firing([setCell(c, SHADED)], { ...info, kind: 'box', cell: c }));   // its only two ways out
          for (let d = 0; d < 4; d++) {                  // a box here would leave a neighbour with only those two ways out
            const n = P.nb[c * 4 + d];
            if (n < 0 || n === a || n === b || st.cell[n] !== UNKNOWN || onCount(P, st, n) > 0) continue;
            const exn = waysOut(n, c);
            if (exn.length === 2 && isAB(exn)) { out.push(firing([setCell(c, LOOP)], { ...info, kind: 'dot', cell: c, neighbor: n })); break; }
          }
        } else if (st.cell[c] === LOOP && onCount(P, st, c) === 0) {
          const ex = waysOut(c);
          // (c itself lies on the loop that would close, so it must not be what makes the loop "not finished": another loop cell must lie outside)
          const roots = linkRoots.get(ab);
          let other = false;
          for (let i = 0; i < P.N && !other; i++) if (i !== c && st.cell[i] === LOOP && !inGroup.has(i) && !roots.has(path(i))) other = true;
          if (ex.length === 3 && isAB(ex) && other) {    // three ways out, two of them lead to a and b: it uses the third
            const third = ex.find((o) => o.j !== a && o.j !== b);
            out.push(firing([setEdge(third.x, E_ON)], { ...info, kind: 'third', cell: c, third: third.j }));
          }
        }
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
      const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
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
      for (const x of sol) { const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1; adj.get(a).push(b); adj.get(b).push(a); }
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


/**
 * Chessboard balance (regional puzzles; needs the whole board in mind). Colour the cells like a chessboard: the loop alternates colours, so it
 * visits as many light cells as dark ones, and the boxes (the only cells off the loop) must leave the colours level: light boxes minus
 * dark boxes = (light cells) - (dark cells). With the numbers it goes further: the boxes in numbered regions are known, and an unnumbered
 * region holds between what is already there and all its open cells, so the total number of boxes lies in a range, and with the difference
 * fixed that pins how many boxes sit on each colour. When that number is as low (or high) as it can be, every open cell of the colour is a
 * dot (or a box). Also exported as `colorBalanceFirings` so tools can ask about arrow puzzles (where clue cells are off the loop too, and
 * only the first, loop-only, form applies).
 */
function balanceState(P, st) {
  const { cols, N } = P;
  const kind = [{ cells: [], box: 0, total: 0 }, { cells: [], box: 0, total: 0 }];     // by colour: open cells, boxes so far, cells on the board
  for (let i = 0; i < N; i++) {
    if (st.cell[i] === CLUE) continue;
    const c = kind[(((i / cols) | 0) + (i % cols)) & 1];
    c.total++;
    if (st.cell[i] === SHADED) c.box++; else if (st.cell[i] === UNKNOWN) c.cells.push(i);
  }
  const D = kind[0].total - kind[1].total;                          // light boxes - dark boxes must equal this
  let tLo = 0, tHi = N;                                              // the total number of boxes, as far as the numbers say
  if (P.regional) {
    let numbered = 0, sure = 0, open = 0;
    const has = new Uint8Array(P.regionCells.length);
    P.clues.forEach((cl, k) => { has[P.regionOf[cl.r * cols + cl.c]] = 1; numbered += cl.n; });
    P.regionCells.forEach((cells, g) => { if (has[g]) return; for (const i of cells) { if (st.cell[i] === SHADED) sure++; else if (st.cell[i] === UNKNOWN) open++; } });
    tLo = numbered + sure; tHi = numbered + sure + open;
  }
  // dark boxes bb: light boxes = bb + D, total = 2 bb + D
  const lo = Math.max(kind[1].box, kind[0].box - D, Math.ceil((tLo - D) / 2));
  const hi = Math.min(kind[1].box + kind[1].cells.length, kind[0].box + kind[0].cells.length - D, Math.floor((tHi - D) / 2));
  return { light: kind[0], dark: kind[1], D, lo, hi };
}
/** The chessboard balance cannot be met (a regional puzzle): part of the contradiction check, so trial and error knows it too. */
const balanceBroken = (P, st) => { const b = balanceState(P, st); return b.lo > b.hi; };

export function colorBalanceFirings(P, st) {
  const { light, dark, D, lo, hi } = balanceState(P, st);
  if (lo > hi) return [];                                           // no way to balance: the contradiction check's business
  const out = [], sets = [];
  const force = (cells, value) => { for (const i of cells) sets.push(setCell(i, value)); };
  if (lo === hi) {
    if (hi === dark.box && dark.cells.length) force(dark.cells, LOOP);
    else if (hi === dark.box + dark.cells.length && dark.cells.length) force(dark.cells, SHADED);
    if (hi + D === light.box && light.cells.length) force(light.cells, LOOP);
    else if (hi + D === light.box + light.cells.length && light.cells.length) force(light.cells, SHADED);
  } else {                                                          // a range: only an end of it can still force a whole colour
    if (hi === dark.box && dark.cells.length) force(dark.cells, LOOP);
    if (lo === dark.box + dark.cells.length && dark.cells.length) force(dark.cells, SHADED);
    if (hi + D === light.box && light.cells.length) force(light.cells, LOOP);
    if (lo + D === light.box + light.cells.length && light.cells.length) force(light.cells, SHADED);
  }
  if (sets.length) out.push(firing(sets, { cells: sets.map((x) => x[1]), light: [light.box, light.box + light.cells.length], dark: [dark.box, dark.box + dark.cells.length], diff: D, range: [lo, hi] }));
  return out;
}
const colorBalance = (P, st) => colorBalanceFirings(P, st);         // regional puzzles, and arrow puzzles too (rare there: no total box count)


/**
 * Two neighbouring numbered regions at once (regional puzzles). Boxes cannot touch, so a box on one side of a border rules out boxes on the
 * other, and a region's own placements may look fine alone while the pair has fewer ways: list every way to put the two numbers of boxes
 * in the two regions' open cells, none touching, and a cell that is a box in all of them (or in none) is decided. Pairs whose open cells
 * are too many to list are skipped.
 */
const PAIR_CAP = 200000, PAIR_CELLS = 26;
export function regionPairs(P, st) {
  if (!P.regional) return [];
  const out = [];
  const clueOf = new Map(P.clues.map((cl, k) => [P.regionOf[cl.r * P.cols + cl.c], k]));
  const pairs = new Set();
  for (let i = 0; i < P.N; i++) {
    const a = P.regionOf[i];
    if (!clueOf.has(a)) continue;
    for (const j of [i + 1, i + P.cols]) {
      if (j >= P.N || (j === i + 1 && j % P.cols === 0)) continue;
      const b = P.regionOf[j];
      if (a !== b && clueOf.has(b)) pairs.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
  }
  for (const key of pairs) {
    const [a, b] = key.split(',').map(Number);
    const need = [P.clues[clueOf.get(a)].n, P.clues[clueOf.get(b)].n], have = [0, 0];
    const elig = [], reg = [];
    [a, b].forEach((g, q) => {
      for (const i of P.regionCells[g]) {
        if (st.cell[i] === SHADED) have[q]++;
        else if (st.cell[i] === UNKNOWN && !touchesShaded(P, st, i)) { elig.push(i); reg.push(q); }
      }
    });
    const want = [need[0] - have[0], need[1] - have[1]];
    if (want[0] < 0 || want[1] < 0 || elig.length > PAIR_CELLS || want[0] + want[1] === 0 && !elig.length) continue;
    if (want[0] > elig.filter((_, q) => reg[q] === 0).length || want[1] > elig.filter((_, q) => reg[q] === 1).length) continue;
    const m = elig.length, at = new Map(elig.map((i, q) => [i, q]));
    const nbMask = elig.map((i) => { let mask = 0; for (let d = 0; d < 4; d++) { const q = at.get(P.nb[i * 4 + d]); if (q !== undefined) mask |= 1 << q; } return mask; });
    const hits = new Float64Array(m); let total = 0, nodes = 0, over = false;
    const rec = (x, chosen, c0, c1) => {
      if (over) return;
      if (c0 > want[0] || c1 > want[1]) return;
      if (x === m) {
        if (c0 !== want[0] || c1 !== want[1]) return;
        if (++nodes > PAIR_CAP) { over = true; return; }
        total++; for (let q = 0; q < m; q++) if (chosen & (1 << q)) hits[q]++;
        return;
      }
      if (++nodes > PAIR_CAP) { over = true; return; }
      rec(x + 1, chosen, c0, c1);
      if (!(nbMask[x] & chosen)) rec(x + 1, chosen | (1 << x), c0 + (reg[x] === 0 ? 1 : 0), c1 + (reg[x] === 1 ? 1 : 0));
    };
    rec(0, 0, 0, 0);
    if (over || !total) continue;
    const sets = [];
    for (let q = 0; q < m; q++) { if (hits[q] === total) sets.push(setCell(elig[q], SHADED)); else if (hits[q] === 0) sets.push(setCell(elig[q], LOOP)); }
    if (sets.length) out.push(firing(sets, { clue: clueOf.get(a), other: clueOf.get(b), cells: elig }));
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
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
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
    const g = oddOpenGroup(P, st2);
    if (g) out.push(firing([setCell(i, LOOP)], { cell: i, assumed: 'shaded', ends: g.ends, area: g.area }));
  }
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
    const off = cloneState(st); off.e[x] = E_OFF;
    const gOff = oddOpenGroup(P, off);
    if (gOff) { out.push(firing([setEdge(x, E_ON)], { edge: x, assumed: 'off', ends: gOff.ends, area: gOff.area })); continue; }
    const on = cloneState(st); on.e[x] = E_ON; on.cell[a] = LOOP; on.cell[b] = LOOP;
    const gOn = oddOpenGroup(P, on);
    if (gOn) out.push(firing([setEdge(x, E_OFF)], { edge: x, assumed: 'on', ends: gOn.ends, area: gOn.area }));
  }
  // smallest areas first: the easiest to see
  return out.sort((p, q) => p.info.ends.length - q.info.ends.length || p.info.area - q.info.area);
}

// ---- splits by size: the easy cases of the forced-lines and parity rules are Medium (see the table)

/** The most lines that may matter (boxProof) for shadeFewLines, and how far followLines may draw before it gives up on a box. */
export const FEW_LINES = 3;
const FEW_SEARCH = 16;
/** shadeForcesLines (three lines or a stranded cell, not the loop closing) when at most FEW_LINES of the forced lines matter. */
function shadeFewLines(P, st) {
  const out = [];
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const probe = cloneState(st); probe.cell[i] = SHADED;
    if (followLines(P, probe, FEW_SEARCH) < 0 || probe.closedEarly) continue;
    const pr = boxProof(P, st, i, FEW_SEARCH);
    if (pr && pr.edges.length <= FEW_LINES) out.push(firing([setCell(i, LOOP)], { cell: i, stranded: pr.bad, forced: pr.edges.length }));
  }
  return out.sort((a, b) => a.info.forced - b.info.forced || a.info.cell - b.info.cell);
}

/** The lines a segment hypothesis needs to reach its contradiction (hypothesisProof), or Infinity. */
function segmentNeeded(P, st, info) {
  const pr = hypothesisProof(P, st, [setEdge(info.edge, info.assumed === 'off' ? E_OFF : E_ON)]);
  return pr ? pr.edges.length : Infinity;
}
/** The most lines that may matter for segmentShortChain. */
export const SEGMENT_SHORT = 2;
/** segmentForcesLines when at most SEGMENT_SHORT of the forced lines matter. */
function segmentShortChain(P, st) {
  return segmentForcesLines(P, st)
    .filter((f) => f.info.forced <= 4 * SEGMENT_SHORT && segmentNeeded(P, st, f.info) <= SEGMENT_SHORT)
    .sort((a, b) => a.info.forced - b.info.forced);
}

/** parityForces when the area cut off is a small pocket: at most POCKET_ENDS open ends and POCKET_AREA cells. */
export const POCKET_ENDS = 3, POCKET_AREA = 9;
const parityPocket = (P, st) => parityForces(P, st).filter((f) => f.info.ends.length <= POCKET_ENDS && f.info.area <= POCKET_AREA);

/** pairedEnds with just two open ends: they must join each other (Medium); pairedEnds itself keeps the areas with four or six. */
const twoEndsJoin = (P, st) => pairedEnds(P, st).filter((f) => f.info.k === 2);
const pairedEndsMany = (P, st) => pairedEnds(P, st).filter((f) => f.info.k > 2);

// ---- imagine a dot
//
// The mirror of the "imagine a box" rules: put a dot on a cell that a clue counts, follow the easy consequences (a clue then needing every
// open cell it has left, or exactly every other one; dots next to boxes; dead ends; a cell with two ways out using both), and if that ends in a
// contradiction the cell is a box. dotShortChain allows DOT_SHORT steps (Medium); dotForcesLines follows them to the end (Hard).

const DOT_RULES = ['shadedNeighbor', 'clueDone', 'clueFull', 'clueTight', 'deadEnd', 'forcedExits'];
export const DOT_SHORT = 4;
/**
 * Put a dot at `cell` and apply DOT_RULES (with the bookkeeping) until they stop, a contradiction appears, or `cap` steps are taken.
 * Returns { contradiction, steps, trace: [{ rule, sets, infos }], s2 }.
 */
export function dotTrace(P, st, cell, cap = Infinity) {
  const s2 = cloneState(st); s2.cell[cell] = LOOP;
  const trace = [];
  let steps = 0;
  for (let guard = 0; guard < 500; guard++) {
    if (contradiction(P, s2)) return { contradiction: true, steps, trace, s2 };
    let fired = false;
    for (const r of RULES) {
      if (!(r.free || DOT_RULES.includes(r.id))) continue;
      const fs = r.find(P, s2, {});
      if (!fs.length) continue;
      const sets = fs.flatMap((f) => f.sets).filter(([k, i, v]) => (k === 'c' ? s2.cell : s2.e)[i] !== v);
      let ok = true;
      for (const f of fs) if (!applySets(s2, f.sets)) ok = false;
      if (!r.free) { steps++; trace.push({ rule: r.id, sets, infos: fs.map((f) => f.info) }); }
      if (!ok) return { contradiction: true, steps, trace, s2 };
      fired = true;
      break;
    }
    if (!fired || steps > cap) return { contradiction: false, steps, trace, s2 };
  }
  return { contradiction: false, steps, trace, s2 };
}

/** The cells some clue counts (where a dot changes what a clue can do). */
const countedCells = (P) => {
  if (P._counted) return P._counted;
  const c = new Uint8Array(P.N);
  P.clues.forEach((cl, k) => { if (cl.n >= 0) for (const i of P.rays[k]) c[i] = 1; });
  return (P._counted = c);
};

function dotChain(P, st, cap) {
  const out = [], counted = countedCells(P);
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN || !counted[i]) continue;
    const t = dotTrace(P, st, i, cap);
    if (t.contradiction && t.steps <= cap) out.push(firing([setCell(i, SHADED)], { cell: i, steps: t.steps }));
  }
  return out.sort((a, b) => a.info.steps - b.info.steps || a.info.cell - b.info.cell);
}
const dotShortChain = (P, st) => dotChain(P, st, DOT_SHORT);
const dotForcesLines = (P, st) => dotChain(P, st, Infinity);

// ---- chokepoints (Josh's "two gates" idea, 2026-11-21)
//
// The loop is one cycle, so it passes through any cell once: it can never go into a part of the board through a single cell and come back
// out through the same cell. So if one cell is the only way between two parts of the board that both hold loop cells, the position is
// impossible (in graph terms: a cycle lies inside one block, and that cell is a cut vertex). The rules imagine a move (a segment ruled out,
// a box) and look for that. Like the other "imagine" rules they are split by size: chokepoint when the part cut off is small enough to see
// (at most CHOKE_AREA cells), chokepointArea otherwise.

/**
 * Is there a cut cell between loop cells, or are the loop cells not even connected? Returns null when the position is fine, else
 * { cut, part }: `cut` the cell that is the only way in (-1 when there is no way at all), `part` the cells of the smaller side (the cells that
 * can still be on the loop, other than the cut). Cells that can still be on the loop: not clues, not boxes; a step between two of them is
 * possible unless the segment is ruled out or one of them already has two segments (and this is not one of them).
 */
export function chokepointCheck(P, st) {
  const N = P.N, onc = new Int8Array(N);
  for (let x = 0; x < P.numEdges; x++) if (st.e[x] === E_ON) { const a = x >> 1; onc[a]++; onc[(x & 1) ? a + P.cols : a + 1]++; }
  const live = (i) => st.cell[i] !== CLUE && st.cell[i] !== SHADED;
  const isLoop = (i) => st.cell[i] === LOOP || onc[i] > 0;
  const step = (i, d) => {
    const x = P.ed[i * 4 + d], j = P.nb[i * 4 + d];
    if (x < 0 || j < 0 || !live(j) || st.e[x] === E_OFF) return -1;
    if (st.e[x] !== E_ON && (onc[i] >= 2 || onc[j] >= 2)) return -1;
    return j;
  };
  let total = 0, root = -1;
  for (let i = 0; i < N; i++) if (live(i) && isLoop(i)) { total++; if (root < 0) root = i; }
  if (total < 2) return null;
  // iterative DFS (Tarjan): discovery time, low link, loop cells in each subtree, and the order of discovery (a subtree is a run of it)
  const disc = new Int32Array(N).fill(-1), low = new Int32Array(N), sub = new Int32Array(N), size = new Int32Array(N), parent = new Int32Array(N).fill(-1), it = new Int8Array(N);
  const order = [];
  let t = 0;
  const visit = (j, par) => { parent[j] = par; disc[j] = low[j] = t++; sub[j] = isLoop(j) ? 1 : 0; size[j] = 1; order.push(j); };
  visit(root, -1);
  const stack = [root];
  let found = null, rootLoopKids = [];
  while (stack.length && !found) {
    const v = stack[stack.length - 1];
    if (it[v] < 4) {
      const j = step(v, it[v]++);
      if (j < 0) continue;
      if (disc[j] < 0) { visit(j, v); stack.push(j); } else if (j !== parent[v]) low[v] = Math.min(low[v], disc[j]);
      continue;
    }
    stack.pop();
    const u = parent[v];
    if (u < 0) continue;
    low[u] = Math.min(low[u], low[v]);
    if (low[v] >= disc[u] && sub[v] > 0) {                       // u is the only way into v's subtree, which holds loop cells
      if (u === root) rootLoopKids.push(v);
      else if (total - sub[v] - (isLoop(u) ? 1 : 0) > 0) found = { cut: u, inside: v };
    }
    sub[u] += sub[v]; size[u] += size[v];
  }
  const subtree = (v) => order.slice(order.indexOf(v), order.indexOf(v) + size[v]);
  if (found) {
    const inside = subtree(found.inside), insideSet = new Set(inside);
    const outside = order.filter((i) => i !== found.cut && !insideSet.has(i));
    return { cut: found.cut, part: inside.length <= outside.length ? inside : outside };
  }
  if (rootLoopKids.length >= 2) {                                 // the root itself is the cut: its smallest loop-holding branch
    const parts = rootLoopKids.map(subtree).sort((a, b) => a.length - b.length);
    return { cut: root, part: parts[0] };
  }
  if (sub[root] < total) {                                        // some loop cells cannot be reached at all: no way in
    const reached = new Set(order);
    const other = [];
    const start = [...Array(N).keys()].find((i) => live(i) && isLoop(i) && !reached.has(i));
    const seen = new Set([start]), queue = [start];
    while (queue.length) { const v = queue.shift(); other.push(v); for (let d = 0; d < 4; d++) { const j = step(v, d); if (j >= 0 && !seen.has(j)) { seen.add(j); queue.push(j); } } }
    return { cut: -1, part: other.length <= order.length ? other : order };
  }
  return null;
}

export const CHOKE_AREA = 12;
function chokepoints(P, st) {
  const out = [];
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
    const t = cloneState(st); t.e[x] = E_OFF;
    const c = chokepointCheck(P, t);
    if (c) out.push(firing([setEdge(x, E_ON)], { edge: x, assumed: 'off', cut: c.cut, part: c.part, area: c.part.length }));
  }
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] !== UNKNOWN) continue;
    const t = cloneState(st); t.cell[i] = SHADED;
    for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && t.e[x] === E_UNKNOWN) t.e[x] = E_OFF; }
    const c = chokepointCheck(P, t);
    if (c) out.push(firing([setCell(i, LOOP)], { cell: i, assumed: 'shaded', cut: c.cut, part: c.part, area: c.part.length }));
  }
  return out.sort((p, q) => p.info.area - q.info.area);
}
const chokepoint = (P, st) => chokepoints(P, st).filter((f) => f.info.area <= CHOKE_AREA);
const chokepointArea = (P, st) => chokepoints(P, st).filter((f) => f.info.area > CHOKE_AREA);

// ---- imagine a segment, and a clue runs out of room

/** Cells that changed between `st` and `probe` (a cell or one of its segments), and their neighbours: 1 in the returned array. */
function nearChanges(P, st, probe) {
  const near = new Uint8Array(P.N);
  for (let j = 0; j < P.N; j++) {
    let changed = probe.cell[j] !== st.cell[j];
    for (let d = 0; d < 4 && !changed; d++) { const x = P.ed[j * 4 + d]; if (x >= 0 && probe.e[x] !== st.e[x]) changed = true; }
    if (!changed) continue;
    near[j] = 1;
    for (let d = 0; d < 4; d++) { const m = P.nb[j * 4 + d]; if (m >= 0) near[m] = 1; }
  }
  return near;
}

/**
 * boxStarvesClueByPlacements for a segment: imagine it drawn (or ruled out) next to the known loop and follow the lines it forces. If the lines
 * themselves are fine (no three lines, no stranded cell, the loop not closed: that is segmentForcesLines) but some clue's line is then left
 * without room for the boxes it still needs (lineRoom), the segment is the other way. info: { edge, assumed, clue, need, room }.
 */
function segmentStarvesClue(P, st) {
  const out = [];
  const clues = orthogonalClues(P);
  for (let x = 0; x < P.numEdges; x++) {
    if (st.e[x] !== E_UNKNOWN || !validEdge(P, x)) continue;
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
    if (st.cell[a] !== LOOP && st.cell[b] !== LOOP && !onCount(P, st, a) && !onCount(P, st, b)) continue;    // next to the known loop only
    for (const v of [E_OFF, E_ON]) {
      const probe = cloneState(st); probe.e[x] = v;
      if (followLines(P, probe) >= 0) continue;                  // a contradiction of the lines alone: segmentForcesLines' business
      let hit = null;
      const near = nearChanges(P, st, probe);
      for (const k of clues) {
        if (!P.rays[k].some((j) => near[j])) continue;          // only the clues whose line the segment changed, or lies next to a change
        const { room, shaded } = lineRoom(P, probe, k), need = P.clues[k].n - shaded;
        if (need > room) { hit = { clue: k, need, room }; break; }
      }
      if (hit) { out.push(firing([setEdge(x, v === E_OFF ? E_ON : E_OFF)], { edge: x, assumed: v === E_OFF ? 'off' : 'on', ...hit })); break; }
    }
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
        const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
        if (st.cell[a] === SHADED || st.cell[b] === SHADED) continue;
        attempt([setEdge(x, E_ON)], [setEdge(x, E_OFF)], { edge: x, assumed: 'on' });
        attempt([setEdge(x, E_OFF)], [setEdge(x, E_ON)], { edge: x, assumed: 'off' });
      }
    }
    out.sort((p, q) => p.cost - q.cost);
    return out;
  };
}

// THE RULE TABLE: where rules are binned into tiers and given a cost. Costs are integers ("tokens"); every rule costs something,
// bookkeeping included (charged once per solving step in which it had something to do). The solver, the hints and the rating try
// the rules cheapest first (ties: table order), so the order a person meets them in IS the order of the costs. The array itself is
// sorted by tier and, within a tier, so that the cheap-to-compute rules come before the expensive ones: closure() and the generator
// use prefixes of it (everything before the lookahead rules; the generator's cheap phase stops before shadeForcesLines).
// Extra cost for the long cases of the rules that grow with the size of the argument (charged on top of the rule's cost, in the score only:
// the order a person meets the rules in is by the base cost). Two per line, end or step past what the rule's Medium split allows.
const extraShadeLines = (P, st, f) => { const pr = boxProof(P, st, f.info.cell); return 2 * Math.max(0, (pr ? pr.edges.length : f.info.forced) - FEW_LINES); };
const extraSegmentLines = (P, st, f) => 2 * Math.max(0, Math.min(segmentNeeded(P, st, f.info), f.info.forced ?? Infinity) - SEGMENT_SHORT);
const extraParity = (P, st, f) => 2 * Math.max(0, f.info.ends.length - POCKET_ENDS);
const extraDotSteps = (P, st, f) => 2 * Math.max(0, f.info.steps - DOT_SHORT);
const extraTrial = (P, st, f) => 2 * (f.cost || 0);                  // trial and error: two per step of the chain it follows

export const RULES = [
  { id: 'edgesOffShaded', tier: 'Beginner', weight: 1, free: true, find: bookkeepingShadedEdges, label: 'segments touching a box are off' },
  { id: 'edgeEnds', tier: 'Beginner', weight: 1, free: true, find: bookkeepingEdgeEnds, label: 'a segment makes both its cells loop cells' },
  { id: 'fullCells', tier: 'Beginner', weight: 1, free: true, find: bookkeepingFullCells, label: 'a loop cell with two segments has no others' },
  { id: 'shadedNeighbor', tier: 'Beginner', weight: 1, find: shadedNeighbor, label: 'cells next to a box are dots' },
  { id: 'clueDone', tier: 'Beginner', weight: 2, find: clueDone, label: 'a clue has all its boxes: the rest of its line is dots' },
  { id: 'clueFull', tier: 'Beginner', weight: 2, find: clueFull, label: 'a clue needs every open cell left in its line: they are boxes' },
  { id: 'clueTight', tier: 'Beginner', weight: 3, find: clueTight, label: 'a clue needs as many more boxes as fit in the open cells left in its line (every other cell): those are boxes, the ones between are dots' },
  { id: 'rangeSameOne', tier: 'Beginner', weight: 3, find: rangeSameOne, label: 'two clues point the same way with one cell between them: the difference of their numbers (0 or 1) says if it is a box' },
  { id: 'deadEnd', tier: 'Beginner', weight: 4, find: deadEnd, label: 'a cell with fewer than two exits is a box' },
  { id: 'forcedExits', tier: 'Beginner', weight: 4, find: forcedExits, label: 'a loop cell with two exits left uses both' },
  { id: 'tightCell', tier: 'Beginner', weight: 5, find: tightCell, label: 'a box here would turn a corner-like neighbor into a dot with just one way out: this cell is a dot' },
  { id: 'noEarlyClose', tier: 'Beginner', weight: 6, find: noEarlyClose, label: 'a segment would close the loop too early' },
  { id: 'sameSegmentExits', tier: 'Beginner', weight: 7, find: sameSegmentExits, label: 'two of a dot\'s three ways out lead to the ends of one path: it uses the third' },
  { id: 'closingCell', tier: 'Beginner', weight: 7, find: closingCell, label: 'a cell whose only two ways out are the ends of one path would close the loop early: it is a box' },
  { id: 'deadEndNeighbor', tier: 'Medium', weight: 10, find: deadEndNeighbor, label: 'a box here would strand a neighbor: this cell is a dot' },
  { id: 'cluePlacements', tier: 'Medium', weight: 12, find: cluePlacements, label: 'every way to place a clue\'s boxes includes (or leaves out) this cell' },
  { id: 'placementDeadEnd', tier: 'Medium', weight: 14, find: placementDeadEnd, label: 'every way to place a clue\'s boxes that leaves no neighbor stranded includes (or leaves out) this cell' },
  { id: 'shadeShortChain', tier: 'Medium', weight: 15, find: shadeShortChain, label: `a box here would force a couple of lines (at most ${SHORT_CHAIN} that matter) that give some cell three lines: this cell is a dot` },
  { id: 'boxStarvesClue', tier: 'Medium', weight: 16, find: boxStarvesClue, label: 'a box here would turn its neighbors into dots and leave a clue no room for its number of boxes: this cell is a dot' },
  { id: 'closingNeighbor', tier: 'Medium', weight: 20, find: closingNeighbor, label: 'a box here would turn a neighbor into a dot whose only two ways out are the ends of one path: this cell is a dot' },
  { id: 'rangeSame', tier: 'Medium', weight: 24, find: rangeSame, label: 'two clues point the same way: the cells between them hold the difference of their numbers' },
  { id: 'rangeFacingKnown', tier: 'Medium', weight: 28, find: rangeFacingKnown, label: 'two clues point at each other and one part of the line has a known number of boxes: that fixes the other two parts' },
  { id: 'boxStarvesClueByLines', tier: 'Medium', weight: 27, find: boxStarvesClueByLines, label: 'a box here would turn its neighbors into dots and force the lines of a neighbor left with two ways out, and that leaves a clue no room for its number: this cell is a dot' },
  { id: 'twoEndsJoin', tier: 'Medium', weight: 22, find: twoEndsJoin, label: 'a sealed-off area has just two open ends: they join each other, so their far ends cannot be joined' },
  { id: 'parityPocket', tier: 'Medium', weight: 28, costly: true, find: parityPocket, label: `a move here would cut off a small pocket (at most ${POCKET_AREA} cells) with an odd number of open ends` },
  { id: 'shadeFewLines', tier: 'Medium', weight: 25, costly: true, find: shadeFewLines, label: `a box here would force lines, at most ${FEW_LINES} of which lead to a cell with three lines or too few ways out: this cell is a dot` },
  { id: 'segmentShortChain', tier: 'Medium', weight: 26, costly: true, find: segmentShortChain, label: `a segment here (or its absence) would force at most ${SEGMENT_SHORT} lines that leave a cell with three lines or too few ways out` },
  { id: 'dotShortChain', tier: 'Medium', weight: 21, costly: true, find: dotShortChain, label: `a dot here would, within a few easy steps (at most ${DOT_SHORT}: a clue needing all its open cells, dots by boxes, dead ends, cells with two ways out), break something: this cell is a box` },
  { id: 'chokepoint', tier: 'Medium', weight: 23, costly: true, find: chokepoint, label: `a move here would leave one cell as the only way between two parts of the board that both hold loop cells (the smaller part at most ${CHOKE_AREA} cells): the loop could not get in and out` },
  { id: 'regionPairs', tier: 'Hard', weight: 45, find: regionPairs, label: 'two neighbouring numbered regions together: every way to place both numbers of boxes without touching includes (or leaves out) this cell' },
  { id: 'rangeFacing', tier: 'Hard', weight: 48, find: rangeFacing, label: 'two clues point at each other: how many boxes fit in each part of the line fixes how many it holds' },
  { id: 'colorBalance', tier: 'Hard', weight: 50, find: colorBalance, label: 'the loop alternates colours, so the boxes leave light and dark cells level: that fixes how many boxes each colour holds' },
  { id: 'crossingParity', tier: 'Hard', weight: 90, find: crossingParity, label: 'the loop crosses the border of a rectangle an even number of times' },
  { id: 'pairedEnds', tier: 'Hard', weight: 110, find: pairedEndsMany, label: 'however the open ends of a sealed-off area pair up, two lines end up as one: their far ends cannot be joined' },
  { id: 'chokepointArea', tier: 'Hard', weight: 62, costly: true, find: chokepointArea, label: 'a move here would leave one cell as the only way between two large parts of the board that both hold loop cells: the loop could not get in and out' },
  { id: 'shadeForcesLines', tier: 'Hard', weight: 70, find: shadeForcesLines, extra: extraShadeLines, label: 'a box here would force lines that leave a cell with three lines or too few ways out: this cell is a dot' },
  { id: 'boxStarvesClueByPlacements', tier: 'Hard', weight: 72, find: boxStarvesClueByPlacements, label: 'a box here would force lines that leave a clue without room to place its boxes (counting the cells that would be left with one way out): this cell is a dot' },
  { id: 'segmentStarvesClue', tier: 'Hard', weight: 74, costly: true, find: segmentStarvesClue, label: 'a segment here (or its absence) would force lines that leave a clue without room to place its boxes' },
  { id: 'shadeClosesLoop', tier: 'Hard', weight: 75, find: shadeClosesLoop, label: 'a box here would force lines that close the loop early: this cell is a dot' },
  { id: 'dotForcesLines', tier: 'Hard', weight: 78, extra: extraDotSteps, costly: true, find: dotForcesLines, label: 'a dot here would, by easy steps (a clue needing all its open cells, dots by boxes, dead ends, cells with two ways out), break something: this cell is a box' },
  { id: 'segmentForcesLines', tier: 'Hard', weight: 80, find: segmentForcesLines, extra: extraSegmentLines, label: 'a segment here (or its absence) would force lines that leave a cell with three lines or too few ways out' },
  { id: 'segmentClosesLoop', tier: 'Hard', weight: 85, find: segmentClosesLoop, label: 'a segment here (or its absence) would force lines that close the loop early' },
  { id: 'parityForces', tier: 'Hard', weight: 95, find: parityForces, extra: extraParity, label: 'a move here would cut off a region with an odd number of open ends' },
  { id: 'tryCell', tier: 'Hard', weight: 140, lookahead: true, find: lookahead('cell'), extra: extraTrial, label: 'trying a cell one way leads to a contradiction' },
  { id: 'tryEdge', tier: 'Hard', weight: 160, lookahead: true, find: lookahead('edge'), extra: extraTrial, label: 'trying a segment one way leads to a contradiction' },
  { id: 'uniqueRoute', tier: 'Hard', weight: 125, assumesUnique: true, find: uniqueRoute, label: 'a way of joining the open ends here could be drawn two ways, which would give two solutions: so it is not the way' },
];

// The order a person (the rating, the hints) tries the rules in: bookkeeping first, then cheapest first (ties: table order).
// Rules flagged assumesUnique are valid only if the puzzle has exactly one solution. They sit after the lookahead rules in the table
// so that everything that takes "solved by the rules" as proof of uniqueness (solvedByRules, closure, the generator) never uses them.
export const HUMAN_ORDER = RULES.map((r, i) => [r, i]).filter(([r]) => !r.free).sort((p, q) => p[0].weight - q[0].weight || p[1] - q[1]).map(([r]) => r);
const FIRST_LOOKAHEAD = RULES.findIndex((r) => r.lookahead);
export const RULE_IDS = RULES.map((r) => r.id);
export const tierOfRule = (id) => (id === 'unsolved' ? 'Expert' : RULES.find((r) => r.id === id).tier);
export const ruleLabel = (id) => (id === 'unsolved' ? 'none of the current rules finishes it' : RULES.find((r) => r.id === id).label);

/**
 * Apply every rule below index `upto` until nothing changes or a contradiction appears (the engine inside the
 * lookahead rules: "follow what it forces"). Mutates `st`. Returns { contradiction, steps }.
 */
// COSTLY rules (flag `costly`) imagine a move and follow it for every cell or segment: dotShortChain, dotForcesLines, shadeFewLines,
// segmentShortChain, parityPocket, segmentStarvesClue, chokepoint, chokepointArea. closure() with a prefix (`upto` a number: the generator's solvability check, solvedByRules,
// and the inner closure of tryCell / tryEdge) leaves them out, which keeps generation and trial and error as fast as before 2026-11-21; they are
// sound, so leaving them out only makes those checks a little more conservative. The rating and the hints (nextSteps) use every rule.
export function closure(P, st, upto = FIRST_LOOKAHEAD) {
  // `upto` is a prefix length of the rule table, or a list of rule ids (then exactly those rules, plus the bookkeeping, are used)
  const allowed = Array.isArray(upto) ? new Set(upto) : null;
  let steps = 0;
  for (let guard = 0; guard < 5000; guard++) {
    if (contradiction(P, st)) return { contradiction: true, steps };
    let fired = false;
    for (let r = 0; r < (allowed ? RULES.length : upto); r++) {
      if (allowed && !(RULES[r].free || allowed.has(RULES[r].id))) continue;   // a chosen set of rules instead of a prefix of the table
      if (!allowed && RULES[r].costly) continue;   // a prefix leaves out the costly "imagine" rules (see COSTLY below): rate() and Hint still use them
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
export function nextSteps(P, st, bookkeeping = null, without = null) {
  for (;;) {
    let any = false;
    for (const r of RULES) {
      if (!r.free) continue;
      let changed = false;
      for (const f of r.find(P, st, {})) { if (applySets(st, f.sets)) { any = true; changed = true; } else return null; }
      if (changed && bookkeeping) bookkeeping[r.id] = true;   // the caller charges the rule's cost: bookkeeping is not free
    }
    if (!any) break;
  }
  // cheapest first; the rules that assume a unique solution come in at their price, trial and error last
  for (const rule of HUMAN_ORDER) {
    if (without && without.includes(rule.id)) continue;         // (tests and tools: rate as if a rule did not exist)
    const firings = rule.find(P, st, { upto: FIRST_LOOKAHEAD });
    if (firings.length) return { rule: rule.id, tier: rule.tier, weight: rule.weight, firings };
  }
  return null;
}

/** The easiest deduction available in `st`, or null: { rule, tier, weight, sets, info }. */
export function nextStep(P, st, bookkeeping = null, without = null) {
  const r = nextSteps(P, st, bookkeeping, without);
  if (!r) return null;
  const rule = RULES[RULE_IDS.indexOf(r.rule)], f = r.firings[0];
  const extra = rule.extra ? rule.extra(P, st, f) : 0;                // the long cases cost more (see the extra* functions)
  return { rule: r.rule, tier: r.tier, weight: r.weight, extra, sets: f.sets, info: f.info };
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
 * Solve like a human. Returns { solved, rules (hardest rule id or 'unsolved'), tier, score, steps, counts, state }. `without`: rule ids to leave out.
 * `steps` lists every counted step { rule, tier, weight, sets, info }; `counts` maps rule id -> times used.
 */
export function rate(P, { without = null } = {}) {
  const st = initialState(P);
  const steps = [];
  const counts = {};
  for (let guard = 0; guard < 2000; guard++) {
    if (!contradiction(P, st) && isComplete(P, st)) break;
    const bk = {};
    const step = nextStep(P, st, bk, without);
    for (const id of Object.keys(bk)) {          // bookkeeping that had something to do costs its price, once per step
      const rule = RULES.find((q) => q.id === id);
      steps.push({ rule: id, tier: rule.tier, weight: rule.weight, sets: [], info: { bookkeeping: true } });
      counts[id] = (counts[id] || 0) + 1;
    }
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
  const score = steps.reduce((a, s) => a + s.weight + (s.extra || 0), 0) + (solved ? 0 : unknown * UNDETERMINED_WEIGHT);
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
