// Layout experiments: puzzles whose clue layout follows a pattern.
//
//   'symmetric'  the cells that are not on the loop (boxes, arrows) are the same after a half turn of the board, and so are the arrows
//                (an arrow at i pointing d has a twin at N - 1 - i pointing the opposite way). The numbers come from the solution, which
//                need not be symmetric itself. Boards with an even number of rows plus columns.
//   'frame'      every border cell is an arrow pointing inward or a void; the inside holds boxes and voids only, no arrows. So the clues
//                are the row and column counts, seen from both ends, and the voids are the shape.
//
// Same method as attemptPuzzle in js/generator.js: a loop that is unique for its holes is built first (tightLoop, so every puzzle is
// unique if the rules can solve it), then a climb chooses which holes are boxes, voids or arrows, and which way the arrows point.
import { solvedByRules } from './rating.js';
import { tightLoop, buildPuzzle, _internals } from './generator.js';
import { UNKNOWN, LOOP } from './logic.js';

const { gridNeighbours, undecidedScore, pickDirection, shuffle } = _internals;
const BOX = -2, VOID = -1;

/**
 * Returns { puzzle, stats } or null. options: mode, name, budgetMs, edgeBias, shadeShare, upto, prune, verbose;
 *   numbers  'nozeros' (no arrow says 0) or 'twos' (every arrow says 2 or more): a requirement of the finished puzzle
 *   uniform  (frame) every arrow says this number: a border cell whose count is another number becomes a void
 */
export function generateLayout(rows, cols, rng, { mode = 'symmetric', name = 'gen', budgetMs = 60000, edgeBias = 0.8, shadeShare = 0.6, upto, prune = true, verbose = false, maxIter = 4000, numbers = null, uniform = null } = {}) {
  const t0 = Date.now(), N = rows * cols;
  const say = (...a) => { if (verbose) console.error('  layout:', ...a); };
  const symmetric = mode === 'symmetric', frame = mode === 'frame';
  if (symmetric && (rows + cols) % 2) throw new Error('a half turn needs an even number of rows plus columns');
  if (frame && (rows < 6 || cols < 6 || rows % 2 || cols % 2)) throw new Error('a frame needs an even board of at least 6x6');
  const rot = (i) => N - 1 - i;
  const border = (i) => { const r = (i / cols) | 0, c = i % cols; return r === 0 || c === 0 || r === rows - 1 || c === cols - 1; };
  const inward = (i) => {                                          // the directions (0 up, 1 right, 2 down, 3 left) that point into the board from a border cell
    const r = (i / cols) | 0, c = i % cols, out = [];
    if (r === 0) out.push(2); if (r === rows - 1) out.push(0); if (c === 0) out.push(1); if (c === cols - 1) out.push(3);
    return out;
  };

  // 1. the loop (a frame: the loop of the inside, a board of its own, set into the border ring of holes)
  let loop = null;
  for (let tries = 0; tries < 60 && !loop && Date.now() - t0 < budgetMs; tries++) {
    if (!frame) { loop = tightLoop(rows, cols, rng, { startDensity: 0.2, symmetric, maxIters: 8 * N + 400, budgetMs: Math.min(20000, budgetMs - (Date.now() - t0)) }); continue; }
    const ir = rows - 2, ic = cols - 2, inner = tightLoop(ir, ic, rng, { startDensity: 0.15, maxIters: 8 * ir * ic + 400, budgetMs: Math.min(20000, budgetMs - (Date.now() - t0)) });
    if (!inner) continue;
    const holes = new Uint8Array(N).fill(1), edges = new Int8Array(2 * N);
    for (let j = 0; j < ir * ic; j++) {
      const f = (((j / ic) | 0) + 1) * cols + (j % ic) + 1;
      holes[f] = inner.holes[j]; edges[2 * f] = inner.edges[2 * j]; edges[2 * f + 1] = inner.edges[2 * j + 1];
    }
    loop = { holes, edges, stats: inner.stats };
  }
  if (!loop) { say('no loop'); return null; }
  say(`loop after ${Date.now() - t0} ms`);
  const holes = []; for (let i = 0; i < N; i++) if (loop.holes[i]) holes.push(i);

  // 2. the assignment: val[i] is BOX, VOID or an arrow direction for every hole; isClue marks arrows and voids
  const val = new Int8Array(N).fill(0);
  const isClue = new Uint8Array(N);
  const twin = (i) => (symmetric ? rot(i) : -1);
  const twinVal = (v) => (symmetric && v >= 0 ? (v + 2) % 4 : v);
  const put = (i, v) => { val[i] = v; isClue[i] = v === BOX ? 0 : 1; };
  const putPair = (i, v) => { put(i, v); if (symmetric) put(rot(i), twinVal(v)); };
  const boxAround = (i) => gridNeighbours(rows, cols, i).some((j) => loop.holes[j] && val[j] === BOX);
  const canBox = (i) => !boxAround(i) && (!symmetric || (rot(i) !== i && !boxAround(rot(i))));
  const aim = (i) => {
    if (frame) { const o = inward(i); return o[(rng() * o.length) | 0]; }
    const d = pickDirection(rows, cols, i, isClue, rng, edgeBias, null, numbers, loop.holes, 0);
    return d;
  };
  for (const i of holes) put(i, VOID);                              // (every hole starts as a void: not a box, so canBox only sees the boxes dealt so far)
  for (const i of shuffle([...holes], rng)) {
    if (symmetric && i > rot(i)) continue;                           // a twin is dealt with together
    if (frame && border(i)) { putPair(i, aim(i)); continue; }
    if (rng() < shadeShare && canBox(i)) { put(i, BOX); if (symmetric) put(rot(i), BOX); continue; }
    if (frame) continue;                                             // an interior void stays a void
    const d = aim(i); if (d < 0) return null; putPair(i, d);
  }

  const clueMap = () => { const m = new Map(); for (const i of holes) if (val[i] !== BOX) m.set(i, val[i]); return m; };
  const evaluate = () => {
    const P = buildPuzzle(rows, cols, loop, clueMap(), name);
    const r = solvedByRules(P, upto);
    const gap = P.clues.filter((c) => c.n >= 0 && ((numbers === 'nozeros' && c.n < 1) || (numbers === 'twos' && c.n < 2) || (uniform !== null && c.n !== uniform))).length;
    return { P, r, gap, u: (r.solved ? 0 : undecidedScore(P, r.state) + 0.001) + 3 * gap };
  };
  let cur = evaluate(), iter = 0, checks = 1;
  const dist = (a, b) => Math.abs(((a / cols) | 0) - ((b / cols) | 0)) + Math.abs((a % cols) - (b % cols));
  // the choices for a hole: what it can become besides what it is
  const options = (i) => {
    const out = [];
    if (frame) {
      if (border(i)) { out.push(VOID); for (const d of inward(i)) out.push(d); }
      else { out.push(VOID); if (canBox(i)) out.push(BOX); }
    } else {
      if (canBox(i)) out.push(BOX);
      for (let d = 0; d < 4; d++) out.push(d);
    }
    return out.filter((v) => v !== val[i]);
  };
  for (; iter < maxIter && cur.u > 0 && Date.now() - t0 < budgetMs; iter++) {
    const temp = 0.6 * (1 - iter / maxIter) + 0.05;
    const und = [];
    for (let i = 0; i < N; i++) if (cur.P.clueAt[i] < 0 && (cur.r.state.cell[i] === UNKNOWN || cur.r.state.cell[i] === LOOP)) und.push(i);
    const target = und.length ? und[(rng() * und.length) | 0] : (rng() * N) | 0;
    let cand = [];
    for (let radius = 3; radius <= 8 && !cand.length; radius++) cand = holes.filter((i) => dist(i, target) <= radius && (!symmetric || i < rot(i) || dist(rot(i), target) > radius));
    if (!cand.length) break;
    let i = cand[(rng() * cand.length) | 0];
    let opts = options(i), nv;
    const wrong = frame && uniform !== null && cur.gap > 0 ? cur.P.clues.filter((c) => c.n >= 0 && c.n !== uniform) : [];
    if (wrong.length && rng() < 0.4) { const c = wrong[(rng() * wrong.length) | 0]; i = c.r * cols + c.c; nv = VOID; opts = [VOID]; }   // a wrong number: the cell becomes a void
    else { if (!opts.length) continue; nv = opts[(rng() * opts.length) | 0]; }
    const old = val[i], oldTwin = symmetric ? val[rot(i)] : 0;
    putPair(i, nv);
    const next = evaluate(); checks++;
    if (next.u <= cur.u || rng() < Math.exp(-(next.u - cur.u) / temp)) cur = next;
    else { put(i, old); if (symmetric) put(rot(i), oldTwin); }
  }
  say(`${iter} iterations, ${checks} checks, undecided ${cur.u.toFixed(1)}, ${Date.now() - t0} ms`);
  if (cur.u > 0) return null;
  let puzzle = cur.P;
  if (prune && symmetric) {                                          // turn arrow pairs back into box pairs while the rules still solve it
    for (const i of shuffle(holes.filter((h) => val[h] >= 0 && h < rot(h)), rng)) {
      if (Date.now() - t0 > budgetMs) break;
      const old = val[i], oldTwin = val[rot(i)];
      if (!canBox(i)) continue;
      put(i, BOX); put(rot(i), BOX);
      const q = evaluate(); checks++;
      if (q.u === 0) puzzle = q.P; else { put(i, old); put(rot(i), oldTwin); }
    }
  }
  return { puzzle, stats: { iterations: iter, checks, ms: Date.now() - t0 } };
}
