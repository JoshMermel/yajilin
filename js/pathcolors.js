// Stable colors for the separate lines (paths) of the loop, for the "Color separate lines" setting.
//
// Every line has an identity (a "pid") whose color is fixed when the line is created and never changes. A segment remembers when it
// was drawn (its "birth") and the pid of the line it belongs to. After every change each connected line takes the pid of its OLDEST
// segment, so
//   - drawing a new line, or growing one, never recolors anything;
//   - joining two lines keeps the older one's identity (and color); the other one's segments take it;
//   - erasing a segment that splits a line leaves the older part (the one with the oldest segment) as it was and gives the other part
//     a brand new identity;
//   - nothing else ever changes color, however many lines share the palette.
// A new identity takes the color that is best for where it is (see `near` below). Without that, it takes the lowest palette color no line
// uses; if every color is in use it takes the least used one.
//
// With `near` (the board's geometry and which colors look alike), a new line scores every palette color c as
//     USE * (lines already using c)  +  sum over the other lines L within REACH cells of  1 / distance(L)^2 * alike(c, color of L)
// and takes the lowest score (ties: the lowest color). So: a color nobody uses beats one in use; among those, the one least like the colors
// of the lines close by; and when every color is in use, the repeat goes as far away from the lines of that color (and from lines of
// colors like it) as there is room for. Lines far apart may share a color; lines a few cells apart almost never do.

/** Fresh bookkeeping for a board with `numEdges` segment slots. */
export const makeColorKeeper = (numEdges) => ({
  birth: new Int32Array(numEdges), pid: new Int32Array(numEdges), colorOfPid: new Map(), born: 0, nextPid: 1,
});

/**
 * keeper: from makeColorKeeper; on[x]: truthy if segment x is drawn; rootOf(x): an id for the path segment x belongs to;
 * palette: number of colors. Updates the keeper and returns a Map: path id (rootOf) -> color index.
 * near (optional): { cols, alike(i, j), ends?, dist? }: the board is `cols` wide and alike(i, j) is 1 for the same color, 0 for colors that look
 * entirely different, in between for colors that look a bit alike. On a square board segment x joins cell x >> 1 and the cell after it (x odd:
 * the one below) and distance is king moves; any other board gives ends(x) -> [cell, cell] and dist(row, col, row, col) -> steps between cells.
 */
export function assignPathColors(keeper, on, rootOf, palette, near) {
  const { birth, pid, colorOfPid } = keeper;
  const n = birth.length;
  for (let x = 0; x < n; x++) {
    if (on[x]) { if (!birth[x]) birth[x] = ++keeper.born; }
    else { birth[x] = 0; pid[x] = 0; }
  }
  const oldest = new Map();                                   // path -> its oldest segment
  for (let x = 0; x < n; x++) {
    if (!on[x]) continue;
    const r = rootOf(x);
    if (!oldest.has(r) || birth[x] < birth[oldest.get(r)]) oldest.set(r, x);
  }
  // identities: oldest path first, so a split line's older part keeps the identity and the younger part gets a new one
  const identity = new Map();                                 // path -> pid
  const claimed = new Set();
  const fresh = [];
  for (const [r, x] of [...oldest.entries()].sort((p, q) => birth[p[1]] - birth[q[1]])) {
    const p = pid[x];
    if (p && colorOfPid.has(p) && !claimed.has(p)) { identity.set(r, p); claimed.add(p); } else fresh.push(r);
  }
  // forget identities no line has any more, then count the colors in use
  for (const p of [...colorOfPid.keys()]) if (!claimed.has(p)) colorOfPid.delete(p);
  const uses = new Array(palette).fill(0);
  for (const p of claimed) uses[colorOfPid.get(p)]++;
  const placed = new Map();                                   // path -> color index, for the lines that have one (the near scoring)
  if (near) for (const [r, p] of identity) placed.set(r, colorOfPid.get(p));
  const where = near && lineCells(on, rootOf, near);    // path -> [row, col, row, col, ...]
  for (const r of fresh) {
    let c = 0;
    if (near) {
      const pen = penalties(r, placed, where, palette, near);
      for (let k = 1; k < palette; k++) if (USE * uses[k] + pen[k] < USE * uses[c] + pen[c] - 1e-9) c = k;
    } else {
      for (let k = 1; k < palette; k++) if (uses[k] < uses[c]) c = k;   // the lowest color with the fewest users (0 users when one is free)
    }
    const p = keeper.nextPid++;
    colorOfPid.set(p, c); uses[c]++; identity.set(r, p); placed.set(r, c);
  }
  const colorOf = new Map();
  for (const [r, p] of identity) colorOf.set(r, colorOfPid.get(p));
  for (let x = 0; x < n; x++) if (on[x]) pid[x] = identity.get(rootOf(x));
  return colorOf;
}

const USE = 0.5;   // what one more use of a color costs, against a line at distance 1 sharing it costing 1
const REACH = 5;   // lines farther than this many cells (king moves, cell to cell) do not count as near

const kingDistance = (r1, c1, r2, c2) => Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));

/** The cells each path touches, as flat [row, col, ...] lists. */
function lineCells(on, rootOf, near) {
  const { cols } = near, out = new Map();
  for (let x = 0; x < on.length; x++) {
    if (!on[x]) continue;
    const [a, b] = near.ends ? near.ends(x) : [x >> 1, (x & 1) ? (x >> 1) + cols : (x >> 1) + 1], r = rootOf(x);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push((a / cols) | 0, a % cols, (b / cols) | 0, b % cols);
  }
  return out;
}

/** For path r: for every palette color, how crowded it is by the placed lines near r (see the top of this file). */
function penalties(r, placed, where, palette, near) {
  const pen = new Array(palette).fill(0), mine = where.get(r), dist = near.dist || kingDistance;
  for (const [o, color] of placed) {
    if (o === r) continue;
    const theirs = where.get(o);
    let d = Infinity;
    for (let i = 0; i < mine.length && d > 1; i += 2) {
      for (let j = 0; j < theirs.length; j += 2) {
        const e = dist(mine[i], mine[i + 1], theirs[j], theirs[j + 1]);
        if (e < d) { d = e; if (d <= 1) break; }
      }
    }
    if (d > REACH) continue;
    const w = 1 / (d * d);
    for (let k = 0; k < palette; k++) pen[k] += w * near.alike(k, color);
  }
  return pen;
}
