// The two ends of a line, for the marker the board draws when the pointer rests on one end of it (js/board.js).

/**
 * If `cell` is the end of a line (exactly one loop segment touches it) and that line is a plain path (no cell on it has three or more
 * segments), the cell at its other end; else -1. A line that branches has more than two ends, so "the other end" would be a guess:
 * the marker keeps quiet and leaves the mistake for the player to find. A closed loop has no ends, so it never matches either.
 * `edges[x]` is truthy for a drawn segment: x = 2a joins cell a to the one on its right, x = 2a + 1 joins it to the one below.
 */
export function otherEnd(P, edges, cell) {
  const { cols, rows } = P;
  const next = (i, from) => {                       // the cells joined to i by a segment, other than `from`
    const r = (i / cols) | 0, c = i % cols, out = [];
    if (c < cols - 1 && edges[2 * i] && i + 1 !== from) out.push(i + 1);
    if (r < rows - 1 && edges[2 * i + 1] && i + cols !== from) out.push(i + cols);
    if (c > 0 && edges[2 * (i - 1)] && i - 1 !== from) out.push(i - 1);
    if (r > 0 && edges[2 * (i - cols) + 1] && i - cols !== from) out.push(i - cols);
    return out;
  };
  let from = -1, at = cell;
  for (let steps = 0; steps <= P.N; steps++) {
    const ahead = next(at, from);
    if (ahead.length > 1) return -1;                // a branch
    if (ahead.length === 0) return at === cell ? -1 : at;   // the far end (or a cell no line touches: not an end)
    from = at; at = ahead[0];
  }
  return -1;                                        // never reached: a path cannot be longer than the board
}
