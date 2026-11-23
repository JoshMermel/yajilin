// The two ends of a line, for the marker the board draws when the pointer rests on one end of it (js/board.js).

/**
 * If `cell` is the end of a line (exactly one loop segment touches it) and that line is a plain path (no cell on it has three or more
 * segments), the cell at its other end; else -1. A line that branches has more than two ends, so "the other end" would be a guess:
 * the marker keeps quiet and leaves the mistake for the player to find. A closed loop has no ends, so it never matches either.
 * `edges[x]` is truthy for a drawn segment (the edge numbering is the compiled puzzle's: see compile() in js/logic.js).
 */
export function otherEnd(P, edges, cell) {
  const next = (i, from) => {                       // the cells joined to i by a segment, other than `from`
    const out = [];
    for (let d = 0; d < P.K; d++) {
      const x = P.ed[i * P.K + d], j = P.nb[i * P.K + d];
      if (x >= 0 && edges[x] && j !== from) out.push(j);
    }
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
