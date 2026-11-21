// Puzzle generator (pure logic). Solution first, then clues aimed at the human-style solver:
//
//   1. randomLoop: pick the shaded cells (an independent set), then a random loop through every other cell
//      (two disjoint random perfect matchings make a set of cycles; local flips merge them into one).
//   2. Turn some shaded cells into clue cells (the loop does not change, only which non-loop cells carry a clue) and
//      give each clue the direction and the number its solution dictates.
//   3. Ask the rules (rating.solvedByRules) whether they solve it. The rules are sound, so a puzzle they solve has
//      exactly one solution and needs no exhaustive search. If they get stuck, turn more shaded cells near the cells
//      they could not decide into clues, and ask again.
//   4. Optionally prune: turn clues back into shaded cells while the rules still solve it.
import { compile, initialState, propagate, encodeSolution, decodeSolution, solve, mergeBlankRegions, SHADED, LOOP, E_ON, E_OFF, E_UNKNOWN, DR, DC, UNKNOWN } from './logic.js';
import { solvedByRules, closure, RULES } from './rating.js';

/** Small deterministic PRNG (mulberry32) so a seed reproduces a puzzle. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffle = (arr, rng) => { for (let i = arr.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

/**
 * Is the loop through exactly the non-hole cells unique? Clues cannot change this: they decide which cells are boxes, never how
 * the loop routes through the others, so a hole pattern that admits two loops can never become a unique puzzle. Random patterns
 * pass about 55% of the time at 8x8, 15% at 12x12, a few percent at 14x14-16x16 and almost never at 20x20, which is why the
 * climb below is only worth starting on a loop that passes this cheap test (holes are blocked cells: clues with n = -1).
 */
export function loopIsUnique(rows, cols, holes, maxNodes = 150000) {
  const clues = [];
  for (let i = 0; i < rows * cols; i++) if (holes[i]) clues.push({ r: (i / cols) | 0, c: i % cols, d: 1, n: -1 });
  const P = compile({ name: 'loop', rows, cols, clues });
  const st = initialState(P);
  for (let i = 0; i < rows * cols; i++) if (!holes[i]) st.cell[i] = LOOP;
  const r = solve(P, { limit: 2, maxNodes, state: st });
  return !r.exceeded && r.count === 1;
}

/** Grid neighbours of cell i. */
function gridNeighbours(rows, cols, i) {
  const r = (i / cols) | 0, c = i % cols, out = [];
  for (let d = 0; d < 4; d++) {
    const nr = r + DR[d], nc = c + DC[d];
    if (nr >= 0 && nc >= 0 && nr < rows && nc < cols) out.push(nr * cols + nc);
  }
  return out;
}

/**
 * A loop builder: a single cycle through every cell that is not a hole, kept valid while holes are added.
 *
 * Start from a random 2-factor of the whole grid (every cell has two loop neighbours: a set of cycles) and merge it into one
 * cycle with local flips. `tryHoles(c1, c2)` then makes two cells of opposite chessboard color holes: it repairs the 2-factor
 * with augmenting paths, merges it back into one cycle, and rolls everything back (returning false) if either is impossible.
 */
export function makeLoopBuilder(rows, cols, rng, { mergeRounds = 40, independent = false } = {}) {   // independent: no two holes touch (regional puzzles: every hole is a box)
  const N = rows * cols;
  const color = (i) => (((i / cols) | 0) + (i % cols)) & 1;
  const grid = Array.from({ length: N }, (_, i) => gridNeighbours(rows, cols, i)); // fixed
  const adj = grid.map((g) => g.slice());                                        // shrinks as cells become holes
  const hole = new Uint8Array(N);
  let partners = Array.from({ length: N }, () => []);
  const link = (v, w) => { partners[v].push(w); partners[w].push(v); };
  const unlink = (v, w) => { partners[v].splice(partners[v].indexOf(w), 1); partners[w].splice(partners[w].indexOf(v), 1); };
  const has = (a, b) => partners[a].includes(b);
  let seen = new Uint8Array(N);
  // give v one more loop neighbour, rerouting others along an augmenting path if needed
  const extend = (v) => {
    for (const w of shuffle(adj[v].slice(), rng)) {
      if (seen[w] || partners[v].includes(w)) continue;
      seen[w] = 1;
      if (partners[w].length < 2) { link(v, w); return true; }
      for (const u of [...partners[w]]) {
        if (u === v) continue;
        unlink(u, w); link(v, w);
        if (extend(u)) return true;
        unlink(v, w); link(u, w);
      }
    }
    return false;
  };
  const fill = (v) => { while (partners[v].length < 2) { seen = new Uint8Array(N); if (!extend(v)) return false; } return true; };

  // cycle bookkeeping
  const comp = new Int32Array(N);
  const label = () => {
    comp.fill(-1);
    let k = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (hole[s0] || comp[s0] >= 0) continue;
      let prev = -1, cur = s0;
      do { comp[cur] = k; const nxt = partners[cur][0] !== prev ? partners[cur][0] : partners[cur][1]; prev = cur; cur = nxt; } while (cur !== s0);
      k++;
    }
    return k;
  };
  // Flip the parallel loop edges a-b and c-d (a~c, b~d adjacent) into the rungs a-c, b-d. Between two different cycles
  // this always merges them.
  const flip = (a, b, c, d) => {
    if (c < 0 || d < 0 || c >= N || d >= N || hole[c] || hole[d] || !has(c, d) || has(a, c) || has(b, d)) return false;
    unlink(a, b); unlink(c, d); link(a, c); link(b, d);
    return true;
  };
  const parallel = (lo, hi) => {
    // the two parallel positions beside edge lo-hi (lo < hi): [c, d] pairs, c next to lo and d next to hi
    const step = hi === lo + 1 ? cols : 1;
    const out = [];
    for (const sgn of [-1, 1]) {
      const c = lo + sgn * step, d = hi + sgn * step;
      if (c < 0 || d < 0 || c >= N || d >= N) continue;
      if (step === 1 && (((c / cols) | 0) !== ((lo / cols) | 0) || ((d / cols) | 0) !== ((hi / cols) | 0))) continue; // would wrap rows
      out.push([c, d]);
    }
    return out;
  };
  const mergeCycles = () => {
    let count = label();
    for (let round = 0; count > 1 && round < mergeRounds; round++) {
      let merged = false;
      const order = shuffle(Array.from({ length: N }, (_, i) => i).filter((i) => !hole[i]), rng);
      for (const a of order) {
        for (const b of partners[a].slice()) {
          if (b < a) continue;
          if (b !== a + 1 && b !== a + cols) continue;
          for (const [c, d] of parallel(a, b)) {
            if (comp[c] === comp[a] || comp[c] < 0) continue;
            if (flip(a, b, c, d)) { merged = true; break; }
          }
          if (merged) break;
        }
        if (merged) break;
      }
      if (merged) { count = label(); continue; }
      // no two different cycles touch in a unit square: reshape with a few same-cycle flips that keep it one cycle each
      const cellsNow = order;
      for (let k = 0; k < 60; k++) {
        const a = cellsNow[(rng() * cellsNow.length) | 0];
        const b = partners[a][(rng() * 2) | 0];
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (hi !== lo + 1 && hi !== lo + cols) continue;
        const opts = parallel(lo, hi);
        if (!opts.length) continue;
        const [c, d] = opts[(rng() * opts.length) | 0];
        if (!flip(lo, hi, c, d)) continue;
        const after = label();
        if (after > count) { unlink(lo, c); unlink(hi, d); link(lo, hi); link(c, d); label(); } else count = after;
      }
      count = label();
    }
    return count === 1;
  };

  const init = () => {
    // A cycle alternates chessboard colors, so it needs as many cells of each color. A board with an odd number of cells has one cell
    // too many of color 0: make one of those a hole first (a corner or edge cell is as good as any), then build as usual.
    if (N % 2) {
      const spare = shuffle([...Array(N).keys()].filter((c) => color(c) === 0), rng).find((c) => adj[c].every((w) => adj[w].length - 1 >= 2));
      if (spare === undefined) return false;
      hole[spare] = 1;
      for (const w of adj[spare]) adj[w] = adj[w].filter((x) => x !== spare);
      adj[spare] = [];
    }
    for (const v of shuffle([...Array(N).keys()], rng)) if (!hole[v] && !fill(v)) return false;
    return mergeCycles();
  };
  // may this cell become a hole? (every neighbour keeps two neighbours; `clump` is the chance of refusing a hole next to a hole)
  const okCell = (c, clump = 0) => !hole[c] && adj[c].every((w) => adj[w].length - 1 >= 2) && !(independent && grid[c].some((w) => hole[w])) && !(clump > 0 && grid[c].some((w) => hole[w]) && rng() < clump);
  /** Make c1 and c2 (opposite colors) holes, keeping one cycle through the rest. Returns false, changing nothing, if impossible. */
  const tryHoles = (c1, c2) => {
    if (color(c1) === color(c2) || c1 === c2 || hole[c1] || hole[c2] || (independent && grid[c1].includes(c2))) return false;
    const touched = [...new Set([c1, c2, ...adj[c1], ...adj[c2]])];
    const savedPartners = partners.map((p) => p.slice());
    const savedAdj = touched.map((v) => adj[v].slice());
    const deficient = [];
    for (const c of [c1, c2]) {
      for (const u of [...partners[c]]) { unlink(c, u); if (u !== c1 && u !== c2) deficient.push(u); }
      hole[c] = 1;
      for (const w of adj[c]) adj[w] = adj[w].filter((x) => x !== c);
      adj[c] = [];
    }
    let ok = deficient.every((u) => adj[u].length >= 2);
    for (const u of deficient) { if (!ok) break; if (!hole[u] && !fill(u)) ok = false; }
    if (ok) ok = mergeCycles();
    if (ok) return true;
    partners = savedPartners;
    hole[c1] = hole[c2] = 0;
    touched.forEach((v, k) => { adj[v] = savedAdj[k]; });
    return false;
  };
  const snapshot = () => ({ partners: partners.map((p) => p.slice()), adj: adj.map((a) => a.slice()), hole: hole.slice() });
  const restore = (sn) => { partners = sn.partners.map((p) => p.slice()); for (let i = 0; i < N; i++) adj[i] = sn.adj[i].slice(); hole.set(sn.hole); };
  const edges = () => {
    const e = new Int8Array(2 * N);
    for (let v = 0; v < N; v++) {
      if (hole[v]) continue;
      for (const w of partners[v]) { if (w <= v) continue; e[w === v + 1 ? 2 * v : 2 * v + 1] = 1; }
    }
    return e;
  };
  /** Position of every loop cell along the (single) cycle, -1 for holes; and the cycle's length. */
  const positions = () => {
    const pos = new Int32Array(N).fill(-1);
    let s0 = 0; while (s0 < N && hole[s0]) s0++;
    let prev = -1, cur = s0, t = 0;
    do { pos[cur] = t++; const nxt = partners[cur][0] !== prev ? partners[cur][0] : partners[cur][1]; prev = cur; cur = nxt; } while (cur !== s0);
    return { pos, length: t };
  };
  return { N, rows, cols, hole, color, init, okCell, tryHoles, snapshot, restore, edges, positions, grid, adj };
}

/** A random loop: { holes: Uint8Array (1 = a cell the loop does not visit), edges: Int8Array (numEdges, 1 = loop segment) }, or null. */
export function randomLoop(rows, cols, rng, { density = 0.3, clump = 0.7, attemptsPerHole = 150, mergeRounds = 40, info = null, independent = false } = {}) {
  const b = makeLoopBuilder(rows, cols, rng, { mergeRounds, independent });
  const N = rows * cols;
  if (!b.init()) { if (info) info.fail = 'merge0'; return null; }
  const target = Math.round((N * density) / 2) * 2;
  let holes = 0;
  const near = (a, c, dist) => Math.abs(((a / cols) | 0) - ((c / cols) | 0)) + Math.abs((a % cols) - (c % cols)) <= dist;
  for (let attempt = 0; attempt < target * attemptsPerHole && holes < target; attempt++) {
    const c1 = (rng() * N) | 0;
    if (!b.okCell(c1, clump)) continue;
    const c2 = (rng() * N) | 0;
    if (b.color(c2) === b.color(c1) || c2 === c1 || !near(c1, c2, 6) || !b.okCell(c2, clump)) continue;
    if (b.tryHoles(c1, c2)) holes += 2;
  }
  if (info) info.holes = holes / N;
  if (holes < target * 0.7) { if (info) info.fail = 'holes'; return null; }
  return { holes: b.hole, edges: b.edges() };
}

/**
 * Alternative loops through the same cells, found locally. A 2x2 block of loop cells whose cycle contains two parallel opposite
 * edges is a "chord" joining those two edges along the cycle. Swapping the parallel edges for the other pair splits the cycle in
 * two (on a plane curve the two edges always run in opposite directions), and a second swap in a different block merges the
 * halves into ONE cycle again, a different loop through exactly the same cells, whenever the two chords interleave around the
 * cycle. So a loop with two crossing chords can never be unique. (The converse does not hold: longer alternating cycles exist.)
 * Returns { chords, crossings, pairs } where pairs lists the crossing chord pairs.
 */
export function crossingChords(rows, cols, hole, pos, length) {
  const chords = [];
  const edgeIndex = (a, b) => {
    if (pos[a] < 0 || pos[b] < 0) return -1;
    if (pos[b] === (pos[a] + 1) % length) return pos[a];
    if (pos[a] === (pos[b] + 1) % length) return pos[b];
    return -1;
  };
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols + 1, e = a + cols; // a b / e d
      if (hole[a] || hole[b] || hole[d] || hole[e]) continue;
      let i = edgeIndex(a, b), j = edgeIndex(e, d);          // top and bottom edges
      if (i >= 0 && j >= 0) chords.push([Math.min(i, j), Math.max(i, j), a]);
      i = edgeIndex(a, e); j = edgeIndex(b, d);              // left and right edges
      if (i >= 0 && j >= 0) chords.push([Math.min(i, j), Math.max(i, j), a]);
    }
  }
  const pairs = [];
  for (let x = 0; x < chords.length; x++) {
    const [p, q] = chords[x];
    for (let y = x + 1; y < chords.length; y++) {
      const [u, v] = chords[y];
      if ((p < u && u < q && q < v) || (u < p && p < v && v < q)) pairs.push([x, y]);
    }
  }
  return { chords, crossings: pairs.length, pairs };
}

/**
 * Tight arrows, which hand-made puzzles are full of: a clue pointing at a wall with exactly 2n-1 cells between it and the wall,
 * n boxes on every other cell (the first right next to the clue) and loop cells between them. All n boxes are forced from the start.
 * Plans `count` of them that do not collide. Returns { clues: Map(cell -> direction), boxes: [cells], between: Set(cells that must stay on
 * the loop), holes: [clue cells and boxes], fixed: Set(clue cells and boxes) }.
 */
export function plantTightArrows(rows, cols, rng, count, { sizes = [[2, 0.45], [3, 0.4], [4, 0.1], [5, 0.05]] } = {}) {
  const DR = [-1, 0, 1, 0], DC = [0, 1, 0, -1];
  const clues = new Map(), boxes = [], between = new Set(), taken = new Set(), boxSet = new Set();
  for (let k = 0; k < count; k++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      let x = rng(), n = sizes[sizes.length - 1][0];
      for (const [size, w] of sizes) { if (x < w) { n = size; break; } x -= w; }
      const d = (rng() * 4) | 0, L = 2 * n - 1;
      let r, c;
      if (d === 0) { r = L; c = (rng() * cols) | 0; } else if (d === 2) { r = rows - 1 - L; c = (rng() * cols) | 0; }
      else if (d === 1) { c = cols - 1 - L; r = (rng() * rows) | 0; } else { c = L; r = (rng() * rows) | 0; }
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const cells = [];
      for (let t = 0; t <= L; t++) cells.push((r + DR[d] * t) * cols + (c + DC[d] * t));
      if (cells.some((i) => taken.has(i))) continue;
      const bx = cells.filter((_, t) => t % 2 === 1), dots = cells.filter((_, t) => t > 0 && t % 2 === 0);
      if (bx.some((i) => gridNeighbours(rows, cols, i).some((j) => boxSet.has(j)))) continue;
      cells.forEach((i) => taken.add(i));
      clues.set(cells[0], d);
      bx.forEach((i) => { boxes.push(i); boxSet.add(i); });
      dots.forEach((i) => between.add(i));
      break;
    }
  }
  return { clues, boxes, between, holes: [...clues.keys(), ...boxes], fixed: new Set([...clues.keys(), ...boxes]) };
}

/**
 * A loop whose cells admit no other loop (it is unique), built by repair instead of by luck: start from a random loop with
 * few holes and, while two chords cross (see crossingChords), try to make a pair of cells beside one crossing into holes; keep
 * the move only if the number of crossings goes down (or stays level, now and then, to cross plateaus). Returns
 * { holes, edges, stats } or null. Random loops almost never pass at 14x14 and above; this is what scales.
 */
export function tightLoop(rows, cols, rng, { startDensity = 0.2, maxDensity = 0.42, budgetMs = 60000, maxIters = Infinity, clump = 0.5, check = true, preset = null, independent = false } = {}) {
  const t0 = Date.now();
  const N = rows * cols;
  const b = makeLoopBuilder(rows, cols, rng, { independent });
  if (!b.init()) return null;
  const near = (a, c, dist) => Math.abs(((a / cols) | 0) - ((c / cols) | 0)) + Math.abs((a % cols) - (c % cols)) <= dist;
  const target = Math.round((N * startDensity) / 2) * 2;
  let holes = 0;
  const forbid = preset ? preset.between : new Set();                 // cells that must stay on the loop
  const okc = (c, cl) => !forbid.has(c) && b.okCell(c, cl);
  if (preset) {
    // the planted holes first, paired by chessboard color; an odd one out gets a random partner of the other color
    const presetSet = new Set(preset.holes);
    const A = preset.holes.filter((c) => b.color(c) === 0), B = preset.holes.filter((c) => b.color(c) === 1);
    const pairs = [];
    while (A.length && B.length) pairs.push([A.pop(), B.pop()]);
    for (const c of [...A, ...B]) {
      let partner = -1;
      for (let k = 0; k < 400 && partner < 0; k++) { const q = (rng() * N) | 0; if (b.color(q) !== b.color(c) && !presetSet.has(q) && !b.hole[q] && okc(q, 0)) partner = q; }
      if (partner < 0) return null;
      pairs.push([c, partner]);
    }
    for (const [c1, c2] of pairs) { if (!b.tryHoles(c1, c2)) return null; holes += 2; }
  }
  for (let attempt = 0; attempt < target * 150 && holes < target; attempt++) {
    const c1 = (rng() * N) | 0, c2 = (rng() * N) | 0;
    if (okc(c1, clump) && okc(c2, clump) && near(c1, c2, 6) && b.tryHoles(c1, c2)) holes += 2;
  }
  if (holes < target * 0.7) return null;
  const evaluate = () => { const { pos, length } = b.positions(); return crossingChords(rows, cols, b.hole, pos, length); };
  let cur = evaluate(), moves = 0, accepted = 0, plateau = 0;
  const maxHoles = Math.round(N * maxDensity);
  let iters = 0;
  while (Date.now() - t0 < budgetMs && holes < maxHoles && iters++ < maxIters) {
    if (cur.crossings === 0) {
      if (!check || loopIsUnique(rows, cols, b.hole)) {
        return { holes: b.hole, edges: b.edges(), stats: { holePct: (100 * holes / N).toFixed(1), moves, accepted, iters, ms: Date.now() - t0 } };
      }
      // no local alternative but still not unique (a longer alternating cycle): add a random pair and look again
      for (let k = 0; k < 400; k++) { const c1 = (rng() * N) | 0, c2 = (rng() * N) | 0; if (okc(c1, clump) && okc(c2, clump) && near(c1, c2, 3) && b.tryHoles(c1, c2)) { holes += 2; break; } }
      cur = evaluate(); continue;
    }
    // pick one crossing pair and a hole pair beside it
    const [x, y] = cur.pairs[(rng() * cur.pairs.length) | 0];
    const blk = [cur.chords[x][2], cur.chords[y][2]];
    const cells = [];
    for (const a of blk) for (const dr of [-1, 0, 1, 2]) for (const dc of [-1, 0, 1, 2]) { const r = ((a / cols) | 0) + dr, c = (a % cols) + dc; if (r >= 0 && c >= 0 && r < rows && c < cols && !b.hole[r * cols + c]) cells.push(r * cols + c); }
    if (!cells.length) continue;
    const c1 = cells[(rng() * cells.length) | 0];
    const opp = cells.filter((i) => b.color(i) !== b.color(c1) && near(i, c1, 3));
    if (!opp.length || !okc(c1, 0)) continue;
    const c2 = opp[(rng() * opp.length) | 0];
    if (!okc(c2, 0)) continue;
    moves++;
    const snap = b.snapshot();
    if (!b.tryHoles(c1, c2)) continue;
    const next = evaluate();
    if (next.crossings < cur.crossings || (next.crossings === cur.crossings && rng() < 0.25)) { cur = next; holes += 2; accepted++; plateau = next.crossings < cur.crossings ? 0 : plateau + 1; }
    else b.restore(snap);
  }
  return null;
}

// ------------------------------------------------------------ clues

/** The non-clue cells a clue at `i` pointing in direction d counts, up to the border. */
function rayOf(rows, cols, i, d, isClue) {
  const out = [];
  let r = ((i / cols) | 0) + DR[d], c = (i % cols) + DC[d];
  while (r >= 0 && c >= 0 && r < rows && c < cols) {
    if (!isClue[r * cols + c]) out.push(r * cols + c);
    r += DR[d]; c += DC[d];
  }
  return out;
}

/** Build the compiled puzzle (and its solution string) from a loop, the shaded cells that stay shaded and the clue cells. */
export function buildPuzzle(rows, cols, loop, clueDir, name = 'gen') {
  const N = rows * cols;
  const isClue = new Uint8Array(N);
  for (const i of clueDir.keys()) isClue[i] = 1;
  const clues = [];
  for (const [i, d] of [...clueDir.entries()].sort((x, y) => x[0] - y[0])) {
    if (d < 0) { clues.push({ r: (i / cols) | 0, c: i % cols, d: 0, n: -1 }); continue; }     // a void cell (direction -1): no arrow, no number
    const n = rayOf(rows, cols, i, d, isClue).filter((j) => loop.holes[j] && !isClue[j]).length;
    clues.push({ r: (i / cols) | 0, c: i % cols, d, n });
  }
  const P = compile({ name, rows, cols, clues });
  const st = initialState(P);
  for (let i = 0; i < N; i++) if (!isClue[i]) st.cell[i] = loop.holes[i] ? SHADED : LOOP;
  for (let x = 0; x < 2 * N; x++) st.e[x] = loop.edges[x] ? E_ON : E_OFF;
  P.solution = encodeSolution(P, st);
  return P;
}

/**
 * A direction for a clue at i, or -1 if none is possible. Style options:
 *   edgeBias  (0..1) each axis is equally likely and the arrow points toward the nearer board edge with this probability (Nikoli's
 *             do, 66-84% of the time); without it, long rays are preferred (a clue pointing at a wall says little)
 *   dirs      allowed directions (indexes 0=U 1=R 2=D 3=L), e.g. [1] for "every arrow points right"
 *   numbers   'big' prefers directions whose line holds many boxes, 'small' prefers lines holding 0 or 1 (estimated from the
 *             solution's non-loop cells in the line that are not clues); 'zeros' wants every number 0, 'twos' wants every number
 *             at least 2, 'nozeros' every number at least 1 and otherwise leans big (all three are hard requirements: the finished puzzle must have them)
 */
function pickDirection(rows, cols, i, isClue, rng, edgeBias = null, dirs = null, numbers = null, holes = null, diagonal = 0) {
  const withDiag = diagonal > 0 || (dirs && dirs.some((d) => d >= 4));
  const lens = (withDiag ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3]).map((d) => rayOf(rows, cols, i, d, isClue).length);
  const weights = [0, 0, 0, 0, 0, 0, 0, 0];
  if (edgeBias === null || edgeBias === undefined) {
    for (let d = 0; d < 4; d++) weights[d] = lens[d] === 0 ? 0 : lens[d] * lens[d];
  } else {
    const r = (i / cols) | 0, c = i % cols;
    const toEdge = [r, cols - 1 - c, rows - 1 - r, c]; // cells between the clue and each edge: U R D L
    for (const [a, b] of [[0, 2], [1, 3]]) {          // the two axes: (up, down) and (right, left)
      const ok = [lens[a] > 0, lens[b] > 0];
      if (ok[0] && ok[1]) {
        const near = toEdge[a] === toEdge[b] ? (rng() < 0.5 ? a : b) : toEdge[a] < toEdge[b] ? a : b;
        weights[near] = edgeBias; weights[near === a ? b : a] = 1 - edgeBias;
      } else if (ok[0]) weights[a] = 1;
      else if (ok[1]) weights[b] = 1;
    }
  }
  if (withDiag) for (let d = 4; d < 8; d++) weights[d] = lens[d] === 0 ? 0 : lens[d] * lens[d];   // a diagonal is aimed like an arrow without an edge bias: long lines preferred
  for (let d = 0; d < (withDiag ? 8 : 4); d++) {
    if (dirs && !dirs.includes(d)) { weights[d] = 0; continue; }
    if (numbers && holes && weights[d] > 0) {
      const est = rayOf(rows, cols, i, d, isClue).filter((j) => holes[j] && !isClue[j]).length;
      weights[d] *= numbers === 'big' ? (1 + est) ** 2
        : numbers === 'zeros' ? Math.exp(-2.5 * est)
        : numbers === 'twos' ? (est >= 2 ? 1 + est : 0.05)
        : numbers === 'nozeros' ? (est >= 1 ? (1 + est) ** 2 : 0.05)
        : est <= 1 ? 1 : Math.exp(-1.2 * (est - 1));
    }
  }
  if (diagonal > 0) {                                  // `diagonal` is the share of the arrows that point diagonally (1: all of them)
    const so = weights.slice(0, 4).reduce((a, b) => a + b, 0), sd = weights.slice(4).reduce((a, b) => a + b, 0);
    if (so > 0 && sd > 0) for (let d = 0; d < 8; d++) weights[d] *= d < 4 ? (1 - diagonal) / so : diagonal / sd;
    else if (diagonal >= 1 && sd === 0) return -1;
  }
  const total = weights.reduce((x, y) => x + y, 0);
  if (!total) return -1;
  let x = rng() * total;
  for (let d = 0; d < 8; d++) { x -= weights[d]; if (x <= 0) return d; }
  return 0;
}

/** How far a puzzle is from the requested number style (0 = it has it). Part of the climb's objective. */
export function styleGap(P, numbers, minMean = 2.0, boxRange = null) {
  let gap = 0;
  if (boxRange && P.solution) {        // the share of the solution's non-loop cells (boxes and clues) that are boxes, wanted in [lo, hi]
    let boxes = 0;
    for (const ch of P.solution) if (ch === 'x') boxes++;
    const share = boxes / Math.max(1, boxes + P.clues.filter((c) => c.n >= 0).length);       // (a void is neither)
    gap += (Math.max(0, boxRange[0] - share) + Math.max(0, share - boxRange[1])) * 8;
  }
  return gap + numberGap(P, numbers, minMean);
}
function numberGap(P, numbers, minMean) {
  const n = P.clues.map((c) => c.n).filter((v) => v >= 0);                // the arrows' numbers (voids have none)
  if (!numbers || !n.length) return 0;
  const mean = n.reduce((a, b) => a + b, 0) / n.length;
  if (numbers === 'zeros') return n.filter((v) => v > 0).length / n.length * 6;
  if (numbers === 'twos') return n.filter((v) => v < 2).length / n.length * 6;
  if (numbers === 'nozeros') return n.filter((v) => v < 1).length / n.length * 6;
  if (numbers === 'big') return Math.max(0, minMean - mean) + Math.max(0, n.filter((v) => v === 0).length / n.length - 0.1) * 3;
  return Math.max(0, 0.85 - n.filter((v) => v <= 1).length / n.length) * 5; // 'small': mostly 0s and 1s
}
export const numbersOk = (P, numbers, minMean = 2.0, boxRange = null) => styleGap(P, numbers, minMean, boxRange) === 0;

/** How much the rules could not decide: undecided cells, plus loop cells that still miss a segment (half weight). */
function undecidedScore(P, st) {
  let u = 0;
  for (let i = 0; i < P.N; i++) {
    if (P.clueAt[i] >= 0) continue;
    if (st.cell[i] === UNKNOWN) u += 1;
    else if (st.cell[i] === LOOP) {
      let on = 0;
      for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_ON) on++; }
      if (on < 2) u += 0.5;
    }
  }
  return u;
}

/**
 * Generate one puzzle whose solution the rules find without trial and error. Returns { puzzle, stats } or null.
 * options: density (share of cells that are not on the loop), clump (chance of refusing a non-loop cell next to another),
 * shadeShare (share of the non-loop cells that start shaded; the rest are clue cells), prune (turn clues back into shaded
 * cells while the rules still solve it), upto (rule limit for the solvability check), budgetMs.
 *
 * Climb: the score is how many cells the rules leave undecided. A move re-aims a clue near an undecided cell or turns a
 * nearby shaded cell into a clue; it is kept if the score does not get worse.
 */
function attemptPuzzle(rows, cols, rng, { tight = true, loopGate = true, density = 0.3, clump = 0.5, shadeShare = 0.55, edgeBias = null, oneDirection = false, directions = null, numbers = null, minMean = 2.0, boxRange = null, cheapFirst = null, fullBelow = null, prune = true, voids = 0, diagonal = 0, upto, maxIter = 6000, acceptU = 30, restarts = 12, tightArrows = 0, diagnose = null, name = 'gen', budgetMs = 120000, verbose = false } = {}) {
  const t0 = Date.now();
  const say = (...a) => { if (verbose) console.error('  gen:', ...a); };
  const dirs = oneDirection ? [(rng() * 4) | 0] : directions;
  let loop = null;
  let looked = 0;
  if (tight) {
    // build a loop that is unique by repair (tightLoop); the climb then only has to fix which holes are boxes and which are clues
    for (let tries = 0; tries < 50 && !loop && Date.now() - t0 < budgetMs; tries++) {
      const plan = tightArrows > 0 ? plantTightArrows(rows, cols, rng, tightArrows) : null;
      // An attempt either finishes within about 2.5 * N iterations or never does (measured on ~130 attempts from 10x10 to 20x36: at most 106,
      // 233, 892 and 1018 iterations at 10x10, 14x14, 20x20 and 20x36; the failures ran to the 30 s cap), so give up early and start over:
      // loop construction at 14x14 went from about 3.6 s to 0.2 s per loop. Counted in iterations, not milliseconds, so a seed gives the
      // same puzzle on a slow or a fast machine.
      const cand = tightLoop(rows, cols, rng, { startDensity: Math.min(density, 0.24), clump, preset: plan, maxIters: (plan ? 8 : 4) * rows * cols + (plan ? 400 : 200), budgetMs: Math.min(30000, budgetMs - (Date.now() - t0)) });
      if (cand) cand.plan = plan;
      looked++;
      if (cand) loop = cand;
    }
  } else {
    for (let tries = 0; tries < 20000 && !loop && Date.now() - t0 < budgetMs; tries++) {
      const cand = randomLoop(rows, cols, rng, { density, clump });
      if (!cand) continue;
      looked++;
      if (!loopGate || loopIsUnique(rows, cols, cand.holes)) loop = cand;   // only climb on a loop that can be unique at all
    }
  }
  if (!loop) { say(`no loop with a unique routing among ${looked} candidates`); return null; }
  say(`loop with a unique routing found after ${looked} candidate(s), ${Date.now() - t0} ms`);
  const N = rows * cols;
  const clueDir = new Map();
  const isClue = new Uint8Array(N);
  const setClue = (i, d) => { clueDir.set(i, d); isClue[i] = 1; };
  const dropClue = (i) => { clueDir.delete(i); isClue[i] = 0; };
  const fixed = new Uint8Array(N);                                   // planted tight-arrow cells: never changed
  // holes -> a random non-touching subset becomes shaded (about shadeShare of the holes), every other hole is a clue cell
  const holes = [];
  for (let i = 0; i < N; i++) if (loop.holes[i]) holes.push(i);
  const keep = new Uint8Array(N);
  let kept = 0;
  if (loop.plan) {
    for (const [c, d] of loop.plan.clues) { setClue(c, d); fixed[c] = 1; }
    for (const bx of loop.plan.boxes) { keep[bx] = 1; fixed[bx] = 1; kept++; }
  }
  if (voids > 0) {                                                   // void cells: some of the holes are neither a box nor an arrow (fixed, never changed)
    const spare = shuffle(holes.filter((q) => !fixed[q]), rng);
    if (spare.length < voids + 2) return null;
    for (const i of spare.slice(0, voids)) { setClue(i, -1); fixed[i] = 1; }
  }
  for (const i of shuffle(holes.filter((q) => !fixed[q]), rng)) {
    if (kept >= holes.length * shadeShare) break;
    if (gridNeighbours(rows, cols, i).every((j) => !keep[j])) { keep[i] = 1; kept++; }
  }
  for (const i of holes) if (!keep[i] && !fixed[i]) { const d = pickDirection(rows, cols, i, isClue, rng, edgeBias, dirs, numbers, loop.holes, diagonal); if (d >= 0) setClue(i, d); else keep[i] = 1; }
  // a "shaded" cell is a hole that is not a clue; make sure those do not touch (clue cells that failed to point anywhere were kept shaded)
  for (const i of holes) if (!isClue[i] && gridNeighbours(rows, cols, i).some((j) => loop.holes[j] && !isClue[j] && j < i)) { const d = pickDirection(rows, cols, i, isClue, rng, edgeBias, dirs, numbers, loop.holes, diagonal); if (d < 0) return null; setClue(i, d); }

  // Two-phase check, because the Hard rules are expensive (on a stuck 20x36 board: 112 ms with them, 4 ms without). The climb
  // normally uses only the Beginner and Medium rules; when that leaves few cells undecided it asks the full rule set.
  const cheapUpto = RULES.findIndex((r) => r.id === 'shadeForcesLines');   // everything before it is cheap (crossingParity is Hard-tier but cheap)
  const useCheap = (cheapFirst === null ? N >= 150 : cheapFirst) && upto === undefined;
  const fullLimit = fullBelow === null ? Math.max(20, N * 0.08) : fullBelow;
  const evaluate = () => {
    const P = buildPuzzle(rows, cols, loop, clueDir, name);
    let r = solvedByRules(P, useCheap ? cheapUpto : upto);
    let base = r.solved ? 0 : undecidedScore(P, r.state) + 0.001;
    if (useCheap && !r.solved && base <= fullLimit) {
      r = solvedByRules(P, upto);
      base = r.solved ? 0 : undecidedScore(P, r.state) + 0.001;
    }
    const gap = styleGap(P, numbers, minMean, boxRange);
    return { P, r, gap, u: base + 3 * gap };
  };
  let cur = evaluate(), checks = 1, iter = 0;
  const dist = (a, b) => Math.abs(((a / cols) | 0) - ((b / cols) | 0)) + Math.abs((a % cols) - (b % cols));
  const canShade = (i) => gridNeighbours(rows, cols, i).every((j) => !(loop.holes[j] && !isClue[j]));
  // Accept when the rules solve it, or leave only a small undecided region and the exhaustive solver, started from what the
  // rules know, finds exactly one solution (a person finishes those with a little trial: the Hard tier's lookahead).
  let triedUnique = new Set();
  const acceptable = () => {
    if (cur.u === 0) return true;
    if (cur.gap > 0 || cur.u > acceptU) return false;
    const key = [...clueDir.entries()].join(';');
    if (triedUnique.has(key)) return false;
    triedUnique.add(key);
    const r = solve(cur.P, { limit: 2, state: cur.r.state, maxNodes: 20000 });
    return r.count === 1 && !r.exceeded; // a cut-off search proves nothing about uniqueness
  };
  let bestSeen = cur;
  for (; iter < maxIter && !acceptable() && Date.now() - t0 < budgetMs; iter++) {
    if (cur.u < bestSeen.u) bestSeen = cur;
    const temp = 0.6 * (1 - iter / maxIter) + 0.05; // simulated annealing: sometimes accept a worse position
    const und = [];
    for (let i = 0; i < N; i++) if (cur.P.clueAt[i] < 0 && (cur.r.state.cell[i] === UNKNOWN || cur.r.state.cell[i] === LOOP)) und.push(i);
    const target = und.length ? und[(rng() * und.length) | 0] : (rng() * N) | 0;
    const moves = [];
    for (let radius = 3; radius <= 8 && !moves.length; radius++) {
      for (let i = 0; i < N; i++) {
        if (!loop.holes[i] || fixed[i] || dist(i, target) > radius) continue;
        if (isClue[i]) { moves.push([i, 'aim'], [i, 'aim']); if (canShade(i)) moves.push([i, 'unclue']); } else moves.push([i, 'clue']);
      }
    }
    if (!moves.length) break;
    const [i, kind] = moves[(rng() * moves.length) | 0];
    const oldDir = clueDir.get(i);
    if (kind === 'aim') {
      const cand = (diagonal > 0 || (dirs && dirs.some((q) => q >= 4)) ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3]).filter((d) => d !== oldDir && (diagonal === 0 || (diagonal >= 1 ? d >= 4 : true)) && (!dirs || dirs.includes(d)) && rayOf(rows, cols, i, d, isClue).length > 0);
      if (!cand.length) continue;
      let nd = cand[(rng() * cand.length) | 0];
      if (edgeBias !== null || numbers || (diagonal > 0 && diagonal < 1)) { // keep the style (and the share of diagonal arrows): re-aim the way new clues are aimed
        for (let tries = 0; tries < 6; tries++) { const d = pickDirection(rows, cols, i, isClue, rng, edgeBias, dirs, numbers, loop.holes, diagonal); if (d >= 0 && d !== oldDir) { nd = d; break; } }
      }
      clueDir.set(i, nd);
    } else if (kind === 'unclue') {
      dropClue(i);
    } else {
      const d = pickDirection(rows, cols, i, isClue, rng, edgeBias, dirs, numbers, loop.holes, diagonal);
      if (d < 0) continue;
      setClue(i, d);
    }
    const next = evaluate(); checks++;
    if (next.u <= cur.u || rng() < Math.exp(-(next.u - cur.u) / temp)) cur = next;
    else if (kind === 'aim') clueDir.set(i, oldDir);
    else if (kind === 'unclue') setClue(i, oldDir);
    else dropClue(i);
  }
  if (diagnose && (!diagnose.best || bestSeen.u < diagnose.best.u)) diagnose.best = { u: bestSeen.u, P: bestSeen.P, state: bestSeen.r.state, clues: bestSeen.P.clues.length, iterations: iter };
  say(`${iter} iterations, ${checks} checks, undecided score ${cur.u.toFixed(1)}, ${clueDir.size} clues, ${Date.now() - t0} ms`);
  if (!acceptable()) return null;
  let puzzle = prune && cur.u === 0 ? pruneClues(rows, cols, loop, clueDir, isClue, rng, upto, name, t0, budgetMs, () => checks++, fixed, numbers, minMean) : cur.P;
  if (!numbersOk(puzzle, numbers, minMean, boxRange)) { say('rejected: the numbers are not in the requested style'); return null; }
  return { puzzle, stats: { iterations: iter, checks, ms: Date.now() - t0 } };
}

/** Generate a puzzle, restarting with a fresh loop whenever a climb stalls. Returns { puzzle, stats } or null. */
export function generatePuzzle(rows, cols, rng, options = {}) {
  const { restarts = 12, budgetMs = 120000, verbose = false } = options;
  const t0 = Date.now();
  for (let k = 0; k < restarts && Date.now() - t0 < budgetMs; k++) {
    const r = attemptPuzzle(rows, cols, rng, { ...options, budgetMs: budgetMs - (Date.now() - t0) });
    if (r) { r.stats.restarts = k; r.stats.ms = Date.now() - t0; return r; }
    if (verbose) console.error(`  gen: restart ${k + 1}`);
  }
  return null;
}

/** Turn clue cells back into shaded cells (where legal) while the rules still solve the puzzle. */
function pruneClues(rows, cols, loop, clueDir, isClue, rng, upto, name, t0, budgetMs, onCheck, fixed, numbers = null, minMean = 2.0) {
  // a hard number style ('zeros', 'twos') is a requirement of the finished puzzle: a new box must not land in an arrow's line and spoil
  // a number (before this, such a prune was rejected only at the very end, so every pruned zeros puzzle was thrown away)
  const hardStyle = numbers === 'zeros' || numbers === 'twos' || numbers === 'nozeros';
  const N = rows * cols;
  const order = shuffle([...clueDir.keys()].filter((i) => loop.holes[i]), rng);
  let P = buildPuzzle(rows, cols, loop, clueDir, name);
  for (const i of order) {
    if (Date.now() - t0 > budgetMs) break;
    if (fixed && fixed[i]) continue;                                 // a planted tight arrow stays
    // a shaded cell may not touch another shaded cell
    if (gridNeighbours(rows, cols, i).some((j) => loop.holes[j] && !isClue[j])) continue;
    const d = clueDir.get(i);
    clueDir.delete(i); isClue[i] = 0;
    const Q = buildPuzzle(rows, cols, loop, clueDir, name);
    if (hardStyle && numberGap(Q, numbers, minMean) > 0) { clueDir.set(i, d); isClue[i] = 1; continue; }
    onCheck();
    if (solvedByRules(Q, upto).solved) P = Q;
    else { clueDir.set(i, d); isClue[i] = 1; }
  }
  return P;
}

// ------------------------------------------------------------ regional puzzles (experiment)
//
// A regional puzzle has no arrows and no clue cells: the board is cut into regions and a number in a region says how many of its cells
// are shaded (a region may have no number). So the clues are the PARTITION and which regions carry a number; the solution's boxes are
// an independent set (no two touching) and the loop runs through all the other cells. As for arrows, the loop must be the only loop
// through the cells the boxes leave (the numbers can never change that), so the first step is a random loop with a unique routing; the
// climb then reshapes the regions until the rules solve the puzzle, and the pruning drops numbers while they still do.

/** The label cell of each region: its first cell in reading order (where the number is printed). */
function regionCellLists(owner) {
  let R = 0;
  for (const g of owner) if (g + 1 > R) R = g + 1;
  const cells = Array.from({ length: R }, () => []);
  owner.forEach((g, i) => cells[g].push(i));
  return cells;
}

/** The compiled regional puzzle (and its solution string) from a loop, the region of every cell and which regions carry a number. */
export function buildRegionalPuzzle(rows, cols, loop, owner, numbered, name = 'gen') {
  const N = rows * cols;
  const cells = regionCellLists(owner);
  const clues = [];
  cells.forEach((list, g) => {
    if (!numbered[g]) return;
    const i = list[0];
    clues.push({ r: (i / cols) | 0, c: i % cols, d: 0, n: list.filter((j) => loop.holes[j]).length, region: true });
  });
  clues.sort((a, b) => a.r - b.r || a.c - b.c);
  const P = compile({ name, rows, cols, clues, regions: Array.from(owner) });
  const st = initialState(P);
  for (let i = 0; i < N; i++) st.cell[i] = loop.holes[i] ? SHADED : LOOP;
  for (let x = 0; x < 2 * N; x++) st.e[x] = loop.edges[x] ? E_ON : E_OFF;
  P.solution = encodeSolution(P, st);
  return P;
}

/**
 * Cut the board into `count` connected regions by growing them from random seeds (no region gets more than maxSize cells).
 * With `spread` > 0 every region gets its own target size, drawn log-normally around N / count (spread is the log's standard deviation,
 * so 0.6 gives some regions of 2 or 3 cells and some three or four times the average, like a setter's), and grows toward it.
 */
export function growRegions(rows, cols, rng, count, maxSize = Infinity, spread = 0) {
  const N = rows * cols;
  const owner = new Int16Array(N).fill(-1);
  const size = new Int16Array(count);
  let target = null;
  if (spread > 0) {
    const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    const raw = Array.from({ length: count }, () => Math.exp(spread * normal()));
    const scale = N / raw.reduce((a, b) => a + b, 0);
    target = raw.map((x) => Math.max(2, Math.min(maxSize, Math.round(x * scale))));
  }
  const seeds = shuffle([...Array(N).keys()], rng).slice(0, count);
  seeds.forEach((i, g) => { owner[i] = g; size[g] = 1; });
  let active = seeds.map((_, g) => g);
  let left = N - count;
  while (left > 0) {
    if (!active.length) {                                            // every region is full or walled in: the rest joins its smallest neighbour
      for (let i = 0; i < N; i++) {
        if (owner[i] >= 0) continue;
        const near = gridNeighbours(rows, cols, i).map((j) => owner[j]).filter((g) => g >= 0);
        if (!near.length) continue;
        const g = near.reduce((a, b) => (size[a] <= size[b] ? a : b));
        owner[i] = g; size[g]++; left--;
      }
      continue;
    }
    const q = (rng() * active.length) | 0, g = active[q];
    const free = [];
    for (let i = 0; i < N; i++) if (owner[i] === g) for (const j of gridNeighbours(rows, cols, i)) if (owner[j] < 0) free.push(j);
    if (!free.length || size[g] >= maxSize || (target && size[g] >= target[g])) { active.splice(q, 1); continue; }
    const j = free[(rng() * free.length) | 0];
    owner[j] = g; size[g]++; left--;
  }
  return owner;
}

/** Regions that are straight bars: every row (or every column, when `vertical`) cut into pieces 2 to maxSize cells long. */
export function growBars(rows, cols, rng, vertical, maxSize = 5) {
  const owner = new Int16Array(rows * cols);
  const lines = vertical ? cols : rows, len = vertical ? rows : cols;
  let g = 0;
  for (let l = 0; l < lines; l++) {
    let pos = 0;
    while (pos < len) {
      let size = 2 + ((rng() * (maxSize - 1)) | 0);
      if (len - pos - size === 1) size++;                            // never leave a single cell at the end
      size = Math.min(size, len - pos);
      for (let k = 0; k < size; k++) owner[vertical ? (pos + k) * cols + l : l * cols + pos + k] = g;
      g++; pos += size;
    }
  }
  return owner;
}

/** Would region g stay in one piece if cell x left it? (cells of the other regions do not count) */
function staysConnected(rows, cols, owner, g, x) {
  const members = [];
  for (let i = 0; i < owner.length; i++) if (owner[i] === g && i !== x) members.push(i);
  if (members.length <= 1) return members.length === 1;
  const seen = new Set([members[0]]), stack = [members[0]];
  while (stack.length) {
    const i = stack.pop();
    for (const j of gridNeighbours(rows, cols, i)) if (j !== x && owner[j] === g && !seen.has(j)) { seen.add(j); stack.push(j); }
  }
  return seen.size === members.length;
}

/**
 * One try at a regional puzzle: a loop with a unique routing and independent boxes, regions grown at random, then a climb (move a border
 * cell to the neighbouring region) until the rules leave at most `acceptU` cells undecided and the exhaustive search finishes it uniquely,
 * then pruning. Returns { puzzle, stats } or null.
 * options: density (share of cells that are boxes), avgSize (average region size), spread (log-normal spread of the sizes: 0 = grown without
 * targets), minNumbered (pruning keeps at least this share of the regions numbered), maxSize, shape ('blob': grown at random; 'rows' / 'cols':
 * straight bars along every row / column, whose border cells only slide along the bar), stuck (after the climb keep removing numbers while the puzzle stays unique
 * by exhaustive search, until the rules no longer finish it but leave at most acceptU cells open: positions that need a technique the rules lack), prune, upto, maxIter, acceptU, budgetMs.
 */
function attemptRegional(rows, cols, rng, { density = 0.2, avgSize = 5, maxSize = 9, shape = 'blob', spread = 0, minNumbered = 0, stuck = false, prune = true, upto, maxIter = 3000, acceptU = 12, name = 'gen', budgetMs = 60000, verbose = false } = {}) {
  const t0 = Date.now();
  const say = (...a) => { if (verbose) console.error('  gen:', ...a); };
  const N = rows * cols;
  let loop = null, looked = 0;
  while (!loop && Date.now() - t0 < budgetMs * 0.5 && looked < 20000) {
    looked++;
    const cand = randomLoop(rows, cols, rng, { density, clump: 1, independent: true });
    if (cand && loopIsUnique(rows, cols, cand.holes)) loop = cand;
  }
  if (!loop) { say(`no loop with a unique routing among ${looked} candidates`); return null; }
  say(`loop with a unique routing after ${looked} candidate(s), ${Date.now() - t0} ms`);
  const bars = shape === 'rows' || shape === 'cols';
  const owner = bars ? growBars(rows, cols, rng, shape === 'cols', maxSize) : growRegions(rows, cols, rng, Math.max(2, Math.round(N / avgSize)), maxSize, spread);
  const numbered = new Uint8Array(N).fill(1);                          // by region id
  const size = new Int16Array(N);
  for (const g of owner) size[g]++;
  const evaluate = () => {
    const P = buildRegionalPuzzle(rows, cols, loop, owner, numbered, name);
    const r = solvedByRules(P, upto);
    return { P, r, u: r.solved ? 0 : undecidedScore(P, r.state) + 0.001 };
  };
  let cur = evaluate(), checks = 1, iter = 0;
  const triedUnique = new Set();
  const acceptable = () => {
    if (cur.u === 0) return true;
    if (cur.u > acceptU) return false;
    const key = Array.from(owner).join('.');
    if (triedUnique.has(key)) return false;
    triedUnique.add(key);
    const r = solve(cur.P, { limit: 2, state: cur.r.state, maxNodes: 20000 });
    return r.count === 1 && !r.exceeded;
  };
  const dist = (a, b) => Math.abs(((a / cols) | 0) - ((b / cols) | 0)) + Math.abs((a % cols) - (b % cols));
  for (; iter < maxIter && !acceptable() && Date.now() - t0 < budgetMs; iter++) {
    const temp = 0.6 * (1 - iter / maxIter) + 0.05;
    const und = [];
    for (let i = 0; i < N; i++) if (cur.r.state.cell[i] === UNKNOWN || cur.r.state.cell[i] === LOOP) und.push(i);
    const target = und.length ? und[(rng() * und.length) | 0] : (rng() * N) | 0;
    const moves = [];
    for (let radius = 2; radius <= 6 && !moves.length; radius++) {
      for (let i = 0; i < N; i++) {
        if (dist(i, target) > radius || size[owner[i]] < 2) continue;
        for (const j of gridNeighbours(rows, cols, i)) {
          if (owner[j] === owner[i] || size[owner[j]] >= maxSize) continue;
          if (bars && (shape === 'rows' ? ((i / cols) | 0) !== ((j / cols) | 0) : i % cols !== j % cols)) continue;      // a bar's end cell only slides along the bar
          moves.push([i, owner[j]]);
        }
      }
    }
    if (!moves.length) break;
    const [x, to] = moves[(rng() * moves.length) | 0];
    const from = owner[x];
    if (!staysConnected(rows, cols, owner, from, x)) continue;
    owner[x] = to; size[from]--; size[to]++;
    const next = evaluate(); checks++;
    if (next.u <= cur.u || rng() < Math.exp(-(next.u - cur.u) / temp)) cur = next;
    else { owner[x] = from; size[from]++; size[to]--; }
  }
  say(`${iter} iterations, ${checks} checks, undecided score ${cur.u.toFixed(1)}, ${Date.now() - t0} ms`);
  if (!acceptable()) return null;
  let puzzle = cur.P;
  if ((prune || stuck) && cur.u === 0) {
    const order = shuffle([...Array(N).keys()].filter((g) => size[g] > 0), rng);
    let left = order.length;                                                       // regions still numbered
    for (const g of order) {
      if (Date.now() - t0 > budgetMs) break;
      if (left <= minNumbered * order.length) break;
      numbered[g] = 0;
      const Q = buildRegionalPuzzle(rows, cols, loop, owner, numbered, name);
      checks++;
      const r = solvedByRules(Q, upto);
      let keep = r.solved;
      if (!keep && stuck && undecidedScore(Q, r.state) <= acceptU) {          // the rules stop short: fine if the search still finds exactly one answer
        const found = solve(Q, { limit: 2, state: r.state, maxNodes: 20000 });
        keep = found.count === 1 && !found.exceeded;
      }
      if (keep) { puzzle = Q; left--; } else numbered[g] = 1;
    }
    if (stuck && solvedByRules(puzzle, upto).solved) return null;               // nothing could be removed: not a stuck puzzle
  }
  {                                                                               // regions without a number that touch each other are merged (the border says nothing)
    const m = mergeBlankRegions(rows, cols, owner, (id) => !!numbered[id]);
    if (m.merged) {
      const owner2 = Int16Array.from(m.regions), numbered2 = new Uint8Array(N);
      numbered.forEach((x, g) => { if (x && size[g] > 0) numbered2[m.idOf(g)] = 1; });
      const Q = buildRegionalPuzzle(rows, cols, loop, owner2, numbered2, name);
      checks++;
      // the rules weigh the borders a little (the colour balance counts the boxes a region can hold), so keep the merge only if they still solve it
      if (stuck ? solve(Q, { limit: 2, maxNodes: 20000 }).count === 1 : solvedByRules(Q, upto).solved) puzzle = Q;
    }
  }
  return { puzzle, stats: { iterations: iter, checks, ms: Date.now() - t0 } };
}

/** Generate a regional puzzle, starting over with a fresh loop whenever a climb stalls. Returns { puzzle, stats } or null. */
export function generateRegional(rows, cols, rng, options = {}) {
  const { restarts = 20, budgetMs = 120000, verbose = false } = options;
  const t0 = Date.now();
  for (let k = 0; k < restarts && Date.now() - t0 < budgetMs; k++) {
    const r = attemptRegional(rows, cols, rng, { ...options, budgetMs: budgetMs - (Date.now() - t0) });
    if (r) { r.stats.restarts = k; r.stats.ms = Date.now() - t0; return r; }
    if (verbose) console.error(`  gen: restart ${k + 1}`);
  }
  return null;
}

// ------------------------------------------------------------ voids only (experiment)

/**
 * A puzzle with no numbers and no arrows at all, only void cells: the board's shape is the whole clue. Start from a loop whose routing is
 * unique (tightLoop; its holes become voids), then, while the exhaustive solver still finds a second solution, turn that solution's boxes
 * into voids too (the solution stays valid and has no boxes of its own; a box a puzzle's solution does not have gets pinned down the
 * same way). Ends when the solution is unique. Returns { puzzle, stats } or null (a search that does not finish, or the rules do
 * not solve it: only puzzles a person can do without trial and error are kept).
 */
export function generateVoidsOnly(rows, cols, rng, { name = 'gen', upto, budgetMs = 120000, maxNodes = 300000, startDensity = 0.24 } = {}) {
  const t0 = Date.now();
  const N = rows * cols;
  const make = (voids) => compile({ name, rows, cols, clues: [...voids].sort((a, b) => a - b).map((i) => ({ r: (i / cols) | 0, c: i % cols, d: 0, n: -1 })) });
  while (Date.now() - t0 < budgetMs) {
    const loop = tightLoop(rows, cols, rng, { startDensity, budgetMs: Math.min(5000, budgetMs - (Date.now() - t0)), maxIters: 8 * N + 200 });
    if (!loop) continue;
    const voids = new Set();
    for (let i = 0; i < N; i++) if (loop.holes[i]) voids.add(i);
    let P = make(voids), res = null, pins = 0;
    for (; pins < 80 && Date.now() - t0 < budgetMs; pins++) {
      P = make(voids);
      res = solve(P, { limit: 2, maxNodes });
      if (res.exceeded || res.count < 1 || res.count === 1) break;
      const withBoxes = res.solutions.map((st) => encodeSolution(P, st)).map((s) => [...s].flatMap((ch, i) => (ch === 'x' ? [i] : []))).filter((b) => b.length);
      if (!withBoxes.length) { res = null; break; }              // two different loops and no box to pin: this one cannot be fixed
      for (const i of withBoxes[(rng() * withBoxes.length) | 0]) voids.add(i);
    }
    if (!res || res.exceeded || res.count !== 1) continue;
    P.solution = encodeSolution(P, res.solutions[0]);
    if (!solvedByRules(P, upto).solved) continue;
    return { puzzle: P, stats: { pins, ms: Date.now() - t0 } };
  }
  return null;
}

// ------------------------------------------------------------ sparse puzzles (experiment)
//
// As few clues as possible, and difficulty does not matter, only that the solution is unique (the exhaustive solver decides: the rules
// are not asked, so a sparse puzzle may need more than they can do). Solution first, as everywhere: a loop, whose holes (the cells it
// leaves out) are boxes or clue cells in the solution. A hole pattern that admits two loops can never be fixed by clues (they decide
// which cells are boxes, never the loop's route), so the loop comes from tightLoop, whose routing is unique for its holes.
//
//   1. Start with a unique puzzle: greedy (add the clue, a hole and a direction, that leaves the FEWEST solutions, until one is left;
//      holes touch nobody, so any may be a box or a clue cell), or `fromRules` (an ordinary generatePuzzle puzzle, for boards where
//      greedy from nothing is slow: the exhaustive solver is cheap near a unique puzzle and costly far from one).
//      While very many solutions remain (a count that reaches `probeCap`) the best-scored candidate is simply taken: every exact count
//      would be the cap.
//      Counting every candidate's solutions exactly is too slow, so each is first scored by how many cells the solver's propagation
//      leaves undecided (a millisecond), and only the `shortlist` best are counted exactly (with the best count so far as the limit,
//      so a candidate that cannot win stops after a few solutions).
//   2. Sparsify: take clues back one by one (a clue cell turns into a box again) while it stays unique; then exchange: take m clues
//      away and look for n < m clues (any holes, any directions) that make it unique again, for (m, n) = (2, 1) and (3, 2). Each
//      success saves a clue. Candidates for an added clue are again the shortlist by propagation.
//      The exchanges are the expensive part, so only a try that has come within `polishWithin` clues of the best so far gets them.
//   3. Many solutions are tried and the sparsest kept (`bestOf`), or the first with at most `maxClues` clues is returned. A greedy
//      run that already needs more clues than the best so far is dropped at once.

/** The tools every sparse run shares: counting solutions, scoring candidates, the clue-removal and exchange search. */
export function sparseKit(rows, cols, rng, { name, directions, maxNodes, shortlist, rulesFirst, upto = null }) {
  const N = rows * cols;
  const undecided = (P) => {                                              // cells (and a little for edges) propagation leaves open: fewer is better
    const st = initialState(P);
    if (!propagate(P, st)) return Infinity;
    let u = 0;
    for (let i = 0; i < N; i++) if (st.cell[i] === UNKNOWN) u++;
    for (let x = 0; x < P.numEdges; x++) if (st.e[x] === E_UNKNOWN) u += 0.2;
    return u;
  };
  // Counting solutions. From scratch the solver's own propagation is weak: on a 12x12 board even a unique puzzle can take 8 s to prove
  // (and exceed any sensible node cap). The rules (sound, polynomial) get a position the search can finish from, in milliseconds.
  // With `upto` (a prefix length of the rule table, as generatePuzzle's) a puzzle counts as unique only when those rules alone solve it: the
  // rules are sound, so that proves it, and it caps the difficulty at the tier of the rules allowed. A puzzle they cannot finish counts as `limit`.
  const ruleUndecided = (P) => {                                          // cells the allowed rules leave open (the better score when they are the test)
    const st = initialState(P);
    const r = closure(P, st, upto);
    if (r.contradiction) return Infinity;
    let u = 0;
    for (let i = 0; i < N; i++) if (st.cell[i] === UNKNOWN) u++;
    for (let x = 0; x < P.numEdges; x++) if (st.e[x] === E_UNKNOWN) u += 0.2;
    return u;
  };
  const count = (P, limit) => {
    if (upto !== null) return solvedByRules(P, upto).solved ? 1 : limit;
    if (rulesFirst) {
      const br = solvedByRules(P);
      if (br.solved) return 1;
      const r = solve(P, { limit, maxNodes, state: br.state });
      return r.exceeded ? limit : r.count;
    }
    const r = solve(P, { limit, maxNodes });
    return r.exceeded ? limit : r.count;
  };
  const build = (loop, clueDir) => buildPuzzle(rows, cols, loop, clueDir, name);
  /** Every (hole, direction) not yet a clue, the most promising first. */
  const candidates = (loop, holes, clueDir, isClue) => {
    const cand = [];
    for (const h of holes) {
      if (clueDir.has(h)) continue;
      for (const d of directions) {
        if (!rayOf(rows, cols, h, d, isClue).length) continue;           // an arrow at a wall counts nothing
        clueDir.set(h, d); isClue[h] = 1;
        cand.push([h, d, undecided(build(loop, clueDir)) + rng() * 0.3]);
        clueDir.delete(h); isClue[h] = 0;
      }
    }
    return cand.sort((x, y) => x[2] - y[2]);
  };
  const mayBeBox = (loop, isClue, h) => !gridNeighbours(rows, cols, h).some((j) => loop.holes[j] && !isClue[j]);
  const combos = (arr, m) => {
    const out = [], cur = [];
    const rec = (from) => { if (cur.length === m) { out.push(cur.slice()); return; } for (let i = from; i < arr.length; i++) { cur.push(arr[i]); rec(i + 1); cur.pop(); } };
    rec(0);
    return out;
  };
  /** Take clues back and exchange until nothing improves or `deadline` (a Date.now() value) passes. Changes clueDir and isClue. */
  const sparsify = (loop, holes, clueDir, isClue, deadline, { swaps = [[1, 0], [2, 1], [3, 2]], maxSubsets = 300 } = {}) => {
    const addSearch = (left) => {
      if (Date.now() > deadline) return false;
      for (const [h, d] of candidates(loop, holes, clueDir, isClue).slice(0, shortlist)) {
        clueDir.set(h, d); isClue[h] = 1;
        if (left === 1 ? count(build(loop, clueDir), 2) === 1 : addSearch(left - 1)) return true;
        clueDir.delete(h); isClue[h] = 0;
      }
      return false;
    };
    for (let improved = true; improved && Date.now() < deadline;) {
      improved = false;
      for (const [m, n] of swaps) {
        if (clueDir.size < m) continue;
        for (const subset of shuffle(combos([...clueDir.keys()], m), rng).slice(0, maxSubsets)) {
          if (Date.now() > deadline) break;
          const was = subset.map((h) => [h, clueDir.get(h)]);
          for (const h of subset) { clueDir.delete(h); isClue[h] = 0; }
          const ok = subset.every((h) => mayBeBox(loop, isClue, h)) && (n === 0 ? count(build(loop, clueDir), 2) === 1 : addSearch(n));
          if (ok) { improved = true; break; }
          for (const h of [...clueDir.keys()]) if (!isClue[h]) isClue[h] = 1;     // (an addSearch that failed has already undone its own)
          for (const [h, d] of was) { clueDir.set(h, d); isClue[h] = 1; }
        }
        if (improved) break;
      }
    }
  };
  return { undecided, ruleUndecided, count, build, candidates, sparsify };
}

/** The sparsest puzzle found: { puzzle, stats: { clues, tries, ms } }, or null if none within the budget. */
export function generateSparse(rows, cols, rng, { name = 'gen', maxClues = Infinity, bestOf = 1, budgetMs = 60000, directions = [0, 1, 2, 3], startDensity = 0.2, maxNodes = 300000, probeCap = 40, shortlist = 8, polish = true, polishMs = 30000, polishWithin = 2, swaps, fromRules = false, rulesFirst = null, upto = null } = {}) {
  const t0 = Date.now();
  const N = rows * cols;
  const kit = sparseKit(rows, cols, rng, { name, directions, maxNodes, shortlist, rulesFirst: rulesFirst === null ? N >= 64 : rulesFirst, upto });
  let best = null, found = 0, tries = 0;
  while (Date.now() - t0 < budgetMs && found < bestOf) {
    tries++;
    let loop, clueDir = new Map(), isClue = new Uint8Array(N), c = 0;
    if (fromRules) {
      // an ordinary rules-solvable puzzle: its loop and clues are the start
      const r = generatePuzzle(rows, cols, rng, { name, budgetMs: Math.max(1000, budgetMs - (Date.now() - t0)) });
      if (!r) continue;
      const sol = decodeSolution(r.puzzle, r.puzzle.solution);
      loop = { holes: new Uint8Array(N), edges: new Uint8Array(2 * N) };
      for (let i = 0; i < N; i++) if (sol.cell[i] === SHADED || r.puzzle.clueAt[i] >= 0) loop.holes[i] = 1;
      for (let x = 0; x < 2 * N; x++) if (sol.e[x] === E_ON) loop.edges[x] = 1;
      r.puzzle.clues.forEach((cl) => { clueDir.set(cl.r * cols + cl.c, cl.d); isClue[cl.r * cols + cl.c] = 1; });
      c = 1;
    } else {
      loop = tightLoop(rows, cols, rng, { startDensity, independent: true, clump: 1, budgetMs: Math.min(5000, budgetMs - (Date.now() - t0)), maxIters: 8 * N + 200 });
      if (!loop) continue;
      const bound = best ? best.clues + 1 : maxClues + 6;                       // greedy may overshoot the goal: sparsify takes clues back (and once there is a puzzle, a try needing more than one clue beyond it is dropped)
      const holes = [...Array(N).keys()].filter((i) => loop.holes[i]);
      for (;;) {
        c = kit.count(kit.build(loop, clueDir), probeCap);                     // (a probe: only "one" and "very many" matter here)
        if (c === 1 || clueDir.size >= bound || Date.now() - t0 >= budgetMs) break;
        const cand = kit.candidates(loop, holes, clueDir, isClue);
        if (!cand.length) break;
        let pick = cand[0];                                                     // far from unique, every count is the cap and says nothing: trust the propagation score
        if (upto !== null) {                                                    // rules as the test: re-score the best by propagation with what the allowed rules leave open
          let top = Infinity;
          for (const [h, d] of cand.slice(0, shortlist * 2)) {
            clueDir.set(h, d); isClue[h] = 1;
            const u = kit.ruleUndecided(kit.build(loop, clueDir));
            clueDir.delete(h); isClue[h] = 0;
            if (u < top) { top = u; pick = [h, d]; }
          }
        } else if (c < probeCap) {
          let top = c;
          for (const [h, d] of cand.slice(0, shortlist)) {
            clueDir.set(h, d); isClue[h] = 1;
            const k = kit.count(kit.build(loop, clueDir), top);
            clueDir.delete(h); isClue[h] = 0;
            if (k < top) { top = k; pick = [h, d]; }
            if (top === 1) break;
          }
        }
        clueDir.set(pick[0], pick[1]); isClue[pick[0]] = 1;
      }
    }
    if (c !== 1) continue;
    const holes = [...Array(N).keys()].filter((i) => loop.holes[i]);
    kit.sparsify(loop, holes, clueDir, isClue, t0 + budgetMs, { swaps: [[1, 0]] });                   // taking clues back is cheap
    if (polish && clueDir.size <= (best ? best.clues : Infinity) + polishWithin) {                    // exchanges are not: only for a try that is near the best
      kit.sparsify(loop, holes, clueDir, isClue, Math.min(t0 + budgetMs, Date.now() + polishMs), { swaps });
    }
    const P = kit.build(loop, clueDir);
    if (kit.count(P, 2) !== 1 || clueDir.size >= (best ? best.clues : Infinity)) continue;
    best = { puzzle: P, clues: clueDir.size };
    found++;
    if (best.clues <= maxClues) break;
  }
  return best ? { puzzle: best.puzzle, stats: { clues: best.clues, tries, ms: Date.now() - t0 } } : null;
}
