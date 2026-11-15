// Turn a puzzle a quarter turn clockwise, so a tall board can be shown sideways on a wide screen.
//
// The rotated puzzle is a different board to the solver (rows and columns swap, arrows turn with it) but the same puzzle to the person:
// it keeps the original's hash for saves, and progress is stored in the ORIGINAL orientation (cellMap/edgeMap convert), so saves,
// solved marks and book counts do not care which way the board happens to be shown.
import { compile } from './logic.js';

/** Cell i of a rows x cols board is at cellMap(rows, cols)[i] after a clockwise quarter turn: (r, c) goes to (c, rows - 1 - r). */
export function cellMap(rows, cols) {
  const m = new Int32Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) m[r * cols + c] = c * rows + (rows - 1 - r);
  return m;
}

/** Same for segments: edge 2i is cell i's right edge, 2i + 1 its bottom edge; the rotated board has `rows` columns. */
export function edgeMap(rows, cols) {
  const cm = cellMap(rows, cols), m = new Int32Array(2 * rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    for (const [kind, j] of [[0, i + 1], [1, i + cols]]) {
      if (kind === 0 && (i % cols) === cols - 1) continue;
      if (kind === 1 && j >= rows * cols) continue;
      const a = cm[i], b = cm[j], lo = Math.min(a, b), hi = Math.max(a, b);
      m[2 * i + kind] = hi === lo + 1 && ((lo % rows) !== rows - 1) ? 2 * lo : 2 * lo + 1;
    }
  }
  return m;
}

/** The raw puzzle turned clockwise (a new object; compile() it). `hashKey` keeps the original's identity. */
export function rotateRaw(p, hashKey) {
  const { rows, cols } = p, cm = cellMap(rows, cols);
  const at = (r, c) => cm[r * cols + c];
  const out = {
    name: p.name, rows: cols, cols: rows, rules: p.rules, tier: p.tier, score: p.score, hashKey, rotated: true,
    clues: p.clues.map((cl) => { const i = at(cl.r, cl.c); return { r: Math.floor(i / rows), c: i % rows, d: (cl.d + 1) % 4, n: cl.n }; }),
    boxes: (p.boxes || []).map((b) => { const i = at(b.r, b.c); return { r: Math.floor(i / rows), c: i % rows }; }),
    solution: '',
  };
  if (p.solution) {
    const s = new Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      const ch = p.solution[i];
      s[cm[i]] = ch === '#' || ch === 'x' ? ch : (((parseInt(ch, 16) << 1) & 15) | ((parseInt(ch, 16) >> 3) & 1)).toString(16);
    }
    out.solution = s.join('');
  }
  return out;
}

/** The compiled puzzle's rotated twin (made once and remembered). `orig` must be compiled and not itself rotated. */
export function rotated(orig, hash) {
  return orig._rotated || (orig._rotated = compile(rotateRaw(orig, hash)));
}

const permute = (arr, map, inverse) => {
  const out = new arr.constructor(arr.length);
  if (inverse) for (let i = 0; i < map.length; i++) out[i] = arr[map[i]]; else for (let i = 0; i < map.length; i++) out[map[i]] = arr[i];
  return out;
};

/**
 * Marks ({cells, edges, auto}) of a rows x cols puzzle (original dimensions) carried to the rotated board (toRotated) or back.
 * Anything else in the object (extra fields) is dropped; the arrays are new.
 */
export function turnMarks(m, rows, cols, toRotated) {
  const cm = cellMap(rows, cols), em = edgeMap(rows, cols), inv = !toRotated;
  return { cells: permute(m.cells, cm, inv), edges: permute(m.edges, em, inv), auto: permute(m.auto, cm, inv) };
}
