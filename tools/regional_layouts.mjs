// Region layouts drawn BEFORE the solution (layout-first regional puzzles, an experiment). Each maker returns owner: Int16Array, the
// region id of every cell, ids 0..k-1. tools/cpsat_regional.py then looks for boxes and a loop that make the layout a unique puzzle.
//
//   node tools/regional_layouts.mjs --kind rooms|symmetric|dominoes|tetrominoes|pentominoes|jigsaw --size 8x8 --seed 1 [--min 2 --max 9 --avg 6] --out layout.json
//
//   rooms      rectangles only (the Heyawake look): the board is split in two again and again, across its longer side mostly, until each
//              piece is at most --max cells (and pieces of at least --min stop at random, so sizes vary)
//   symmetric  regions in pairs: turning the board half a way round maps every region onto its twin (and maybe one region in the middle
//              onto itself); grown from paired seeds toward --avg cells, at most --max
//   dominoes   a random tiling by dominoes (each region two cells, so every number is 0 or 1)
//   tetrominoes  a random tiling by tetrominoes (every region four cells; --k for another size)
//   pentominoes  one of each of the twelve pentominoes (a board of 60 cells: --size 12x5, 10x6, 15x4 or 20x3)
//   jigsaw     irregular pieces of mixed sizes (--min 3 --max 6 cells), never a rectangle or a straight bar
import fs from 'node:fs';

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
const nbrs = (rows, cols, i) => {
  const r = (i / cols) | 0, c = i % cols, out = [];
  if (r > 0) out.push(i - cols); if (r < rows - 1) out.push(i + cols); if (c > 0) out.push(i - 1); if (c < cols - 1) out.push(i + 1);
  return out;
};

/** Rectangles by repeated splitting. */
export function roomsLayout(rows, cols, rng, { min = 2, max = 9 } = {}) {
  const owner = new Int16Array(rows * cols); let next = 0;
  const split = (r0, c0, h, w) => {
    const area = h * w;
    const stop = area <= max && (area < 2 * min || rng() < 0.35 + 0.5 * (1 - area / max));
    if (stop || (h === 1 && w === 1)) { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) owner[r * cols + c] = next; next++; return; }
    // cut across the longer side (mostly), leaving both parts at least `min` cells where possible
    let across = h > w ? true : w > h ? false : rng() < 0.5;
    if (rng() < 0.2 && h > 1 && w > 1) across = !across;
    if (across && h < 2) across = false; if (!across && w < 2) across = true;
    const len = across ? h : w, other = across ? w : h;
    const cuts = []; for (let k = 1; k < len; k++) if ((k * other >= min && (len - k) * other >= min) || area <= 2 * min) cuts.push(k);
    const k = cuts.length ? cuts[(rng() * cuts.length) | 0] : 1 + ((rng() * (len - 1)) | 0);
    if (across) { split(r0, c0, k, w); split(r0 + k, c0, h - k, w); } else { split(r0, c0, h, k); split(r0, c0 + k, h, w - k); }
  };
  split(0, 0, rows, cols);
  return owner;
}

/** Regions in half-turn pairs. */
export function symmetricLayout(rows, cols, rng, { avg = 6, max = 10, middle = 0.5 } = {}) {
  const N = rows * cols, owner = new Int16Array(N).fill(-1), img = (i) => N - 1 - i;
  const size = [], twin = []; let next = 0;
  const free = (i) => owner[i] < 0;
  const newRegion = (cells, self) => { const g = next++; size.push(0); twin.push(self ? g : g + 1); for (const i of cells) { owner[i] = g; size[g]++; } return g; };
  // an optional middle region that is its own twin: the centre 2x2 (even sides) or the centre cell and its arms (odd sides)
  if (rng() < middle) {
    const r = (rows - 1) / 2, c = (cols - 1) / 2;
    const cells = [];
    for (const rr of [Math.floor(r), Math.ceil(r)]) for (const cc of [Math.floor(c), Math.ceil(c)]) cells.push(rr * cols + cc);
    newRegion([...new Set(cells)], true);
  }
  const target = Math.max(2, Math.round(avg));
  const seedPair = () => {
    const cand = []; for (let i = 0; i < N; i++) if (free(i) && img(i) !== i && free(img(i))) cand.push(i);
    if (!cand.length) return false;
    const x = cand[(rng() * cand.length) | 0];
    const a = newRegion([x], false); const b = newRegion([img(x)], false); twin[a] = b; twin[b] = a;
    return true;
  };
  const pairs = Math.max(1, Math.round(N / (2 * target)));
  for (let k = 0; k < pairs; k++) seedPair();
  let guard = 0;
  while (owner.some((g) => g < 0) && guard++ < 100000) {
    // grow a random region that is under its size (its twin grows by the mirror cell)
    const grow = [];
    for (let g = 0; g < next; g++) if (g <= twin[g] && size[g] < (rng() < 0.15 ? max : target + 2)) grow.push(g);
    let moved = false;
    for (const g of shuffle(grow, rng)) {
      const fr = [];
      for (let i = 0; i < N; i++) if (owner[i] === g) for (const j of nbrs(rows, cols, i)) if (free(j) && free(img(j)) && img(j) !== j && (twin[g] !== g || true)) fr.push(j);
      if (!fr.length) continue;
      const j = fr[(rng() * fr.length) | 0];
      if (twin[g] === g) { owner[j] = g; owner[img(j)] = g; size[g] += 2; }
      else { owner[j] = g; size[g]++; owner[img(j)] = twin[g]; size[twin[g]]++; }
      moved = true; break;
    }
    if (!moved && !seedPair()) break;
  }
  // a cell left over (odd sides: the centre maps to itself) joins a neighbouring region; its mirror is itself
  for (let i = 0; i < N; i++) if (owner[i] < 0) { const j = nbrs(rows, cols, i).find((x) => owner[x] >= 0); owner[i] = owner[j]; }
  return renumber(owner);
}

/** A random domino tiling (Markov chain of 2x2 flips from all-horizontal / all-vertical). */
export function dominoLayout(rows, cols, rng, { flips = 60 } = {}) {
  const N = rows * cols, mate = new Int32Array(N);
  if (cols % 2 === 0) for (let i = 0; i < N; i++) mate[i] = i % 2 === 0 ? i + 1 : i - 1;
  else if (rows % 2 === 0) for (let i = 0; i < N; i++) { const r = (i / cols) | 0; mate[i] = r % 2 === 0 ? i + cols : i - cols; }
  else throw new Error('dominoes need an even side');
  for (let k = 0; k < flips * N; k++) {
    const r = (rng() * (rows - 1)) | 0, c = (rng() * (cols - 1)) | 0, a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
    if (mate[a] === b && mate[d] === e) { mate[a] = d; mate[d] = a; mate[b] = e; mate[e] = b; }
    else if (mate[a] === d && mate[b] === e) { mate[a] = b; mate[b] = a; mate[d] = e; mate[e] = d; }
  }
  const owner = new Int16Array(N).fill(-1); let g = 0;
  for (let i = 0; i < N; i++) if (owner[i] < 0) { owner[i] = g; owner[mate[i]] = g; g++; }
  return owner;
}

/** A canonical key for a set of cells, the same for every rotation and reflection (so it names a free polyomino). */
export function shapeKey(cells, cols) {
  const pts = cells.map((i) => [(i / cols) | 0, i % cols]);
  let best = null;
  for (let t = 0; t < 8; t++) {
    const q = pts.map(([r, c]) => { let [a, b] = t & 1 ? [c, r] : [r, c]; if (t & 2) a = -a; if (t & 4) b = -b; return [a, b]; });
    const ma = Math.min(...q.map((x) => x[0])), mb = Math.min(...q.map((x) => x[1]));
    const key = q.map(([a, b]) => `${a - ma}.${b - mb}`).sort().join(' ');
    if (best === null || key < best) best = key;
  }
  return best;
}

/**
 * A random tiling by connected pieces of k cells (tetrominoes for k = 4). With `distinct`, no shape (up to rotation and reflection) is
 * used twice: on a board of 60 cells with k = 5 that is one of each of the twelve pentominoes. Backtracking from the first empty cell in
 * reading order, pieces in a random order, and every empty pocket must stay a multiple of k cells; restarts after `maxNodes` placements.
 */
export function polyominoLayout(rows, cols, rng, { k = 4, sizes = null, noRect = false, distinct = false, maxNodes = 200000, restarts = 50 } = {}) {
  const N = rows * cols;
  if (!sizes && N % k) throw new Error(`${rows}x${cols} does not split into pieces of ${k}`);
  const ks = sizes ? Array.from({ length: sizes[1] - sizes[0] + 1 }, (_, t) => sizes[0] + t) : [k];
  const isRect = (cells) => { const rs = cells.map((i) => (i / cols) | 0), cs = cells.map((i) => i % cols); return (Math.max(...rs) - Math.min(...rs) + 1) * (Math.max(...cs) - Math.min(...cs) + 1) === cells.length; };
  for (let attempt = 0; attempt < restarts; attempt++) {
    const owner = new Int16Array(N).fill(-1), used = new Set();
    let nodes = 0, next = 0;
    const pieces = (c, k) => {                  // every connected k-cell set of empty cells that contains c
      let level = new Map([[String(c), [c]]]);
      for (let size = 1; size < k; size++) {
        const grown = new Map();
        for (const cells of level.values()) for (const i of cells) for (const j of nbrs(rows, cols, i)) {
          if (owner[j] >= 0 || cells.includes(j)) continue;
          const nc = [...cells, j].sort((a, b) => a - b), key = nc.join(',');
          if (!grown.has(key)) grown.set(key, nc);
        }
        level = grown;
      }
      return [...level.values()];
    };
    const pocketsOk = () => {                    // every connected group of empty cells can still be tiled: a multiple of k, or (sizes) at least the smallest
      const seen = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (owner[i] >= 0 || seen[i]) continue;
        let size = 0; const stack = [i]; seen[i] = 1;
        while (stack.length) { const x = stack.pop(); size++; for (const j of nbrs(rows, cols, x)) if (owner[j] < 0 && !seen[j]) { seen[j] = 1; stack.push(j); } }
        if (sizes ? size < sizes[0] : size % k) return false;
      }
      return true;
    };
    const rec = () => {
      let c = 0; while (c < N && owner[c] >= 0) c++;
      if (c === N) return true;
      if (++nodes > maxNodes) return false;
      for (const cells of shuffle(ks.slice(), rng).flatMap((k) => shuffle(pieces(c, k), rng))) {
        if (noRect && cells.length > 1 && isRect(cells)) continue;
        const key = distinct ? shapeKey(cells, cols) : null;
        if (distinct && used.has(key)) continue;
        for (const i of cells) owner[i] = next;
        next++; if (distinct) used.add(key);
        if (pocketsOk() && rec()) return true;
        next--; if (distinct) used.delete(key);
        for (const i of cells) owner[i] = -1;
        if (nodes > maxNodes) return false;
      }
      return false;
    };
    if (rec()) return renumber(owner);
  }
  throw new Error('no tiling found');
}

/** Region ids in reading order of their first cell. */
export function renumber(owner) {
  const map = new Map(), out = new Int16Array(owner.length);
  owner.forEach((g, i) => { if (!map.has(g)) map.set(g, map.size); out[i] = map.get(g); });
  return out;
}

export const LAYOUTS = {
  rooms: roomsLayout, symmetric: symmetricLayout, dominoes: dominoLayout,
  tetrominoes: (rows, cols, rng, o) => polyominoLayout(rows, cols, rng, { k: 4, ...o }),
  pentominoes: (rows, cols, rng, o) => polyominoLayout(rows, cols, rng, { k: 5, distinct: true, ...o }),   // 60 cells: one of each
  jigsaw: (rows, cols, rng, o) => polyominoLayout(rows, cols, rng, { sizes: [o.min || 3, o.max || 6], noRect: true }),   // mixed sizes, no rectangles
};

/** A picture of a layout for a terminal: one letter per region. */
export function drawLayout(rows, cols, owner) {
  const ch = (g) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[g % 62];
  let s = '';
  for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) s += ch(owner[r * cols + c]); s += '\n'; }
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const kind = arg('kind', 'rooms'), [cols, rows] = arg('size', '8x8').split('x').map(Number), rng = mulberry(+arg('seed', 1));
  const opts = {}; for (const k of ['min', 'max', 'avg', 'flips', 'k']) if (arg(k) !== undefined) opts[k] = +arg(k);
  const owner = LAYOUTS[kind](rows, cols, rng, opts);
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify({ kind, rows, cols, owner: Array.from(owner) }));
  process.stdout.write(drawLayout(rows, cols, owner));
}
