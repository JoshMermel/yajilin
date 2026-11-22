// Layout experiments: puzzles whose clue layout follows a pattern.
//
//   'symmetric'  the cells that are not on the loop (boxes, arrows) are the same after a half turn of the board, and so are the arrows
//                (an arrow at i pointing d has a twin at N - 1 - i pointing the opposite way). Boards with an even number of rows plus columns.
//                (Exactly symmetric: with every non-loop cell mapped to a non-loop cell a unique loop is its own image, so the numbers match too.)
//   'mirror', 'transpose', 'rot90', 'rot180'   exactly symmetric, numbers and loop too: js/generator_symmetry.js
//   'layout-mirror', 'layout-transpose', 'layout-rot90', 'layout-rot180'   only the clue cells are symmetric: boxes, arrows, numbers and the loop are free
//   'frame'      every border cell is an arrow pointing inward or a void; the inside holds boxes and voids only, no arrows. So the clues
//                are the row and column counts, seen from both ends, and the voids are the shape.
//
// Same method as attemptPuzzle in js/generator.js: a loop that is unique for its holes is built first (tightLoop, so every puzzle is
// unique if the rules can solve it), then a climb chooses which holes are boxes, voids or arrows, and which way the arrows point.
import { solvedByRules, RULES } from './rating.js';
import { tightLoop, buildPuzzle, _internals } from './generator.js';
import { UNKNOWN, LOOP } from './logic.js';
import { generateSymmetric, SYMMETRY_MODES } from './generator_symmetry.js';

const { gridNeighbours, undecidedScore, pickDirection, shuffle } = _internals;
const BOX = -2, VOID = -1;

/**
 * Returns { puzzle, stats } or null. options: mode, name, budgetMs, edgeBias, shadeShare, upto, prune, verbose;
 *   numbers  'nozeros' (no arrow says 0) or 'twos' (every arrow says 2 or more): a requirement of the finished puzzle
 *   uniform  (frame) every arrow says this number: a border cell whose count is another number becomes a void
 *   lattice  (frame) arrows only on every `lattice`-th row and column (the 2nd, 5th, 8th ... inside line, from both ends), each saying its real count, like
 *            stefliew's 20x20 on logic-masters.de (every third line, all 6); the rest of the border is void. (The Frame book avoids spacing 3: it is that puzzle's layout.)
 *   lines    (frame) { rows: [..], cols: [..] } the inside row / column indexes (1-based) that carry arrows, each saying its real count: an irregular set instead of
 *            a lattice (tools/generate.mjs --lines 2,4,7,11/3,6,9,12; one list for both axes, or rows/cols)
 */
export function generateLayout(rows, cols, rng, { mode = 'symmetric', name = 'gen', budgetMs = 60000, edgeBias = 0.8, shadeShare = 0.6, upto, prune = true, verbose = false, maxIter = 4000, numbers = null, uniform = null, lattice = 0, lines = null } = {}) {
  if (SYMMETRY_MODES.includes(mode)) return generateSymmetric(rows, cols, mode, rng, { name, budgetMs, edgeBias, shadeShare, upto, prune, verbose, maxIter, numbers });
  if (mode.startsWith('layout-') && SYMMETRY_MODES.includes(mode.slice(7))) return generateSymmetric(rows, cols, mode.slice(7), rng, { name, budgetMs, edgeBias, shadeShare, upto, prune, verbose, maxIter, numbers, layoutOnly: true });   // only the layout is symmetric   // exact symmetry: js/generator_symmetry.js
  if (mode === 'frame' && (uniform !== null || lattice || lines)) return generateSparseFrame(rows, cols, rng, { name, budgetMs, shadeShare, upto, prune, verbose, maxIter, uniform, lattice, lines });
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

/**
 * A frame whose arrows all say the same number (`uniform`: a number, or 'auto' for the most common count of the first draft). Most of
 * the border is voids: a border cell is an arrow only if its line holds exactly that many boxes, and the climb is only over which of the
 * inside holes are boxes and which are voids (so the arrows follow from the boxes). Corners are voids (their line is the border itself).
 * After the climb the arrows are thinned out while the rules still solve it.
 */
function generateSparseFrame(rows, cols, rng, { name, budgetMs, shadeShare, upto, prune, verbose, maxIter, uniform, lattice, lines }) {
  const fixedLines = !!(lattice || lines);                          // arrows on chosen lines (a lattice or an explicit set), each with its real count
  const rowSet = lines ? new Set(lines.rows) : null, colSet = lines ? new Set(lines.cols) : null;
  const isLine = (axis, k) => (lines ? (axis === 'r' ? rowSet : colSet).has(k) : (k - 1) % lattice === 1 % lattice);
  shadeShare = Math.max(shadeShare, 0.8);                           // (almost every inside hole starts as a box: the counts have to get big)
  const t0 = Date.now(), N = rows * cols, ir = rows - 2, ic = cols - 2;
  const say = (...a) => { if (verbose) console.error('  frame:', ...a); };
  let loop = null;
  for (let tries = 0; tries < 60 && !loop && Date.now() - t0 < budgetMs; tries++) {
    // a line has about shadeShare * density * (its length) boxes, so ask for the density that puts the average at the wanted number
    const dens = fixedLines ? 0.3 : typeof uniform === 'number' ? Math.min(0.5, Math.max(0.2, uniform / (shadeShare * ic))) : 0.2;
    const inner = tightLoop(ir, ic, rng, { startDensity: dens, maxDensity: 0.6, maxIters: 8 * ir * ic + 400, budgetMs: Math.min(20000, budgetMs - (Date.now() - t0)) });
    if (!inner) continue;
    const holes = new Uint8Array(N).fill(1), edges = new Int8Array(2 * N);
    for (let j = 0; j < ir * ic; j++) {
      const f = (((j / ic) | 0) + 1) * cols + (j % ic) + 1;
      holes[f] = inner.holes[j]; edges[2 * f] = inner.edges[2 * j]; edges[2 * f + 1] = inner.edges[2 * j + 1];
    }
    loop = { holes, edges };
  }
  if (!loop) { say('no loop'); return null; }
  const border = (i) => { const r = (i / cols) | 0, c = i % cols; return r === 0 || c === 0 || r === rows - 1 || c === cols - 1; };
  const inside = []; for (let i = 0; i < N; i++) if (!border(i) && loop.holes[i]) inside.push(i);
  const isBox = new Uint8Array(N);
  const boxNext = (i) => gridNeighbours(rows, cols, i).some((j) => isBox[j]);
  for (const i of shuffle([...inside], rng)) if (rng() < shadeShare && !boxNext(i)) isBox[i] = 1;
  const lineCount = () => {                                        // boxes in each inside row and column
    const rc = new Int32Array(rows), cc = new Int32Array(cols);
    for (const i of inside) if (isBox[i]) { rc[(i / cols) | 0]++; cc[i % cols]++; }
    return { rc, cc };
  };
  const target = fixedLines && uniform !== null ? (uniform === 'auto' ? Math.floor(ir / (lattice || 3)) : uniform) : null;     // lattice + uniform: every arrow should say this
  if (uniform === 'auto' && !fixedLines) {
    const { rc, cc } = lineCount(), freq = new Map();
    for (let r = 1; r < rows - 1; r++) freq.set(rc[r], (freq.get(rc[r]) || 0) + 1);
    for (let c = 1; c < cols - 1; c++) freq.set(cc[c], (freq.get(cc[c]) || 0) + 1);
    uniform = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  }
  const keepArrow = new Set();                                      // border cells whose arrow is thinned out
  const arrowLines = (axis) => {                                     // the arrow lines (inside row / column indexes) that should hold `target` boxes
    const out = []; for (let k = 1; k <= (axis === 'r' ? ir : ic); k++) if (isLine(axis, k)) out.push(k);
    return out;
  };
  const gapOf = () => {
    if (target === null) return 0;
    const { rc, cc } = lineCount(); let g = 0;
    for (const k of arrowLines('r')) g += Math.abs(rc[k] - target);
    for (const k of arrowLines('c')) g += Math.abs(cc[k] - target);
    return g;
  };
  const clueMap = () => {
    const { rc, cc } = lineCount(), m = new Map();
    for (const i of inside) if (!isBox[i]) m.set(i, -1);
    for (let i = 0; i < N; i++) {
      if (!border(i)) continue;
      const r = (i / cols) | 0, c = i % cols, corner = (r === 0 || r === rows - 1) && (c === 0 || c === cols - 1);
      let d = -1;
      if (!corner && !keepArrow.has(i)) {
        const on = (axis, line, count) => (fixedLines ? isLine(axis, line) : count === uniform);       // lattice: the 2nd, 5th, 8th ... inside line
        if (r === 0 && on('c', c, cc[c])) d = 2; else if (r === rows - 1 && on('c', c, cc[c])) d = 0;
        else if (c === 0 && on('r', r, rc[r])) d = 1; else if (c === cols - 1 && on('r', r, rc[r])) d = 3;
      }
      m.set(i, d);
    }
    return m;
  };
  // as in attemptPuzzle: the Hard rules are expensive, so the climb asks only the cheap ones until few cells are left undecided
  const cheapUpto = RULES.findIndex((r) => r.id === 'shadeForcesLines'), useCheap = N >= 150 && upto === undefined, fullLimit = Math.max(20, N * 0.08);
  const evaluate = () => {
    const P = buildPuzzle(rows, cols, loop, clueMap(), name);
    let r = solvedByRules(P, useCheap ? cheapUpto : upto), u = r.solved ? 0 : undecidedScore(P, r.state) + 0.001;
    if (useCheap && !r.solved && u <= fullLimit) { r = solvedByRules(P, upto); u = r.solved ? 0 : undecidedScore(P, r.state) + 0.001; }
    const gap = gapOf();
    return { P, r, u: u + 2 * gap, gap };
  };
  let cur = evaluate(), iter = 0, checks = 1;
  const dist = (a, b) => Math.abs(((a / cols) | 0) - ((b / cols) | 0)) + Math.abs((a % cols) - (b % cols));
  for (; iter < maxIter && cur.u > 0 && Date.now() - t0 < budgetMs; iter++) {
    const temp = 0.6 * (1 - iter / maxIter) + 0.05;
    const und = [];
    for (let i = 0; i < N; i++) if (cur.P.clueAt[i] < 0 && (cur.r.state.cell[i] === UNKNOWN || cur.r.state.cell[i] === LOOP)) und.push(i);
    const target = und.length ? und[(rng() * und.length) | 0] : inside[(rng() * inside.length) | 0];
    let cand = [];
    for (let radius = 3; radius <= 10 && !cand.length; radius++) cand = inside.filter((i) => dist(i, target) <= radius);
    if (!cand.length) break;
    let i = cand[(rng() * cand.length) | 0];
    if (target !== null && cur.gap > 0 && rng() < 0.35) {          // a line with the wrong count: add a box on it, or take one off
      const { rc, cc } = lineCount(), bad = [];
      for (const k of arrowLines('r')) if (rc[k] !== target) bad.push(['r', k, rc[k] < target]);
      for (const k of arrowLines('c')) if (cc[k] !== target) bad.push(['c', k, cc[k] < target]);
      if (bad.length) {
        const [ax, k, more] = bad[(rng() * bad.length) | 0];
        const onLine = inside.filter((q) => (ax === 'r' ? ((q / cols) | 0) === k : q % cols === k) && (more ? !isBox[q] && !boxNext(q) : isBox[q]));
        if (onLine.length) i = onLine[(rng() * onLine.length) | 0];
      }
    }
    if (!isBox[i] && boxNext(i)) continue;
    isBox[i] ^= 1;
    const next = evaluate(); checks++;
    if (next.u <= cur.u || rng() < Math.exp(-(next.u - cur.u) / temp)) cur = next; else isBox[i] ^= 1;
  }
  say(`${iter} iterations, ${checks} checks, undecided ${cur.u.toFixed(1)}, all say ${uniform}, ${Date.now() - t0} ms`);
  if (cur.u > 0) return null;
  let puzzle = cur.P;
  if (prune) {                                                      // thin the arrows out while the rules still solve it
    const arrows = puzzle.clues.filter((c) => c.n >= 0).map((c) => c.r * cols + c.c);
    for (const i of shuffle(arrows, rng)) {
      if (Date.now() - t0 > budgetMs) break;
      keepArrow.add(i);
      const q = evaluate(); checks++;
      if (q.u === 0) puzzle = q.P; else keepArrow.delete(i);
    }
  }
  if (puzzle.clues.filter((c) => c.n >= 0).length < 2) return null;
  return { puzzle, stats: { iterations: iter, checks, ms: Date.now() - t0, uniform } };
}
