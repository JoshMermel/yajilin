// Stable colors for the separate lines (paths) of the loop, for the "Color separate lines" setting.
//
// A segment remembers when it was drawn (its "birth") and the color of the path it belongs to. After every change each path takes
// the color of its OLDEST segment, so drawing a new line never recolors an existing one, and when two lines are joined the merged
// line keeps the color of whichever was started first. A new path takes the lowest palette color no other path uses. If an erased
// segment splits a path, the part without the oldest segment gets a fresh color instead of sharing one.

/** Fresh bookkeeping for a board with `numEdges` segment slots. */
export const makeColorKeeper = (numEdges) => ({ birth: new Int32Array(numEdges), hue: new Int8Array(numEdges).fill(-1), born: 0 });

/**
 * keeper: from makeColorKeeper; on[x]: truthy if segment x is drawn; rootOf(x): an id for the path segment x belongs to;
 * palette: number of colors. Updates the keeper and returns a Map: path id -> color index.
 */
export function assignPathColors(keeper, on, rootOf, palette) {
  const { birth, hue } = keeper;
  const n = birth.length;
  for (let x = 0; x < n; x++) {
    if (on[x]) { if (!birth[x]) birth[x] = ++keeper.born; }
    else { birth[x] = 0; hue[x] = -1; }
  }
  const oldest = new Map();
  for (let x = 0; x < n; x++) {
    if (!on[x]) continue;
    const r = rootOf(x);
    if (!oldest.has(r) || birth[x] < birth[oldest.get(r)]) oldest.set(r, x);
  }
  const colorOf = new Map();
  const used = new Set();
  for (const [r, x] of [...oldest.entries()].sort((p, q) => birth[p[1]] - birth[q[1]])) {
    let c = hue[x];
    if (c < 0 || used.has(c)) {
      c = 0;
      while (c < palette && used.has(c)) c++;
      if (c === palette) c = birth[x] % palette; // every color is taken: share one
    }
    colorOf.set(r, c);
    used.add(c);
  }
  for (let x = 0; x < n; x++) if (on[x]) hue[x] = colorOf.get(rootOf(x));
  return colorOf;
}
