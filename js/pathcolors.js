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
// A new identity takes the lowest palette color no line uses; if every color is in use it takes the least used one.

/** Fresh bookkeeping for a board with `numEdges` segment slots. */
export const makeColorKeeper = (numEdges) => ({
  birth: new Int32Array(numEdges), pid: new Int32Array(numEdges), colorOfPid: new Map(), born: 0, nextPid: 1,
});

/**
 * keeper: from makeColorKeeper; on[x]: truthy if segment x is drawn; rootOf(x): an id for the path segment x belongs to;
 * palette: number of colors. Updates the keeper and returns a Map: path id (rootOf) -> color index.
 */
export function assignPathColors(keeper, on, rootOf, palette) {
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
  for (const r of fresh) {
    let c = 0;
    for (let k = 1; k < palette; k++) if (uses[k] < uses[c]) c = k;   // the lowest color with the fewest users (0 users when one is free)
    const p = keeper.nextPid++;
    colorOfPid.set(p, c); uses[c]++; identity.set(r, p);
  }
  const colorOf = new Map();
  for (const [r, p] of identity) colorOf.set(r, colorOfPid.get(p));
  for (let x = 0; x < n; x++) if (on[x]) pid[x] = identity.get(rootOf(x));
  return colorOf;
}
