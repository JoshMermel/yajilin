// How a clue looks on a hex cell: the number and an arrow, laid out in cell widths (1 = the width of a cell, flat side to flat side).
//
// The arrow is DRAWN along the true direction (a hex direction is 60 degrees off the horizontal, which no text arrow glyph is: the diagonal glyphs are
// 45 degrees, and look as if they point a little wrong), through the middle of the cell, and the number sits beside it, on the upper side, at right
// angles to the arrow. So the arrow, not the number, is what the eye follows from the cell's centre to the cells it counts.
export const HEX_UNIT = [[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2], [-1, 0], [-0.5, -Math.sqrt(3) / 2], [0.5, -Math.sqrt(3) / 2]];   // E, SE, SW, W, NW, NE

/** { u: the arrow's direction, num: where the number's centre is, arrow: where the arrow's centre is, len: the arrow's length }, as offsets from the cell's centre. */
export function hexClueLayout(d) {
  const [ux, uy] = HEX_UNIT[d];
  let px = -uy, py = ux;                                  // at right angles to the arrow
  if (py > 0 || (py === 0 && px > 0)) { px = -px; py = -py; }       // the upper side (for a vertical-ish pair, the left)
  return { u: [ux, uy], num: [px * 0.28, py * 0.28], arrow: [-px * 0.12, -py * 0.12], len: 0.54 };
}

/** An arrow centred at (x, y), `len` long, pointing along unit vector (ux, uy): the shaft and two barbs, as path data (`f` rounds a number). */
export function arrowPathData(x, y, ux, uy, len, f = (v) => +v.toFixed(2)) {
  const h = len / 2, head = len * 0.36, tx = x + ux * h, ty = y + uy * h, a = Math.atan2(uy, ux);
  const barb = (sign) => `M${f(tx)} ${f(ty)}L${f(tx + Math.cos(a + sign * Math.PI * 0.75) * head)} ${f(ty + Math.sin(a + sign * Math.PI * 0.75) * head)}`;
  return `M${f(x - ux * h)} ${f(y - uy * h)}L${f(tx)} ${f(ty)}${barb(1)}${barb(-1)}`;
}
