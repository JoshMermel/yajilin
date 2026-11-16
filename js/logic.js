// Yajilin: pure logic (no DOM). Used by the browser GUI and by the node tools.
//
// Rules: some cells are clue cells (an arrow and a number). Every other cell is either shaded or on the loop.
//   * shaded cells never touch each other orthogonally,
//   * a clue's number is how many shaded cells lie in its arrow's direction (to the board's edge),
//   * the loop is one closed cycle, through every cell that is neither a clue nor shaded.
//   * a VOID cell (a clue with n < 0, no arrow) is outside the puzzle: not shaded, not on the loop, not counted by any arrow (arrows skip
//     over it like a clue cell), and a box may touch it.
//
// Coordinates: cell (r, c) has index r*cols + c. Directions are 0=U 1=R 2=D 3=L (DR/DC below).
// Edges (loop segments between orthogonal neighbours): edge index 2*i is cell i's right edge (i - i+1),
// 2*i+1 is its bottom edge (i - i+cols). Edge states: 0 unknown, 1 on (loop passes), 2 off.
// Cell states: 0 unknown, 1 shaded, 2 loop, 3 clue.

/** Column letters like a spreadsheet: 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export const DR = [-1, 0, 1, 0];
export const DC = [0, 1, 0, -1];
export const DIR_LETTERS = 'URDL';

export const UNKNOWN = 0, SHADED = 1, LOOP = 2, CLUE = 3;
export const E_UNKNOWN = 0, E_ON = 1, E_OFF = 2;

/** Puzzle = { name, rows, cols, clues: [{r, c, d, n}], solution?: string, rules?, tier?, score? }.
 *  compile() adds the lookup tables every other function uses. */
export function compile(p) {
  const { rows, cols } = p;
  const N = rows * cols;
  const clueAt = new Int16Array(N).fill(-1);
  p.clues.forEach((cl, k) => {
    if (clueAt[cl.r * cols + cl.c] >= 0) throw new Error(`two clues on cell ${cl.r},${cl.c}`);
    clueAt[cl.r * cols + cl.c] = k;
  });
  // nb[i*4+d]: neighbour cell in direction d if both are non-clue cells, else -1. ed: the edge between them.
  const nb = new Int16Array(N * 4).fill(-1);
  const ed = new Int16Array(N * 4).fill(-1);
  for (let i = 0; i < N; i++) {
    if (clueAt[i] >= 0) continue;
    const r = (i / cols) | 0, c = i % cols;
    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d], nc = c + DC[d];
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const j = nr * cols + nc;
      if (clueAt[j] >= 0) continue;
      nb[i * 4 + d] = j;
      ed[i * 4 + d] = d === 1 ? 2 * i : d === 2 ? 2 * i + 1 : d === 3 ? 2 * j : 2 * j + 1;
    }
  }
  // rays[k]: the non-clue cells a clue counts shaded cells in.
  // pre-placed boxes: shaded cells given from the start (not clues, not on the loop)
  const boxIdx = (p.boxes || []).map((b) => b.r * cols + b.c);
  for (const i of boxIdx) if (clueAt[i] >= 0) throw new Error(`a box and a clue share cell ${i}`);
  const rays = p.clues.map((cl) => {
    const cells = [];
    if (cl.n < 0) return cells;                   // a void cell has no line
    let r = cl.r + DR[cl.d], c = cl.c + DC[cl.d];
    while (r >= 0 && c >= 0 && r < rows && c < cols) {
      const i = r * cols + c;
      if (clueAt[i] < 0) cells.push(i);
      r += DR[cl.d]; c += DC[cl.d];
    }
    return cells;
  });
  // The cells that count toward each cell's clues, for incremental use.
  const cluesOf = Array.from({ length: N }, () => []);
  rays.forEach((cells, k) => cells.forEach((i) => cluesOf[i].push(k)));
  // void cells: nothing goes there (not a box, not on the loop, no arrow); a clue with n < 0 (see the top of this file)
  const voidIdx = p.clues.filter((cl) => cl.n < 0).map((cl) => cl.r * cols + cl.c);
  return Object.assign(p, { N, clueAt, nb, ed, rays, cluesOf, numEdges: 2 * N, boxIdx, voidIdx });
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
  const i = e >> 1;
  return [i, (e & 1) ? i + P.cols : i + 1];
}

/**
 * Apply the basic deductions until nothing changes. Returns false on a contradiction.
 * This is the "machine" solver's propagation (it does not model a human); the human-style rules live in rating.js.
 */
export function propagate(P, st) {
  const { N, nb, ed, rays, clueAt } = P;
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
  const parent = new Int16Array(N);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };

  while (changed && ok) {
    changed = false;
    for (let i = 0; i < N && ok; i++) {
      const s = cell[i];
      if (s === CLUE) continue;
      let on = 0, unk = 0;
      for (let d = 0; d < 4; d++) {
        const x = ed[i * 4 + d];
        if (x < 0) continue;
        if (s === SHADED) { setEdge(x, E_OFF); setCell(nb[i * 4 + d], LOOP); continue; }
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
        for (let d = 0; d < 4; d++) { const x = ed[i * 4 + d]; if (x >= 0 && e[x] === E_UNKNOWN) setEdge(x, E_OFF); }
      } else if (on + unk === 2 && unk > 0) {
        for (let d = 0; d < 4; d++) { const x = ed[i * 4 + d]; if (x >= 0 && e[x] === E_UNKNOWN) setEdge(x, E_ON); }
      }
    }
    if (!ok) break;
    // An edge that is on makes both its cells loop cells. An edge touching a shaded cell is off (done above).
    for (let x = 0; x < P.numEdges && ok; x++) {
      if (e[x] !== E_ON) continue;
      const [a, b] = edgeCells(P, x);
      setCell(a, LOOP); setCell(b, LOOP);
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
      const [a, b] = edgeCells(P, x);
      const ra = find(a), rb = find(b);
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
      const size = new Map();
      for (let i = 0; i < N; i++) if (cell[i] === LOOP) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
      for (let x = 0; x < P.numEdges; x++) {
        if (e[x] !== E_UNKNOWN) continue;
        const [a, b] = edgeCells(P, x);
        if (cell[a] === CLUE || cell[b] === CLUE) continue;
        if (find(a) === find(b) && size.get(find(a)) < loopCount) setEdge(x, E_OFF);
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
      for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x < 0) continue; if (st.e[x] === E_ON) on++; else if (st.e[x] === E_UNKNOWN) unk++; }
      if (unk === 0) continue;
      if (rng) {
        if (on > bon) { bon = on; ties.length = 0; }
        if (on === bon) ties.push(i);
      } else if (on > bon || (on === bon && unk < bu)) { bi = i; bu = unk; bon = on; }
    }
    if (rng && ties.length) bi = ties[(rng() * ties.length) | 0];
    if (bi >= 0) {
      const open = [];
      for (let d = 0; d < 4; d++) { const y = P.ed[bi * 4 + d]; if (y >= 0 && st.e[y] === E_UNKNOWN) open.push(y); }
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
  return { count: solutions.length, solutions, exceeded };
}

/** Solution string: '#' clue, 'x' shaded, otherwise a hex digit of the loop cell's exits (U=1 R=2 D=4 L=8). */
export function encodeSolution(P, st) {
  let s = '';
  for (let i = 0; i < P.N; i++) {
    if (st.cell[i] === CLUE) s += '#';
    else if (st.cell[i] === SHADED) s += 'x';
    else {
      let m = 0;
      for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && st.e[x] === E_ON) m |= 1 << d; }
      s += m.toString(16);
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
    const m = parseInt(ch, 16);
    for (let d = 0; d < 4; d++) if (m & (1 << d)) st.e[P.ed[i * 4 + d]] = E_ON;
  }
  st.cycle = true;
  return st;
}

/**
 * Is a position a complete valid solution? `shaded` is a Uint8Array (1 = shaded), `edges` an Int8Array of
 * numEdges (1 = loop segment). Independent of the stored solution: any valid answer counts.
 */
export function checkSolved(P, shaded, edges) {
  const { N, cols } = P;
  for (const i of P.boxIdx) if (!shaded[i]) return false;
  for (let i = 0; i < N; i++) {
    if (shaded[i] && P.clueAt[i] >= 0) return false;
    if (!shaded[i]) continue;
    for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && shaded[j]) return false; }
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
    const [a, b] = edgeCells(P, x);
    if (b >= N || (!(x & 1) && (b % cols === 0)) ) return false; // edge off the board
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
    for (let d = 0; d < 4; d++) {
      const x = P.ed[cur * 4 + d];
      if (x >= 0 && edges[x] === E_ON) { const j = P.nb[cur * 4 + d]; if (j !== prev) { next = j; break; } }
    }
    if (next < 0) return false;
    prev = cur; cur = next; steps++;
  } while (cur !== start && steps <= N);
  return steps === loopCells;
}

// ---------------------------------------------------------------- CSV

export const CSV_HEADER = 'name,rows,cols,clues,solution,rules,tier,score,boxes';

/** A void cell is written r:c:V:-1 (a clue with n < 0 and no direction; the old r:c:U:-1 form reads the same). */
export function cluesToString(clues) {
  return clues.map((c) => (c.n < 0 ? `${c.r}:${c.c}:V:-1` : `${c.r}:${c.c}:${DIR_LETTERS[c.d]}:${c.n}`)).join(';');
}

export function cluesFromString(s) {
  if (!s) return [];
  return s.split(';').map((t) => {
    const [r, c, d, n] = t.split(':');
    return +n < 0 ? { r: +r, c: +c, d: 0, n: -1 } : { r: +r, c: +c, d: DIR_LETTERS.indexOf(d), n: +n };
  });
}

export const boxesToString = (boxes) => (boxes || []).map((b) => `${b.r}:${b.c}`).join(';');
export const boxesFromString = (s) => (s ? s.split(';').map((t) => { const [r, c] = t.split(':'); return { r: +r, c: +c }; }) : []);

export function toCsvRow(p) {
  return [p.name, p.rows, p.cols, cluesToString(p.clues), p.solution || '', p.rules || '', p.tier || '', p.score ?? '', boxesToString(p.boxes)].join(',');
}

export function toCsv(puzzles) {
  return [CSV_HEADER, ...puzzles.map(toCsvRow)].join('\n') + '\n';
}

export function parseCsv(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('name,')) continue;
    const [name, rows, cols, clues, solution, rules, tier, score, boxes] = t.split(',');
    out.push({
      name, rows: +rows, cols: +cols, clues: cluesFromString(clues), boxes: boxesFromString(boxes),
      solution: solution || '', rules: rules || '', tier: tier || '', score: score === undefined || score === '' ? null : +score,
    });
  }
  return out;
}

/** A short stable hash of a puzzle's identity (size + clues), for save keys that survive renumbering. */
export function puzzleHash(p) {
  if (p.hashKey) return p.hashKey;   // a rotated twin of a puzzle (js/rotate.js) keeps the original's identity
  const s = `${p.rows}x${p.cols}|${cluesToString(p.clues)}` + (p.boxes && p.boxes.length ? `|${boxesToString(p.boxes)}` : '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
