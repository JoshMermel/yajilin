// How a tap changes a cell's mark. Pure (no DOM) so it can be tested.
//
// The cycle is empty -> dot -> box -> empty. A cell that a segment passes through is already on the loop, so it has no use for a dot:
// tapping it makes it a box (which erases its segments; the caller does that, and one undo brings everything back), and from there the
// cycle goes on as usual. Whether the player had put a dot there before the line went through does not matter.
export const EMPTY = 0, BOX = 1, DOT = 2;

/** The mark a tap gives a cell that has `current` and (lined: true) a segment through it. */
export function nextMark(current, lined) {
  if (lined && current !== BOX) return BOX;
  return [DOT, EMPTY, BOX][current];   // empty -> dot, box -> empty, dot -> box
}
