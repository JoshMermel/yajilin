// Exactly symmetric puzzles: the whole puzzle (boxes, arrows, voids AND the numbers) is the same after a mirror, a transposition or a turn.
//
//   mirror      left <-> right        (an arrow pointing left becomes one pointing right; up and down stay)
//   transpose   across the diagonal   (square boards; up <-> left, down <-> right)
//   rot90       a quarter turn        (square boards; every arrow turns a quarter)
//   rot180      a half turn           (every arrow turns right round)
//
// Why the numbers come out symmetric too: a symmetry maps a puzzle to a puzzle, and a puzzle with ONE solution is its own image's only
// solution, so the loop is symmetric as well. A loop that is its own mirror image crosses the mirror line in exactly two places; a loop
// that is turned into itself cannot touch the centre. Those facts decide the shape of every puzzle here:
//   mirror      two rows (or two cells of the axis column) carry the loop across; the rest of the middle is holes, so a column of clues
//               (and voids) runs up the middle
//   transpose   the loop touches the diagonal in exactly two cells (both corners); every other diagonal cell is a hole, and none can carry an arrow
//   rot90, rot180  an odd board's centre is a hole
//
// The method: choose a symmetric set of holes (cells the loop skips: boxes, arrows, voids) that leaves exactly one loop (found by the ordinary
// solver: a unique loop is symmetric by the argument above), then climb over which holes are boxes, arrows and voids, always in whole
// orbits of the symmetry, as js/generator_layouts.js does for the layout experiments.
import { solve, compile, initialState, LOOP, E_ON, UNKNOWN } from './logic.js';
import { solvedByRules } from './rating.js';
import { buildPuzzle, tightLoop, _internals } from './generator.js';

const { gridNeighbours, undecidedScore, pickDirection, shuffle } = _internals;
const BOX = -2, VOID = -1;

export const SYMMETRY_MODES = ['mirror', 'transpose', 'rot90', 'rot180'];

/** The symmetry as data: map[i] = where cell i goes, dir(d) = where an arrow pointing d (0 up, 1 right, 2 down, 3 left) points afterwards. */
export function symmetryOf(name, rows, cols) {
  const N = rows * cols;
  const mk = (f) => Int32Array.from({ length: N }, (_, i) => { const [r, c] = f((i / cols) | 0, i % cols); return r * cols + c; });
  if ((name === 'transpose' || name === 'rot90') && rows !== cols) throw new Error(`${name} needs a square board`);
  if (name === 'mirror') return { name, order: 2, map: mk((r, c) => [r, cols - 1 - c]), dir: (d) => (d % 2 ? 4 - d : d) };
  if (name === 'transpose') return { name, order: 2, map: mk((r, c) => [c, r]), dir: (d) => [3, 2, 1, 0][d] };
  if (name === 'rot90') return { name, order: 4, map: mk((r, c) => [c, rows - 1 - r]), dir: (d) => (d + 1) % 4 };
  if (name === 'rot180') return { name, order: 2, map: mk((r, c) => [rows - 1 - r, cols - 1 - c]), dir: (d) => (d + 2) % 4 };
  throw new Error(`unknown symmetry ${name}`);
}

/** The cells a cell is carried to (itself first), each with the arrow direction it would have if the cell at the start pointed `d`. */
export function orbitOf(sym, i, d = -1) {
  const out = [];
  let cur = i, v = d;
  do { out.push({ cell: cur, dir: v }); cur = sym.map[cur]; v = v >= 0 ? sym.dir(v) : v; } while (cur !== i);
  return out;
}

const loopOracle = (rows, cols, holes, maxNodes) => {
  const clues = [];
  for (let i = 0; i < rows * cols; i++) if (holes[i]) clues.push({ r: (i / cols) | 0, c: i % cols, d: 1, n: -1 });
  const P = compile({ name: 'loop', rows, cols, clues });
  const st = initialState(P);
  for (let i = 0; i < rows * cols; i++) if (!holes[i]) st.cell[i] = LOOP;
  return solve(P, { limit: 2, maxNodes, state: st });
};

/**
 * A symmetric set of holes with exactly one loop through the other cells: { holes, edges } (edges as buildPuzzle wants them), or null.
 * Starts from a few holes and, while the loop is not unique, adds a whole orbit of holes where two alternative loops differ (keeping the
 * move only if some loop survives). The parity facts below only steer the search away from sets that can have no loop.
 */
export function symmetricHoles(rows, cols, symName, rng, { density = 0.1, maxIter = 400, maxNodes = 4000, budgetMs = 20000 } = {}) {
  const t0 = Date.now();
  const N = rows * cols, sym = symmetryOf(symName, rows, cols), g = sym.map;
  const color = (i) => (((i / cols) | 0) + (i % cols)) & 1;
  const orbit = (i) => orbitOf(sym, i).map((o) => o.cell);
  const preserves = color(g[1 % N]) === color(1 % N) && color(g[0]) === color(0);   // does the symmetry keep the chessboard colours?
  const attempt = () => {
    const holes = new Uint8Array(N), protect = new Uint8Array(N);
    const setOrbit = (i, v) => { for (const j of orbit(i)) holes[j] = v; };
    const freeCount = () => { let f = 0; for (let i = 0; i < N; i++) if (!holes[i]) f++; return f; };
    let target = 0, halfSide = null;          // target: what the colour balance must be; halfSide: the cells that count (mirror without an axis column counts only the left half)
    let parity;                                // parity(F): does a loop through F cells fit the symmetry?
    // the fixed points of the symmetry
    const fixedCells = []; for (let i = 0; i < N; i++) if (g[i] === i) fixedCells.push(i);
    const pickTwo = (cells) => shuffle(cells.slice(), rng).slice(0, 2);
    if (symName === 'rot90' || symName === 'rot180') {
      for (const i of fixedCells) holes[i] = 1;                              // the centre of an odd board
      const m = sym.order, shift = preserves ? 0 : m;                      // the cycle is carried round by L / m steps: that many must be even iff the colours are kept
      parity = (F) => F % (2 * m) === shift;
    } else if (symName === 'transpose') {
      const [a, b] = pickTwo(fixedCells);
      for (const i of fixedCells) holes[i] = 1;
      holes[a] = holes[b] = 0; protect[a] = protect[b] = 1;
      parity = (F) => F % 4 === (color(a) === color(b) ? 0 : 2);
    } else if (cols % 2) {                                                   // mirror with an axis column
      const [a, b] = pickTwo(fixedCells);
      for (const i of fixedCells) holes[i] = 1;
      holes[a] = holes[b] = 0; protect[a] = protect[b] = 1;
      parity = (F) => F % 4 === (color(a) === color(b) ? 0 : 2);
    } else {                                                                 // mirror, no axis column: two rows cross, the others' middle pairs are holes
      const rs = shuffle([...Array(rows).keys()], rng), [ra, rb] = rs;
      for (let r = 0; r < rows; r++) for (const c of [cols / 2 - 1, cols / 2]) { if (r === ra || r === rb) protect[r * cols + c] = 1; else holes[r * cols + c] = 1; }
      const la = ra * cols + cols / 2 - 1, lb = rb * cols + cols / 2 - 1;
      halfSide = (i) => i % cols < cols / 2;
      target = color(la) === color(lb) ? (color(la) ? 1 : -1) : 0;
      parity = (F) => F % 4 === (color(la) === color(lb) ? 2 : 0);
    }
    const balance = () => { let b = 0; for (let i = 0; i < N; i++) if (!holes[i] && (!halfSide || halfSide(i))) b += color(i) ? 1 : -1; return b - target; };
    const bad = () => Math.abs(balance()) + (parity(freeCount()) ? 0 : 1);
    // more orbits until the balance and the parity are right
    const fix = () => {
      for (let k = 0; k < 600 && bad() > 0; k++) {
        const i = (rng() * N) | 0; if (holes[i] || protect[i]) continue;
        const b0 = bad(); setOrbit(i, 1); if (bad() > b0) setOrbit(i, 0);
      }
      return bad() === 0;
    };
    for (let guard = 0, goal = Math.round(N * density); guard++ < 3000 && (holes.reduce((x, y) => x + y, 0) < goal || bad() > 0);) {
      const i = (rng() * N) | 0; if (holes[i] || protect[i]) continue;
      const b0 = bad(); setOrbit(i, 1); if (holes.reduce((x, y) => x + y, 0) > goal + 8 || (b0 > 0 && bad() > b0)) setOrbit(i, 0);
    }
    if (bad() > 0) return null;
    const edgesOf = (st) => { const e = new Int8Array(2 * N); for (let x = 0; x < 2 * N; x++) e[x] = st.e[x] === E_ON ? 1 : 0; return e; };
    let cur = loopOracle(rows, cols, holes, maxNodes), fails = 0;
    for (let it = 0; it < maxIter && Date.now() - t0 < budgetMs; it++) {
      if (!cur.exceeded && cur.count === 1) return { holes, edges: edgesOf(cur.solutions[0]) };
      if (!cur.exceeded && cur.count === 0) return null;
      const before = holes.slice();
      let c;
      if (cur.solutions.length === 2) {                                      // somewhere the two loops differ
        const [a, b] = cur.solutions, cells = new Set();
        for (let x = 0; x < 2 * N; x++) if (a.e[x] !== b.e[x]) { const v = x >> 1; cells.add(v); cells.add(x & 1 ? v + cols : v + 1); }
        const cand = [...cells].filter((q) => !holes[q] && !protect[q]);
        c = cand[(rng() * cand.length) | 0];
      } else {                                                               // too many loops to count: anywhere
        const free = []; for (let i = 0; i < N; i++) if (!holes[i] && !protect[i]) free.push(i);
        c = free[(rng() * free.length) | 0];
      }
      if (c === undefined) return null;
      setOrbit(c, 1);
      if (bad() > 0 && !fix()) { holes.set(before); if (++fails > 60) return null; continue; }
      const next = loopOracle(rows, cols, holes, maxNodes);
      if (!next.exceeded && next.count === 0) { holes.set(before); if (++fails > 60) return null; continue; }   // that killed every loop: try another
      cur = next; fails = 0;
    }
    return null;
  };
  while (Date.now() - t0 < budgetMs) { const r = attempt(); if (r) return r; }
  return null;
}

/**
 * A symmetric puzzle: { puzzle, stats } or null. options: name, budgetMs, edgeBias, shadeShare, upto, prune, verbose, maxIter, numbers, and
 *   layoutOnly  only the CLUE CELLS are symmetric: every clue cell has an image that is a clue cell, but the arrows point any way they like, the numbers
 *               are whatever the loop gives, and the boxes and the loop are not symmetric. (If the boxes were symmetric too, the loop would have to be: with
 *               every non-loop cell mapped to a non-loop cell, a unique loop is its own image, and so are the numbers when the arrows are twinned.
 *               That is how the half-turn 'symmetric' books, which twin their arrows, come out exactly symmetric.) A cell that is its own image may hold an arrow.
 *               The method: tightLoop makes some symmetric orbits of holes (the clue cells to be), then adds the other holes it needs for a unique loop, then climb over
 *               which whole orbits (the ones whose cells are all holes) are clues, and which way every arrow points; every other hole is a box.
 */
function generateOnce(rows, cols, symName, rng, { name = 'gen', budgetMs = 60000, edgeBias = 0.8, shadeShare = 0.6, upto, prune = true, verbose = false, maxIter = 4000, numbers = null, density = 0.1, layoutOnly = false, clueShare = 0.16 } = {}) {
  const t0 = Date.now(), N = rows * cols;
  const say = (...a) => { if (verbose) console.error('  symmetric:', ...a); };
  const sym = symmetryOf(symName, rows, cols), g = sym.map;
  let loop = null;
  const fixedBox = new Uint8Array(N);                             // layoutOnly: holes that no orbit of holes covers: boxes for good
  if (layoutOnly) {
    for (let tries = 0; tries < 60 && !loop && Date.now() - t0 < budgetMs; tries++) {
      const l = tightLoop(rows, cols, rng, { startDensity: 0.28, symmetric: sym, symmetricHoles: Math.round(clueShare * N), maxIters: 8 * N + 400, budgetMs: Math.min(20000, budgetMs - (Date.now() - t0)) });
      if (!l) continue;
      for (let i = 0; i < N; i++) fixedBox[i] = l.holes[i] && orbitOf(sym, i).some((o) => !l.holes[o.cell]) ? 1 : 0;
      let touching = false;                                       // two boxes that must stay boxes cannot touch
      for (let i = 0; i < N && !touching; i++) if (fixedBox[i] && gridNeighbours(rows, cols, i).some((j) => fixedBox[j])) touching = true;
      if (!touching) loop = l;
    }
  } else loop = symmetricHoles(rows, cols, symName, rng, { density, budgetMs: Math.min(30000, budgetMs) });
  if (!loop) { say('no symmetric loop'); return null; }
  say(`loop after ${Date.now() - t0} ms`);
  const holes = []; for (let i = 0; i < N; i++) if (loop.holes[i]) holes.push(i);

  const val = new Int8Array(N).fill(VOID);                        // BOX, VOID or an arrow direction, for every hole
  const isClue = new Uint8Array(N);
  const put = (i, v) => { val[i] = v; isClue[i] = v === BOX ? 0 : 1; };
  /** Set the whole orbit of i: i takes v, the others its image. */
  const putOrbit = (i, v) => {
    if (!layoutOnly) { for (const o of orbitOf(sym, i, v)) put(o.cell, o.dir); return; }
    for (const o of orbitOf(sym, i)) put(o.cell, v < 0 || o.cell === i ? v : aim(o.cell));   // the arrows of an orbit are chosen one by one
  };
  const boxAround = (j) => gridNeighbours(rows, cols, j).some((k) => loop.holes[k] && val[k] === BOX);
  const canBox = (i) => { const cells = orbitOf(sym, i).map((o) => o.cell); return cells.every((j) => !boxAround(j) && cells.every((k) => k === j || !gridNeighbours(rows, cols, j).includes(k))); };
  const arrowOK = (i, d) => layoutOnly || orbitOf(sym, i, d).every((o) => g[o.cell] !== o.cell || sym.dir(o.dir) === o.dir) && orbitOf(sym, i, d).every((o) => o.dir >= 0);
  const aim = (i) => {
    for (let k = 0; k < 8; k++) { const d = pickDirection(rows, cols, i, isClue, rng, edgeBias, null, numbers, loop.holes, 0); if (d >= 0 && arrowOK(i, d)) return d; }
    return -1;
  };
  const rep = (i) => Math.min(...orbitOf(sym, i).map((o) => o.cell));   // each orbit is dealt with at its smallest cell
  for (const i of holes) put(i, fixedBox[i] ? BOX : VOID);
  for (const i of shuffle(holes.filter((h) => !fixedBox[h]), rng)) {
    if (rep(i) !== i) continue;
    if (rng() < shadeShare && canBox(i)) { putOrbit(i, BOX); continue; }
    const d = aim(i);
    if (d >= 0) putOrbit(i, d);                                 // else it stays a void (a fixed cell that no arrow fits)
  }

  const clueMap = () => { const m = new Map(); for (const i of holes) if (val[i] !== BOX) m.set(i, val[i]); return m; };
  const evaluate = () => {
    const P = buildPuzzle(rows, cols, loop, clueMap(), name);
    const r = solvedByRules(P, upto);
    const gap = P.clues.filter((c) => c.n >= 0 && ((numbers === 'nozeros' && c.n < 1) || (numbers === 'twos' && c.n < 2))).length;
    return { P, r, gap, u: (r.solved ? 0 : undecidedScore(P, r.state) + 0.001) + 3 * gap };
  };
  let cur = evaluate(), iter = 0, checks = 1;
  const dist = (a, b) => Math.abs(((a / cols) | 0) - ((b / cols) | 0)) + Math.abs((a % cols) - (b % cols));
  const options = (i) => {
    const out = layoutOnly ? [] : [VOID];
    if (canBox(i)) out.push(BOX);
    for (let d = 0; d < 4; d++) if (arrowOK(i, d)) out.push(d);
    return out.filter((v) => v !== val[i]);
  };
  const free = holes.filter((i) => !fixedBox[i]);                 // (layoutOnly: the holes that can be clues)
  const reps = free.filter((i) => rep(i) === i);
  for (; iter < maxIter && cur.u > 0 && Date.now() - t0 < budgetMs; iter++) {
    const temp = 0.6 * (1 - iter / maxIter) + 0.05;
    const und = [];
    for (let i = 0; i < N; i++) if (cur.P.clueAt[i] < 0 && (cur.r.state.cell[i] === UNKNOWN || cur.r.state.cell[i] === LOOP)) und.push(i);
    const target = und.length ? und[(rng() * und.length) | 0] : (rng() * N) | 0;
    let cand = [];
    for (let radius = 3; radius <= 8 && !cand.length; radius++) cand = layoutOnly ? free.filter((i) => dist(i, target) <= radius) : reps.filter((i) => orbitOf(sym, i).some((o) => dist(o.cell, target) <= radius));
    if (!cand.length) break;
    const i = cand[(rng() * cand.length) | 0];
    if (layoutOnly && val[i] >= 0 && rng() < 0.6) {                // one arrow turns, its images stay
      const nv = [0, 1, 2, 3].filter((d) => d !== val[i])[(rng() * 3) | 0], was = val[i];
      put(i, nv);
      const next = evaluate(); checks++;
      if (next.u <= cur.u || rng() < Math.exp(-(next.u - cur.u) / temp)) cur = next; else put(i, was);
      continue;
    }
    const opts = options(i);
    if (!opts.length) continue;
    const nv = opts[(rng() * opts.length) | 0];
    const old = orbitOf(sym, i).map((o) => [o.cell, val[o.cell]]);
    putOrbit(i, nv);
    const next = evaluate(); checks++;
    if (next.u <= cur.u || rng() < Math.exp(-(next.u - cur.u) / temp)) cur = next;
    else for (const [cell, v] of old) put(cell, v);
  }
  say(`${iter} iterations, ${checks} checks, undecided ${cur.u.toFixed(1)}, ${Date.now() - t0} ms`);
  if (cur.u > 0) return null;
  let puzzle = cur.P;
  if (prune) {                                                    // turn arrow orbits back into box orbits while the rules still solve it
    for (const i of shuffle(reps.filter((h) => val[h] >= 0), rng)) {
      if (Date.now() - t0 > budgetMs) break;
      if (!canBox(i)) continue;
      const old = orbitOf(sym, i).map((o) => [o.cell, val[o.cell]]);
      putOrbit(i, BOX);
      const q = evaluate(); checks++;
      if (q.u === 0) puzzle = q.P; else for (const [cell, v] of old) put(cell, v);
    }
  }
  return { puzzle, stats: { iterations: iter, checks, ms: Date.now() - t0 } };
}

/** See generateOnce. A symmetric-layout puzzle whose climb stalls is started again from a new loop (a stalled climb rarely recovers). */
export function generateSymmetric(rows, cols, symName, rng, opts = {}) {
  if (!opts.layoutOnly) return generateOnce(rows, cols, symName, rng, opts);
  const t0 = Date.now(), budgetMs = opts.budgetMs ?? 60000;
  while (Date.now() - t0 < budgetMs) {
    const r = generateOnce(rows, cols, symName, rng, { ...opts, maxIter: Math.min(opts.maxIter ?? 4000, 500), budgetMs: budgetMs - (Date.now() - t0) });
    if (r) return r;
  }
  return null;
}
