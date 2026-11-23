// Yajilin: pure logic (no DOM). Used by the browser GUI and by the node tools.
//
// Rules: some cells are clue cells (an arrow and a number). Every other cell is either shaded or on the loop.
//   * shaded cells never touch each other orthogonally,
//   * a clue's number is how many shaded cells lie in its arrow's direction (to the board's edge),
//   * the loop is one closed cycle, through every cell that is neither a clue nor shaded.
//   * a VOID cell (a clue with n < 0, no arrow) is outside the puzzle: not shaded, not on the loop, not counted by any arrow (arrows skip
//     over it like a clue cell), and a box may touch it.
//   * REGIONAL puzzles (experiment): the board is cut into regions (`p.regions`, one region id per cell) and there are no arrows and no
//     clue cells. A region clue ({r, c, n, region: true}) counts the shaded cells of the region its cell lies in; the cell itself is an
//     ordinary cell (it can be shaded or on the loop). A region without a clue may hold any number of shaded cells.
//
// Coordinates: cell (r, c) has index r*cols + c. Directions are 0=U 1=R 2=D 3=L and 4..7 the diagonals (DR/DC below).
// Edges (loop segments between orthogonal neighbours): edge index 2*i is cell i's right edge (i - i+1),
// 2*i+1 is its bottom edge (i - i+cols). Edge states: 0 unknown, 1 on (loop passes), 2 off.
// Cell states: 0 unknown, 1 shaded, 2 loop, 3 clue.

/** Column letters like a spreadsheet: 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Directions: 0 up, 1 right, 2 down, 3 left, then the diagonals 4 up-right, 5 down-right, 6 down-left, 7 up-left (a diagonal arrow counts the
// cells along its diagonal to the board's edge; diagonal cells never touch orthogonally, so a whole diagonal may be shaded).
export const DR = [-1, 0, 1, 0, -1, 1, 1, -1];
export const DC = [0, 1, 0, -1, 1, 1, -1, -1];
export const DIR_LETTERS = 'URDLECZQ';       // E, C, Z, Q: the keyboard's diagonal keys (up-right, down-right, down-left, up-left)
export const isDiagonal = (d) => d >= 4;
/** The direction a quarter turn clockwise gives, and the one pointing back. */
export const turnDir = (d) => (d < 4 ? (d + 1) % 4 : 4 + ((d - 3) % 4));
export const oppositeDir = (d) => (d < 4 ? (d + 2) % 4 : 4 + ((d - 2) % 4));

export const UNKNOWN = 0, SHADED = 1, LOOP = 2, CLUE = 3;
export const E_UNKNOWN = 0, E_ON = 1, E_OFF = 2;

// HEX GRIDS (`p.grid === 'hex'`): pointy-top hexagons stored as rows x cols with every odd row shifted half a cell to the right ("odd-r"
// offset layout), so a board is a rectangle with a zigzag edge. A cell has six neighbours, in the directions
//   0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE   (clockwise from east; an arrow counts the cells in a straight line that way to the board's edge).
// Edges: edge 3*i + k (k = 0 E, 1 SE, 2 SW) joins cell i to its neighbour in direction k (there are 3 per cell, so numEdges = 3N); the other
// three directions share the neighbour's edges. Everything else (shaded cells never touch, one loop through every other cell) is unchanged.
export const HEX_DIR_LETTERS = 'ABCDEF';
export const HEX_ARROWS = ['→', '↘', '↙', '←', '↖', '↗'];
/** Steps between two cells of a hex board (odd rows shifted right). */
export function hexDistance(r1, c1, r2, c2) {
  const q1 = c1 - ((r1 - (r1 & 1)) >> 1), q2 = c2 - ((r2 - (r2 & 1)) >> 1), dq = q2 - q1, dr = r2 - r1;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** The cell one step from (r, c) in hex direction d, as [r, c] (maybe off the board). */
export function hexStep(r, c, d) {
  const odd = r & 1;
  switch (d) {
    case 0: return [r, c + 1];
    case 1: return [r + 1, odd ? c + 1 : c];
    case 2: return [r + 1, odd ? c : c - 1];
    case 3: return [r, c - 1];
    case 4: return [r - 1, odd ? c : c - 1];
    default: return [r - 1, odd ? c + 1 : c];
  }
}
export const oppositeHexDir = (d) => (d + 3) % 6;

/**
 * The ways a rows x cols hex board (odd rows shifted right) maps onto itself, as { cell(r, c) -> [r, c], dir(d) -> d }: the identity and one more.
 * A horizontal mirror is never one (it would swap which rows are shifted); a vertical flip is one when the number of rows is odd (the rows keep
 * their parity), and a half turn when it is even (the parity swaps, and so does the side the shift is on, which is what the shift needs).
 */
export function hexSymmetries(rows, cols) {
  const id = { cell: (r, c) => [r, c], dir: (d) => d };
  return [id, rows & 1
    ? { cell: (r, c) => [rows - 1 - r, c], dir: (d) => (6 - d) % 6 }                  // flip top to bottom: E, W stay, SE <-> NE, SW <-> NW
    : { cell: (r, c) => [rows - 1 - r, cols - 1 - c], dir: (d) => (d + 3) % 6 }];       // half turn
}

/** The characters of a hex puzzle's solution string: a loop cell's exit mask has 6 bits, so one of 64 symbols ('x' and '#' are taken). */
const SOL_ALPHABET = '0123456789abcdefghijklmnopqrstuvwyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/_';

/** Puzzle = { name, rows, cols, clues: [{r, c, d, n}], solution?: string, rules?, tier?, score? }.
 *  compile() adds the lookup tables every other function uses. */
export function compile(p) {
  const { rows, cols } = p;
  const N = rows * cols;
  const clueAt = new Int16Array(N).fill(-1);
  const labelAt = new Int16Array(N).fill(-1);                         // regional: the region clue whose number is drawn in this cell
  p.clues.forEach((cl, k) => {
    if (cl.region) {
      if (labelAt[cl.r * cols + cl.c] >= 0) throw new Error(`two region clues on cell ${cl.r},${cl.c}`);
      labelAt[cl.r * cols + cl.c] = k;
      return;                                                         // an ordinary cell, not a clue cell
    }
    if (clueAt[cl.r * cols + cl.c] >= 0) throw new Error(`two clues on cell ${cl.r},${cl.c}`);
    clueAt[cl.r * cols + cl.c] = k;
  });
  // regions (regional puzzles): the cells of each region, and the region of each cell
  let regionOf = null, regionCells = [];
  if (p.regions && p.regions.length) {
    if (p.regions.length !== N) throw new Error(`regions has ${p.regions.length} entries for ${N} cells`);
    regionOf = Int16Array.from(p.regions);
    regionCells = Array.from({ length: Math.max(...regionOf) + 1 }, () => []);
    for (let i = 0; i < N; i++) regionCells[regionOf[i]].push(i);
  } else if (p.clues.some((cl) => cl.region)) throw new Error('a region clue needs regions');
  // The topology: K neighbours per cell (4 on a square grid, 6 on a hex grid), and a list of edges with their two end cells.
  const hex = p.grid === 'hex';
  const K = hex ? 6 : 4;
  const numEdges = (hex ? 3 : 2) * N;
  const edgeA = new Int16Array(numEdges).fill(-1), edgeB = new Int16Array(numEdges).fill(-1);       // -1: no such edge (off the board)
  const stepOf = hex ? hexStep : (r, c, d) => [r + DR[d], c + DC[d]];
  // nb[i*K+d]: neighbour cell in direction d if both are non-clue cells, else -1. ed: the edge between them.
  const nb = new Int16Array(N * K).fill(-1);
  const ed = new Int16Array(N * K).fill(-1);
  for (let i = 0; i < N; i++) {
    const r = (i / cols) | 0, c = i % cols;
    for (let d = 0; d < K; d++) {
      const [nr, nc] = stepOf(r, c, d);
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const j = nr * cols + nc;
      // edge numbering: the square grid's 2i (right) and 2i+1 (bottom), the hex grid's 3i+0/1/2 (E, SE, SW); the other directions use the neighbour's
      const x = hex ? (d < 3 ? 3 * i + d : 3 * j + d - 3) : (d === 1 ? 2 * i : d === 2 ? 2 * i + 1 : d === 3 ? 2 * j : 2 * j + 1);
      if (edgeA[x] < 0) { edgeA[x] = Math.min(i, j); edgeB[x] = Math.max(i, j); }
      if (clueAt[i] >= 0 || clueAt[j] >= 0) continue;
      nb[i * K + d] = j;
      ed[i * K + d] = x;
    }
  }
  // rays[k]: the non-clue cells a clue counts shaded cells in.
  // pre-placed boxes: shaded cells given from the start (not clues, not on the loop)
  const boxIdx = (p.boxes || []).map((b) => b.r * cols + b.c);
  for (const i of boxIdx) if (clueAt[i] >= 0) throw new Error(`a box and a clue share cell ${i}`);
  const rays = p.clues.map((cl) => {
    const cells = [];
    if (cl.region) return regionCells[regionOf[cl.r * cols + cl.c]].slice();     // a region clue counts its whole region
    if (cl.n < 0) return cells;                   // a void cell has no line
    let [r, c] = stepOf(cl.r, cl.c, cl.d);
    while (r >= 0 && c >= 0 && r < rows && c < cols) {
      const i = r * cols + c;
      if (clueAt[i] < 0) cells.push(i);
      [r, c] = stepOf(r, c, cl.d);
    }
    return cells;
  });
  // The cells that count toward each cell's clues, for incremental use.
  const cluesOf = Array.from({ length: N }, () => []);
  rays.forEach((cells, k) => cells.forEach((i) => cluesOf[i].push(k)));
  // void cells: nothing goes there (not a box, not on the loop, no arrow); a clue with n < 0 (see the top of this file)
  const voidIdx = p.clues.filter((cl) => cl.n < 0).map((cl) => cl.r * cols + cl.c);
  const regional = regionOf !== null;
  if (regional) {                                                       // two numbers in one region would be two clues for the same cells
    const seen = new Set();
    for (const cl of p.clues) { const g = regionOf[cl.r * cols + cl.c]; if (seen.has(g)) throw new Error(`two clues in region ${g}`); seen.add(g); }
  }
  return Object.assign(p, { N, hex, K, clueAt, labelAt, nb, ed, edgeA, edgeB, rays, cluesOf, numEdges, boxIdx, voidIdx, regional, regionOf, regionCells });
}

export function initialState(P) {
  const cell = new Int8Array(P.N);
  for (let i = 0; i < P.N; i++) if (P.clueAt[i] >= 0) cell[i] = CLUE;
  for (const i of P.boxIdx) cell[i] = SHADED;
  return { cell, e: new Int8Array(P.numEdges), cycle: false };
}

export function cloneState(st) {
  return { cell: st.cell.slice(), e: st.e.slice(), cycle: st.cycle };
}

/** Endpoints of an edge index. */
export function edgeCells(P, e) {
  return [P.edgeA[e], P.edgeB[e]];
}

/**
 * Apply the basic deductions until nothing changes. Returns false on a contradiction.
 * This is the "machine" solver's propagation (it does not model a human); the human-style rules live in rating.js.
 */
let scratchParent = new Int16Array(0), scratchSize = new Int32Array(0);       // reused by every propagate call (it never calls itself)
export function propagate(P, st) {
  const { N, nb, ed, rays, clueAt, K, edgeA, edgeB } = P;
  const cell = st.cell, e = st.e;
  let changed = true;
  let ok = true;
  const setCell = (i, v) => {
    if (cell[i] === v) return;
    if (cell[i] !== UNKNOWN) { ok = false; return; }
    cell[i] = v; changed = true;
  };
  const setEdge = (x, v) => {
    if (e[x] === v) return;
    if (e[x] !== E_UNKNOWN) { ok = false; return; }
    e[x] = v; changed = true;
  };
  if (scratchParent.length < N) { scratchParent = new Int16Array(N); scratchSize = new Int32Array(N); }
  const parent = scratchParent, size = scratchSize;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };

  while (changed && ok) {
    changed = false;
    for (let i = 0; i < N && ok; i++) {
      const s = cell[i];
      if (s === CLUE) continue;
      let on = 0, unk = 0;
      for (let d = 0; d < K; d++) {
        const x = ed[i * K + d];
        if (x < 0) continue;
        if (s === SHADED) { setEdge(x, E_OFF); setCell(nb[i * K + d], LOOP); continue; }
        const v = e[x];
        if (v === E_ON) on++; else if (v === E_UNKNOWN) unk++;
      }
      if (!ok) break;
      if (s === SHADED) continue;
      if (s === UNKNOWN) {
        if (on >= 1) { setCell(i, LOOP); }
        else if (unk < 2) { setCell(i, SHADED); }
        continue;
      }
      // s === LOOP
      if (on > 2 || on + unk < 2) { ok = false; break; }
      if (on === 2 && unk > 0) {
        for (let d = 0; d < K; d++) { const x = ed[i * K + d]; if (x >= 0 && e[x] === E_UNKNOWN) setEdge(x, E_OFF); }
      } else if (on + unk === 2 && unk > 0) {
        for (let d = 0; d < K; d++) { const x = ed[i * K + d]; if (x >= 0 && e[x] === E_UNKNOWN) setEdge(x, E_ON); }
      }
    }
    if (!ok) break;
    // An edge that is on makes both its cells loop cells. An edge touching a shaded cell is off (done above).
    for (let x = 0; x < P.numEdges && ok; x++) {
      if (e[x] !== E_ON) continue;
      setCell(edgeA[x], LOOP); setCell(edgeB[x], LOOP);
    }
    // Clues.
    for (let k = 0; k < rays.length && ok; k++) {
      const n = P.clues[k].n;
      if (n < 0) continue; // a blocked cell: no count to satisfy
      let s = 0, u = 0;
      for (const i of rays[k]) { if (cell[i] === SHADED) s++; else if (cell[i] === UNKNOWN) u++; }
      if (s > n || s + u < n) { ok = false; break; }
      if (u > 0 && (s === n || s + u === n)) {
        const v = s === n ? LOOP : SHADED;
        for (const i of rays[k]) if (cell[i] === UNKNOWN) setCell(i, v);
      }
    }
    if (!ok) break;
    // One loop only: no cycle may close while other loop cells exist.
    for (let i = 0; i < N; i++) parent[i] = i;
    let cycleRoot = -1;
    for (let x = 0; x < P.numEdges; x++) {
      if (e[x] !== E_ON) continue;
      const ra = find(edgeA[x]), rb = find(edgeB[x]);
      if (ra === rb) cycleRoot = ra; else parent[ra] = rb;
    }
    let loopCount = 0;
    for (let i = 0; i < N; i++) if (cell[i] === LOOP) loopCount++;
    if (cycleRoot >= 0) {
      cycleRoot = find(cycleRoot);
      for (let i = 0; i < N; i++) {
        if (cell[i] === CLUE || find(i) === cycleRoot) continue;
        if (cell[i] === LOOP) { ok = false; break; }
        if (cell[i] === UNKNOWN) setCell(i, SHADED);
      }
      st.cycle = true;
    } else {
      st.cycle = false;
      size.fill(-1, 0, N);                                    // -1: no loop cell in this component (the old Map had no entry: "undefined < n" is false)
      for (let i = 0; i < N; i++) if (cell[i] === LOOP) { const r = find(i); size[r] = (size[r] < 0 ? 0 : size[r]) + 1; }
      for (let x = 0; x < P.numEdges; x++) {
        if (e[x] !== E_UNKNOWN) continue;
        const a = edgeA[x], b = edgeB[x];
        if (a < 0 || cell[a] === CLUE || cell[b] === CLUE) continue;
        const ra = find(a);
        if (ra === find(b) && size[ra] >= 0 && size[ra] < loopCount) setEdge(x, E_OFF);
      }
    }
  }
  return ok;
}

/** Count solutions (up to `limit`) by propagation + search. Returns { count, solutions: [state] }. */
export function solve(P, { limit = 2, state = null, maxNodes = Infinity, rng = null, pShade = 0.3 } = {}) {
  const solutions = [];
  let nodes = 0, exceeded = false;
  const dfs = (st) => {
    if (solutions.length >= limit) return;
    if (nodes++ > maxNodes) { exceeded = true; return; }
    if (!propagate(P, st)) return;
    // Branch on an edge of a loop cell that still needs one (shortest paths first), else on a cell.
    // With `rng`, the choices and the order the values are tried in are random: the first solution found is a random one.
    let bi = -1, bu = 9, bon = -1;
    const ties = [];
    for (let i = 0; i < P.N; i++) {
      if (st.cell[i] !== LOOP) continue;
      let on = 0, unk = 0;
      for (let d = 0; d < P.K; d++) { const x = P.ed[i * P.K + d]; if (x < 0) continue; if (st.e[x] === E_ON) on++; else if (st.e[x] === E_UNKNOWN) unk++; }
      if (unk === 0) continue;
      if (rng) {
        if (on > bon) { bon = on; ties.length = 0; }
        if (on === bon) ties.push(i);
      } else if (on > bon || (on === bon && unk < bu)) { bi = i; bu = unk; bon = on; }
    }
    if (rng && ties.length) bi = ties[(rng() * ties.length) | 0];
    if (bi >= 0) {
      const open = [];
      for (let d = 0; d < P.K; d++) { const y = P.ed[bi * P.K + d]; if (y >= 0 && st.e[y] === E_UNKNOWN) open.push(y); }
      const x = rng ? open[(rng() * open.length) | 0] : open[0];
      const onFirst = rng ? rng() < 0.5 : true;
      for (const v of onFirst ? [E_ON, E_OFF] : [E_OFF, E_ON]) { const a = cloneState(st); a.e[x] = v; dfs(a); }
      return;
    }
    let ci = -1;
    if (rng) {
      const unknown = [];
      for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) unknown.push(i);
      if (unknown.length) ci = unknown[(rng() * unknown.length) | 0];
    } else {
      for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) { ci = i; break; }
    }
    if (ci >= 0) {
      const shadedFirst = rng ? rng() < pShade : true;
      for (const v of shadedFirst ? [SHADED, LOOP] : [LOOP, SHADED]) { const a = cloneState(st); a.cell[ci] = v; dfs(a); }
      return;
    }
    if (st.cycle) solutions.push(st);
  };
  dfs(state ? cloneState(state) : initialState(P));
  // `exceeded`: the search was cut off by maxNodes, so `count` is only a lower bound (never claim uniqueness from it)
  return { count: solutions.length, solutions, exceeded, nodes };
}

/** Solution string: '#' clue, 'x' shaded, otherwise a hex digit of the loop cell's exits (U=1 R=2 D=4 L=8; a hex grid: one of 64 symbols, bit d = direction d). */
export function encodeSolution(P, st) {
  let s = '';
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] === CLUE) s += '#';
    else if (st.cell[i] === SHADED) s += 'x';
    else {
      let m = 0;
      for (let d = 0; d < P.K; d++) { const x = P.ed[i * P.K + d]; if (x >= 0 && st.e[x] === E_ON) m |= 1 << d; }
      s += P.hex ? SOL_ALPHABET[m] : m.toString(16);
    }
  }
  return s;
}

export function decodeSolution(P, str) {
  const st = initialState(P);
  st.e.fill(E_OFF);
  for (let i = 0; i < P.N; i++) {
    const ch = str[i];
    if (ch === '#') continue;
    if (ch === 'x') { st.cell[i] = SHADED; continue; }
    st.cell[i] = LOOP;
    const m = P.hex ? SOL_ALPHABET.indexOf(ch) : parseInt(ch, 16);
    for (let d = 0; d < P.K; d++) if (m & (1 << d)) st.e[P.ed[i * P.K + d]] = E_ON;
  }
  st.cycle = true;
  return st;
}

/**
 * Is a position a complete valid solution? `shaded` is a Uint8Array (1 = shaded), `edges` an Int8Array of
 * numEdges (1 = loop segment). Independent of the stored solution: any valid answer counts.
 */
export function checkSolved(P, shaded, edges) {
  const { N, K } = P;
  for (const i of P.boxIdx) if (!shaded[i]) return false;
  for (let i = 0; i < N; i++) {
    if (shaded[i] && P.clueAt[i] >= 0) return false;
    if (!shaded[i]) continue;
    for (let d = 0; d < K; d++) { const j = P.nb[i * K + d]; if (j >= 0 && shaded[j]) return false; }
  }
  for (let k = 0; k < P.clues.length; k++) {
    if (P.clues[k].n < 0) continue;
    let s = 0;
    for (const i of P.rays[k]) if (shaded[i]) s++;
    if (s !== P.clues[k].n) return false;
  }
  const deg = new Int8Array(N);
  let loopCells = 0, start = -1;
  for (let x = 0; x < P.numEdges; x++) {
    if (edges[x] !== E_ON) continue;
    const a = P.edgeA[x], b = P.edgeB[x];
    if (a < 0) return false; // edge off the board
    if (P.clueAt[a] >= 0 || P.clueAt[b] >= 0 || shaded[a] || shaded[b]) return false;
    deg[a]++; deg[b]++;
  }
  for (let i = 0; i < N; i++) {
    if (P.clueAt[i] >= 0 || shaded[i]) { if (deg[i]) return false; continue; }
    if (deg[i] !== 2) return false;
    loopCells++; if (start < 0) start = i;
  }
  if (loopCells === 0) return false;
  // Walk the cycle from `start`: it must return after visiting every loop cell.
  let prev = -1, cur = start, steps = 0;
  do {
    let next = -1;
    for (let d = 0; d < K; d++) {
      const x = P.ed[cur * K + d];
      if (x >= 0 && edges[x] === E_ON) { const j = P.nb[cur * K + d]; if (j !== prev) { next = j; break; } }
    }
    if (next < 0) return false;
    prev = cur; cur = next; steps++;
  } while (cur !== start && steps <= N);
  return steps === loopCells;
}

// ---------------------------------------------------------------- CSV

export const CSV_HEADER = 'name,rows,cols,clues,solution,rules,tier,score,boxes';
export const CSV_HEADER_REGIONAL = CSV_HEADER + ',regions';
export const CSV_HEADER_HEX = CSV_HEADER_REGIONAL + ',grid';     // a hex puzzle's eleventh column says 'hex' (its arrows use HEX_DIR_LETTERS)

/** A void cell is written r:c:V:-1 (a clue with n < 0 and no direction; the old r:c:U:-1 form reads the same).
 *  A region clue is written r:c:G:n (the number n sits in cell r,c and counts that cell's region). */
export function cluesToString(clues, hex = false) {
  const letters = hex ? HEX_DIR_LETTERS : DIR_LETTERS;
  return clues.map((c) => (c.region ? `${c.r}:${c.c}:G:${c.n}` : c.n < 0 ? `${c.r}:${c.c}:V:-1` : `${c.r}:${c.c}:${letters[c.d]}:${c.n}`)).join(';');
}

export function cluesFromString(s, hex = false) {
  if (!s) return [];
  const letters = hex ? HEX_DIR_LETTERS : DIR_LETTERS;
  return s.split(';').map((t) => {
    const [r, c, d, n] = t.split(':');
    if (d === 'G') return { r: +r, c: +c, d: 0, n: +n, region: true };
    return +n < 0 ? { r: +r, c: +c, d: 0, n: -1 } : { r: +r, c: +c, d: letters.indexOf(d), n: +n };
  });
}

export const boxesToString = (boxes) => (boxes || []).map((b) => `${b.r}:${b.c}`).join(';');
export const boxesFromString = (s) => (s ? s.split(';').map((t) => { const [r, c] = t.split(':'); return { r: +r, c: +c }; }) : []);

/** A regional puzzle's regions: one region id per cell, joined by '.' (a ninth column only regional puzzles have). */
/**
 * Regional puzzles: merge neighbouring regions that both carry no number. A boundary between two such regions says nothing (a region matters
 * only through its number), so it is only clutter. The numbered regions are untouched. `isNumbered(id)` says whether a region carries a number.
 * Returns { regions, merged, idOf }: the new region of every cell (ids 0.. in order of the old ones, no gaps), how many regions disappeared, and
 * a function giving the new id of an old one. The input is not changed; `regions` is the input itself (and idOf the identity) when nothing merged.
 */
export function mergeBlankRegions(rows, cols, regions, isNumbered) {
  const parent = new Map();
  const find = (g) => { while (parent.get(g) !== g) { parent.set(g, parent.get(parent.get(g))); g = parent.get(g); } return g; };
  for (const g of regions) if (!parent.has(g)) parent.set(g, g);
  let merged = 0;
  const join = (a, b) => {
    if (a === b || isNumbered(a) || isNumbered(b)) return;
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    parent.set(Math.max(ra, rb), Math.min(ra, rb));
    merged++;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (c + 1 < cols) join(regions[i], regions[i + 1]);
    if (r + 1 < rows) join(regions[i], regions[i + cols]);
  }
  if (!merged) return { regions, merged: 0, idOf: (g) => g };
  const ids = [...new Set(Array.from(regions, (g) => find(g)))].sort((a, b) => a - b), at = new Map(ids.map((g, k) => [g, k]));
  return { regions: Array.from(regions, (g) => at.get(find(g))), merged, idOf: (g) => at.get(find(g)) };
}

export const regionsToString = (regions) => (regions && regions.length ? Array.from(regions).join('.') : '');
export const regionsFromString = (s) => (s ? s.split('.').map(Number) : []);

export function toCsvRow(p) {
  const hex = p.grid === 'hex';
  const row = [p.name, p.rows, p.cols, cluesToString(p.clues, hex), p.solution || '', p.rules || '', p.tier || '', p.score ?? '', boxesToString(p.boxes)];
  if (p.regions && p.regions.length) row.push(regionsToString(p.regions));
  if (hex) { if (row.length < 10) row.push(''); row.push('hex'); }
  return row.join(',');
}

export function toCsv(puzzles) {
  const hex = puzzles.some((p) => p.grid === 'hex');
  const regional = puzzles.some((p) => p.regions && p.regions.length);
  const width = hex ? 11 : regional ? 10 : 9;                          // every row has as many columns as the header
  const rowOf = (p) => { const r = toCsvRow(p); return r + ','.repeat(Math.max(0, width - 1 - (r.match(/,/g) || []).length)); };
  return [hex ? CSV_HEADER_HEX : regional ? CSV_HEADER_REGIONAL : CSV_HEADER, ...puzzles.map(rowOf)].join('\n') + '\n';
}

export function parseCsv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('name,')) continue;
    const [name, rows, cols, clues, solution, rules, tier, score, boxes, regions, grid] = t.split(',');
    const hex = grid === 'hex';
    const p = {
      name, rows: +rows, cols: +cols, clues: cluesFromString(clues, hex), boxes: boxesFromString(boxes),
      solution: solution || '', rules: rules || '', tier: tier || '', score: score === undefined || score === '' ? null : +score,
    };
    if (regions) p.regions = regionsFromString(regions);
    if (hex) p.grid = 'hex';
    out.push(p);
  }
  return out;
}

const dirOf = (dr, dc) => DR.findIndex((v, d) => v === dr && DC[d] === dc);

/**
 * A key that is the same for a puzzle and for every turned or mirrored copy of it (the 8 symmetries of the grid: a transpose, a quarter
 * turn, a reflection...), and different for puzzles that are not copies of each other. Books are deduplicated by it, so a pool never
 * holds the same puzzle twice in two orientations. (puzzleHash stays orientation-specific: it is the save key, and a transposed twin is
 * a different board to play. A rotated twin made by js/rotate.js keeps the original's hash for that reason.)
 * Made from the clues alone (a unique puzzle has no other solution); regions are relabelled in reading order so that which cell carries
 * a region's number does not matter.
 */
export function symmetryKey(p) {
  const { rows, cols } = p;
  if (p.grid === 'hex') {
    let best = null;
    for (const t of hexSymmetries(rows, cols)) {
      const clues = p.clues.map((c) => { const [r, cc] = t.cell(c.r, c.c); return `${r}:${cc}:${c.n < 0 ? 'V' : HEX_DIR_LETTERS[t.dir(c.d)]}:${c.n}`; }).sort().join(';');
      const boxes = (p.boxes || []).map((b) => t.cell(b.r, b.c).join(':')).sort().join(';');
      const key = `hex${rows}x${cols}|${clues}|${boxes}`;
      if (best === null || key < best) best = key;
    }
    return best;
  }
  let best = null;
  for (let t = 0; t < 8; t++) {
    const swap = t & 1, flipR = t & 2, flipC = t & 4;
    const R = swap ? cols : rows, C = swap ? rows : cols;
    const move = (r, c) => { if (swap) [r, c] = [c, r]; return [flipR ? R - 1 - r : r, flipC ? C - 1 - c : c]; };
    const turn = (d) => { let dr = DR[d], dc = DC[d]; if (swap) [dr, dc] = [dc, dr]; return dirOf(flipR ? -dr : dr, flipC ? -dc : dc); };
    const arrows = p.clues.filter((c) => !c.region).map((c) => {
      const [r, cc] = move(c.r, c.c);
      return [r * C + cc, `${r}:${cc}:${c.n < 0 ? 'V' : DIR_LETTERS[turn(c.d)]}:${c.n}`];
    }).sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(';');
    const boxes = (p.boxes || []).map((b) => { const [r, c] = move(b.r, b.c); return [r * C + c, `${r}:${c}`]; }).sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(';');
    let regions = '';
    if (p.regions && p.regions.length) {
      const owner = new Array(rows * cols), number = new Map();
      for (const c of p.clues) if (c.region) number.set(p.regions[c.r * cols + c.c], c.n);
      for (let i = 0; i < rows * cols; i++) { const [r, c] = move((i / cols) | 0, i % cols); owner[r * C + c] = p.regions[i]; }
      const label = new Map(), nums = [];
      const labels = owner.map((g) => { if (!label.has(g)) { label.set(g, label.size); nums.push(number.has(g) ? number.get(g) : ''); } return label.get(g); });
      regions = `|g${labels.join('.')}|${nums.join(',')}`;
    }
    const key = `${R}x${C}|${arrows}|${boxes}${regions}`;
    if (best === null || key < best) best = key;
  }
  return best;
}

/** A short stable hash of a puzzle's identity (size + clues), for save keys that survive renumbering. */
export function puzzleHash(p) {
  if (p.hashKey) return p.hashKey;   // a rotated twin of a puzzle (js/rotate.js) keeps the original's identity
  const s = `${p.grid === 'hex' ? 'hex' : ''}${p.rows}x${p.cols}|${cluesToString(p.clues, p.grid === 'hex')}` + (p.boxes && p.boxes.length ? `|${boxesToString(p.boxes)}` : '')
    + (p.regions && p.regions.length ? `|g${regionsToString(p.regions)}` : '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
