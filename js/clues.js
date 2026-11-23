// How each clue looks to the player: 'ok' (its boxes are all there), 'bad' (too many boxes, or every cell it points at is filled in and
// the count is still wrong) or '' (not decided yet). A cell counts as filled in if it is a clue, has a box or a dot, or a segment passes
// through it. Pure (no DOM) so it can be tested.
//
// An arrow also counts as 'ok' when another arrow already covers it: a K-arrow with a (K - X)-arrow further along
// its line pointing the SAME way, and X boxes standing between the two. Then the K-arrow's total is guaranteed by the other arrow, so it
// has nothing more to tell the player (its line beyond the second arrow is that arrow's line, and the cells between hold their X boxes).

/** marks = { cells: 0 blank / 1 box / 2 dot, edges: 1 = segment drawn }. Returns an array of states, one per clue. */
export function clueStates(P, marks) {
  const seg = new Uint8Array(P.N);
  for (let x = 0; x < P.numEdges; x++) {
    if (!marks.edges[x]) continue;
    seg[P.edgeA[x]] = 1; seg[P.edgeB[x]] = 1;
  }
  const states = P.clues.map((cl, k) => {
    if (cl.n < 0) return '';
    let boxes = 0, open = 0;
    for (const i of P.rays[k]) {
      if (marks.cells[i] === 1) boxes++;
      else if (marks.cells[i] === 0 && !seg[i] && P.clueAt[i] < 0) open++;
    }
    if (boxes > cl.n || (open === 0 && boxes < cl.n)) return 'bad';
    if (boxes === cl.n) return 'ok';
    return cl.region ? '' : isCovered(P, marks, cl) ? 'ok' : '';       // (a region is not a line: no other number covers it)
  });
  // two arrows that cannot both be right are both red, so the player sees "there is a problem between these two"
  P.clues.forEach((cl, k) => {
    if (cl.n < 0 || cl.region) return;
    forEachBadPair(P, marks, seg, cl, (other) => { states[k] = 'bad'; states[P.clueAt[other]] = 'bad'; });
  });
  return states;
}

/**
 * Calls `found(cell)` for every same-way arrow further along `cl`'s line (at `cell`) that cannot agree with `cl` any more. The line of
 * the further arrow (n boxes) is a part of cl's line, so cl's K boxes are the X between the two plus that arrow's n: the X between must
 * come to K - n. That fails when there are already more than K - n boxes between them, or when the boxes and the open cells between them
 * together cannot come to K - n. (The same arithmetic as `isCovered`, which is the case where X is exactly K - n.)
 */
function forEachBadPair(P, marks, seg, cl, found) {
  let boxes = 0, open = 0;                             // between cl and the arrow being looked at
  const step = stepper(P);
  for (let [r, c] = step(cl.r, cl.c, cl.d); r >= 0 && c >= 0 && r < P.rows && c < P.cols; [r, c] = step(r, c, cl.d)) {
    const i = r * P.cols + c, k = P.clueAt[i];
    if (k >= 0) {
      const other = P.clues[k];
      if (other.d === cl.d && other.n >= 0 && other.n <= cl.n && !other.region) {
        const need = cl.n - other.n;
        if (boxes > need || boxes + open < need) found(i);
      }
    } else if (marks.cells[i] === 1) boxes++;
    else if (marks.cells[i] === 0 && !seg[i]) open++;
  }
}

import { DR, DC, hexStep } from './logic.js';

/** One step along a line on this puzzle's grid: (r, c, d) -> [r, c]. */
const stepper = (P) => (P.hex ? hexStep : (r, c, d) => [r + DR[d], c + DC[d]]);

/** Is the arrow `cl` covered (see the top of the file)? Walks its line; at every arrow pointing the same way it checks the count so far. */
function isCovered(P, marks, cl) {
  let boxes = 0;                                       // boxes in the cells between cl and the arrow being looked at
  const step = stepper(P);
  for (let [r, c] = step(cl.r, cl.c, cl.d); r >= 0 && c >= 0 && r < P.rows && c < P.cols; [r, c] = step(r, c, cl.d)) {
    const i = r * P.cols + c, k = P.clueAt[i];
    if (k >= 0) {
      const other = P.clues[k];
      if (other.d === cl.d && other.n >= 0 && other.n <= cl.n && boxes === cl.n - other.n) return true;
    } else if (marks.cells[i] === 1) boxes++;
  }
  return false;
}
