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
import { compile, initialState, encodeSolution, solve, SHADED, LOOP, E_ON, E_OFF, DR, DC, UNKNOWN } from './logic.js';
import { solvedByRules } from './rating.js';

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
 * A random loop: { holes: Uint8Array (1 = a cell the loop does not visit), edges: Int8Array (numEdges, 1 = loop segment) }
 * for a rows x cols board, or null if this attempt failed (callers just try again). The holes are where the shaded and
 * the clue cells will go; choosing which is the generator's business.
 *
 * Start from a random 2-factor of the whole grid (every cell has two loop neighbours: a set of cycles) and merge it into
 * one cycle with local flips. Then make cells holes in nearby opposite-colour pairs: repair the 2-factor with augmenting
 * paths, merge it back to one cycle, and roll the pair back if either is impossible.
 */
export function randomLoop(rows, cols, rng, { density = 0.3, clump = 0.7, attemptsPerHole = 150, mergeRounds = 40, info = null } = {}) {
  const N = rows * cols;
  if (N % 2) throw new Error('rows * cols must be even');
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

  for (const v of shuffle([...Array(N).keys()], rng)) if (!fill(v)) return null;
  if (!mergeCycles()) { if (info) info.fail = 'merge0'; return null; }

  // make cells holes in nearby opposite-colour pairs, keeping a single cycle through what is left
  const target = Math.round((N * density) / 2) * 2;
  let holes = 0;
  const near = (a, b, dist) => Math.abs(((a / cols) | 0) - ((b / cols) | 0)) + Math.abs((a % cols) - (b % cols)) <= dist;
  // `clump` is the chance of refusing a hole next to another hole, so the non-loop cells are mostly scattered
  const okCell = (c) => !hole[c] && adj[c].every((w) => adj[w].length - 1 >= 2) && !(grid[c].some((w) => hole[w]) && rng() < clump);
  for (let attempt = 0; attempt < target * attemptsPerHole && holes < target; attempt++) {
    const c1 = (rng() * N) | 0;
    if (!okCell(c1)) continue;
    const c2 = (rng() * N) | 0;
    if (color(c2) === color(c1) || c2 === c1 || !near(c1, c2, 6) || !okCell(c2)) continue;
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
    if (ok) { holes += 2; continue; }
    partners = savedPartners;
    hole[c1] = hole[c2] = 0;
    touched.forEach((v, k) => { adj[v] = savedAdj[k]; });
  }
  if (info) info.holes = holes / N;
  if (holes < target * 0.7) { if (info) info.fail = 'holes'; return null; }
  const edges = new Int8Array(2 * N);
  for (let v = 0; v < N; v++) {
    if (hole[v]) continue;
    for (const w of partners[v]) {
      if (w <= v) continue;
      edges[w === v + 1 ? 2 * v : 2 * v + 1] = 1;
    }
  }
  return { holes: hole, edges };
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
 * A direction for a clue at i. With `edgeBias` (0..1, say 0.75), each axis is equally likely and the arrow points toward the
 * nearer board edge with that probability, the way Nikoli's do (66-84% of the arrows in three real puzzles, where a random
 * arrow would be 50%). Without it, long rays are preferred (a clue pointing at a wall says little).
 */
function pickDirection(rows, cols, i, isClue, rng, edgeBias = null) {
  const lens = [0, 1, 2, 3].map((d) => rayOf(rows, cols, i, d, isClue).length);
  if (edgeBias === null || edgeBias === undefined) {
    const weights = lens.map((l) => (l === 0 ? 0 : l * l));
    const total = weights.reduce((a, b) => a + b, 0);
    if (!total) return -1;
    let x = rng() * total;
    for (let d = 0; d < 4; d++) { x -= weights[d]; if (x <= 0) return d; }
    return 0;
  }
  const r = (i / cols) | 0, c = i % cols;
  const toEdge = [r, cols - 1 - c, rows - 1 - r, c]; // cells between the clue and each edge: U R D L
  const weights = [0, 0, 0, 0];
  for (const [a, b] of [[0, 2], [1, 3]]) {          // the two axes: (up, down) and (right, left)
    const ok = [lens[a] > 0, lens[b] > 0];
    if (ok[0] && ok[1]) {
      const near = toEdge[a] === toEdge[b] ? (rng() < 0.5 ? a : b) : toEdge[a] < toEdge[b] ? a : b;
      weights[near] = edgeBias; weights[near === a ? b : a] = 1 - edgeBias;
    } else if (ok[0]) weights[a] = 1;
    else if (ok[1]) weights[b] = 1;
  }
  const total = weights.reduce((x, y) => x + y, 0);
  if (!total) return -1;
  let x = rng() * total;
  for (let d = 0; d < 4; d++) { x -= weights[d]; if (x <= 0) return d; }
  return 0;
}

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
function attemptPuzzle(rows, cols, rng, { density = 0.3, clump = 0.5, shadeShare = 0.55, edgeBias = null, prune = true, upto, maxIter = 6000, acceptU = 30, restarts = 12, name = 'gen', budgetMs = 120000, verbose = false } = {}) {
  const t0 = Date.now();
  const say = (...a) => { if (verbose) console.error('  gen:', ...a); };
  let loop = null;
  for (let tries = 0; tries < 50 && !loop; tries++) loop = randomLoop(rows, cols, rng, { density, clump });
  if (!loop) { say('no loop after 50 tries'); return null; }
  const N = rows * cols;
  const clueDir = new Map();
  const isClue = new Uint8Array(N);
  const setClue = (i, d) => { clueDir.set(i, d); isClue[i] = 1; };
  const dropClue = (i) => { clueDir.delete(i); isClue[i] = 0; };
  // holes -> a random non-touching subset becomes shaded (about shadeShare of the holes), every other hole is a clue cell
  const holes = [];
  for (let i = 0; i < N; i++) if (loop.holes[i]) holes.push(i);
  const keep = new Uint8Array(N);
  let kept = 0;
  for (const i of shuffle(holes.slice(), rng)) {
    if (kept >= holes.length * shadeShare) break;
    if (gridNeighbours(rows, cols, i).every((j) => !keep[j])) { keep[i] = 1; kept++; }
  }
  for (const i of holes) if (!keep[i]) { const d = pickDirection(rows, cols, i, isClue, rng, edgeBias); if (d >= 0) setClue(i, d); else keep[i] = 1; }
  // a "shaded" cell is a hole that is not a clue; make sure those do not touch (clue cells that failed to point anywhere were kept shaded)
  for (const i of holes) if (!isClue[i] && gridNeighbours(rows, cols, i).some((j) => loop.holes[j] && !isClue[j] && j < i)) { const d = pickDirection(rows, cols, i, isClue, rng, edgeBias); if (d < 0) return null; setClue(i, d); }

  const evaluate = () => {
    const P = buildPuzzle(rows, cols, loop, clueDir, name);
    const r = solvedByRules(P, upto);
    return { P, r, u: r.solved ? 0 : undecidedScore(P, r.state) + 0.001 };
  };
  let cur = evaluate(), checks = 1, iter = 0;
  const dist = (a, b) => Math.abs(((a / cols) | 0) - ((b / cols) | 0)) + Math.abs((a % cols) - (b % cols));
  const canShade = (i) => gridNeighbours(rows, cols, i).every((j) => !(loop.holes[j] && !isClue[j]));
  // Accept when the rules solve it, or leave only a small undecided region and the exhaustive solver, started from what the
  // rules know, finds exactly one solution (a person finishes those with a little trial: the Hard tier's lookahead).
  let triedUnique = new Set();
  const acceptable = () => {
    if (cur.u === 0) return true;
    if (cur.u > acceptU) return false;
    const key = [...clueDir.entries()].join(';');
    if (triedUnique.has(key)) return false;
    triedUnique.add(key);
    const r = solve(cur.P, { limit: 2, state: cur.r.state, maxNodes: 20000 });
    return r.count === 1 && !r.exceeded; // a cut-off search proves nothing about uniqueness
  };
  for (; iter < maxIter && !acceptable() && Date.now() - t0 < budgetMs; iter++) {
    const temp = 0.6 * (1 - iter / maxIter) + 0.05; // simulated annealing: sometimes accept a worse position
    const und = [];
    for (let i = 0; i < N; i++) if (cur.P.clueAt[i] < 0 && (cur.r.state.cell[i] === UNKNOWN || cur.r.state.cell[i] === LOOP)) und.push(i);
    const target = und.length ? und[(rng() * und.length) | 0] : (rng() * N) | 0;
    const moves = [];
    for (let radius = 3; radius <= 8 && !moves.length; radius++) {
      for (let i = 0; i < N; i++) {
        if (!loop.holes[i] || dist(i, target) > radius) continue;
        if (isClue[i]) { moves.push([i, 'aim'], [i, 'aim']); if (canShade(i)) moves.push([i, 'unclue']); } else moves.push([i, 'clue']);
      }
    }
    if (!moves.length) break;
    const [i, kind] = moves[(rng() * moves.length) | 0];
    const oldDir = clueDir.get(i);
    if (kind === 'aim') {
      const dirs = [0, 1, 2, 3].filter((d) => d !== oldDir && rayOf(rows, cols, i, d, isClue).length > 0);
      if (!dirs.length) continue;
      let nd = dirs[(rng() * dirs.length) | 0];
      if (edgeBias !== null && edgeBias !== undefined) { // keep the style: re-aim the way new clues are aimed
        for (let tries = 0; tries < 6; tries++) { const d = pickDirection(rows, cols, i, isClue, rng, edgeBias); if (d >= 0 && d !== oldDir) { nd = d; break; } }
      }
      clueDir.set(i, nd);
    } else if (kind === 'unclue') {
      dropClue(i);
    } else {
      const d = pickDirection(rows, cols, i, isClue, rng, edgeBias);
      if (d < 0) continue;
      setClue(i, d);
    }
    const next = evaluate(); checks++;
    if (next.u <= cur.u || rng() < Math.exp(-(next.u - cur.u) / temp)) cur = next;
    else if (kind === 'aim') clueDir.set(i, oldDir);
    else if (kind === 'unclue') setClue(i, oldDir);
    else dropClue(i);
  }
  say(`${iter} iterations, ${checks} checks, undecided score ${cur.u.toFixed(1)}, ${clueDir.size} clues, ${Date.now() - t0} ms`);
  if (!acceptable()) return null;
  const puzzle = prune && cur.u === 0 ? pruneClues(rows, cols, loop, clueDir, isClue, rng, upto, name, t0, budgetMs, () => checks++) : cur.P;
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
function pruneClues(rows, cols, loop, clueDir, isClue, rng, upto, name, t0, budgetMs, onCheck) {
  const N = rows * cols;
  const order = shuffle([...clueDir.keys()].filter((i) => loop.holes[i]), rng);
  let P = buildPuzzle(rows, cols, loop, clueDir, name);
  for (const i of order) {
    if (Date.now() - t0 > budgetMs) break;
    // a shaded cell may not touch another shaded cell
    if (gridNeighbours(rows, cols, i).some((j) => loop.holes[j] && !isClue[j])) continue;
    const d = clueDir.get(i);
    clueDir.delete(i); isClue[i] = 0;
    const Q = buildPuzzle(rows, cols, loop, clueDir, name);
    onCheck();
    if (solvedByRules(Q, upto).solved) P = Q;
    else { clueDir.set(i, d); isClue[i] = 1; }
  }
  return P;
}
