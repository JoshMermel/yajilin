// How each clue looks to the player: 'ok' (its boxes are all there), 'bad' (too many boxes, or every cell it points at is filled in and
// the count is still wrong) or '' (not decided yet). A cell counts as filled in if it is a clue, has a box or a dot, or a segment passes
// through it. Pure (no DOM) so it can be tested.

/** marks = { cells: 0 blank / 1 box / 2 dot, edges: 1 = segment drawn }. Returns an array of states, one per clue. */
export function clueStates(P, marks) {
  const seg = new Uint8Array(P.N);
  for (let x = 0; x < P.numEdges; x++) {
    if (!marks.edges[x]) continue;
    const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
    seg[a] = 1; if (b < P.N) seg[b] = 1;
  }
  return P.clues.map((cl, k) => {
    if (cl.n < 0) return '';
    let boxes = 0, open = 0;
    for (const i of P.rays[k]) {
      if (marks.cells[i] === 1) boxes++;
      else if (marks.cells[i] === 0 && !seg[i] && P.clueAt[i] < 0) open++;
    }
    if (boxes > cl.n || (open === 0 && boxes < cl.n)) return 'bad';
    return boxes === cl.n ? 'ok' : '';
  });
}
