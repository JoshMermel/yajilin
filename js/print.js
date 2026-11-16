// Printable booklets: pick puzzles from the current book and print them (or "Save as PDF" in the browser's print dialog), optionally
// followed by an answer key. Boards are drawn as plain SVG with fixed colours, so a booklet looks the same in dark mode and on paper.
// (Same design as polyomino-panel's print.js.)
//
// buildPrintRoot() fills the hidden #print-root element; style.css shows only that element while printing (see "Printing" there).
// Everything except buildPrintRoot is pure (no DOM), so the layout and the drawing can be tested in node.
import { SHADED, E_ON } from './logic.js';

const INK = '#111', GRID = '#9a9a9a', CLUE_BG = '#dcdcdc';
export const MAX_PRINT = 500;
/** Linked from the header of every page, so a PDF leads back to the puzzles (and a paper copy shows where they came from). */
export const SITE_URL = 'https://joshmermelstein.com/yajilin/';
export const SITE_TEXT = SITE_URL.replace(/^https:\/\//, '').replace(/\/$/, '');

// "1-10, 15, 20-22" -> { ids: [1..10, 15, 20, 21, 22] } (ascending, no repeats) or { error }.
export function parseSelection(text, total) {
  // "1 - 5" means 1-5: close up spaces around dashes before splitting on commas and spaces
  const parts = text.replace(/\s*[-–]\s*/g, '-').split(/[,\s]+/).filter(Boolean);
  if (!parts.length) return { error: 'Enter the puzzles to print, for example 1-10 or 3, 7, 12.' };
  const ids = new Set();
  for (const part of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return { error: `"${part}" isn't a puzzle number or range.` };
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b < 1 || a > total || b > total) return { error: `This book has puzzles 1 to ${total}.` };
    if (b < a) return { error: `"${part}" is backwards.` };
    for (let i = a; i <= b; i++) ids.add(i);
  }
  if (ids.size > MAX_PRINT) return { error: `Please print at most ${MAX_PRINT} puzzles at a time.` };
  return { ids: [...ids].sort((x, y) => x - y) };
}

// --- Page layout ---------------------------------------------------------------------------------------------
// Boards are laid out by CELL SIZE, not by a fixed count: every board in the selection is drawn with cells of about SIZES[size]
// millimetres (a puzzle needs room to draw a loop in, an answer only has to show it), and a page carries as many columns and rows of
// them as fit. The printable area is the smaller of A4 and Letter minus the 12 mm margins (see style.css), so it is the same on both.
export const SIZES = {
  comfortable: { label: 'Comfortable', puzzle: 7, answer: 4 },
  compact: { label: 'Compact', puzzle: 5.5, answer: 3.2 },
};
export const PAGE = { w: 186, h: 255, head: 14, caption: 8.5, colGap: 5, rowGap: 6 };      // mm
const BOARD_PAD = 0.12;       // a board's svg is this many cell units wider and taller than its cells (see boardSvg)
const CAPTION_CHAR_MM = 2.0;  // a caption's text is about 2 mm a character at 3.6 mm type

/** A puzzle's board size in cell units. */
export const boardUnits = (P) => [P.cols + BOARD_PAD, P.rows + BOARD_PAD];

/** How wide a caption is, in mm ('#', up to three digits, ' · ' and the tier). */
export function captionMm(P, answer = false) {
  const chars = 1 + 3 + (!answer && P.tier ? 3 + P.tier.length : 0);
  return chars * CAPTION_CHAR_MM;
}

/** The grid of boards on a page for these puzzles: { cellMm, cols, rows, perPage }. The cell size is `cellMm`, shrunk if the biggest
 *  board would not fit on a page at that size. All boards share the cell size and the grid (the biggest board sets it). */
export function layoutFor(puzzles, cellMm, answer = false) {
  let w = 0, h = 0;
  for (const p of puzzles) { const [pw, ph] = boardUnits(p); w = Math.max(w, pw); h = Math.max(h, ph); }
  if (!w) return { cellMm, cols: 1, rows: 1, perPage: 1 };
  const cell = Math.min(cellMm, PAGE.w / w, (PAGE.h - PAGE.head - PAGE.caption) / h);
  const boardH = h * cell;
  let itemW = 0;
  for (const p of puzzles) itemW = Math.max(itemW, boardUnits(p)[0] * cell, captionMm(p, answer));
  const cols = Math.max(1, Math.floor((PAGE.w + PAGE.colGap) / (itemW + PAGE.colGap)));
  const rows = Math.max(1, Math.floor((PAGE.h - PAGE.head + PAGE.rowGap) / (boardH + PAGE.caption + PAGE.rowGap)));
  return { cellMm: cell, cols, rows, perPage: cols * rows };
}

/** How many pages a booklet takes and how many boards go on each. `keyIds` are the puzzles that have an answer (none: no key). */
export function planPrint({ puzzles, ids, keyIds = [], size = 'comfortable' }) {
  const { puzzle: puzzleMm, answer: answerMm } = SIZES[size] ?? SIZES.comfortable;
  const puzzleLayout = layoutFor(ids.map((id) => puzzles[id - 1]), puzzleMm);
  const keyLayout = keyIds.length ? layoutFor(keyIds.map((id) => puzzles[id - 1]), answerMm, true) : null;
  return {
    puzzleLayout, keyLayout,
    perPage: puzzleLayout.perPage, keyPerPage: keyLayout?.perPage ?? 0,
    puzzlePages: Math.ceil(ids.length / puzzleLayout.perPage),
    keyPages: keyLayout ? Math.ceil(keyIds.length / keyLayout.perPage) : 0,
  };
}

// --- Drawing -------------------------------------------------------------------------------------------------
const f = (v) => +v.toFixed(3);
const VEC = [[0, -1], [1, 0], [0, 1], [-1, 0]];     // arrow directions: 0 up, 1 right, 2 down, 3 left

/** An arrow centred at (x, y), `len` long, pointing in direction d, as lines (no font needed, so it prints the same everywhere). */
function arrowMarkup(x, y, d, len) {
  const [ux, uy] = VEC[d], h = len / 2, head = len * 0.36;
  const tx = x + ux * h, ty = y + uy * h;
  // the two barbs of the head: the shaft direction turned by +-135 degrees
  const barb = (sign) => { const a = Math.atan2(uy, ux) + sign * (Math.PI * 3 / 4); return `M${f(tx)} ${f(ty)}L${f(tx + Math.cos(a) * head)} ${f(ty + Math.sin(a) * head)}`; };
  return `<path class="arrow" d="M${f(x - ux * h)} ${f(y - uy * h)}L${f(tx)} ${f(ty)}${barb(1)}${barb(-1)}" fill="none" stroke="${INK}" stroke-width="0.075" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/**
 * One board as an SVG string (a cell is 1 unit). `sol` (decoded solution: { cell, e }) draws the answer: the boxes and the loop.
 * Clue cells are grey with the number and an arrow; pre-placed boxes are always drawn.
 */
export function boardSvg(P, sol = null) {
  const { rows, cols } = P, pad = 0.06;
  let g = `<rect x="0" y="0" width="${cols}" height="${rows}" fill="#fff"/>`;
  for (const cl of P.clues) {
    const x = cl.c, y = cl.r, horiz = cl.d === 1 || cl.d === 3;
    g += `<rect class="clue" x="${x}" y="${y}" width="1" height="1" fill="${CLUE_BG}"/>`;
    if (cl.n >= 0) {                      // (a clue without a number is a blocked cell: nothing but the grey)
      // number and arrow stack for sideways arrows and sit side by side for vertical ones, as on screen
      const nx = x + 0.5 - (horiz ? 0 : 0.17), ny = y + 0.5 + (horiz ? -0.2 : 0);
      const ax = x + 0.5 + (horiz ? 0 : 0.26), ay = y + 0.5 + (horiz ? 0.25 : 0);
      g += `<text class="num" x="${f(nx)}" y="${f(ny + 0.16)}" font-size="0.46" font-weight="700" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" fill="${INK}">${cl.n}</text>`;
      g += arrowMarkup(ax, ay, cl.d, horiz ? 0.42 : 0.46);
    }
  }
  for (let i = 1; i < cols; i++) g += `<line x1="${i}" y1="0" x2="${i}" y2="${rows}" stroke="${GRID}" stroke-width="0.025" stroke-dasharray="0.07 0.06"/>`;
  for (let i = 1; i < rows; i++) g += `<line x1="0" y1="${i}" x2="${cols}" y2="${i}" stroke="${GRID}" stroke-width="0.025" stroke-dasharray="0.07 0.06"/>`;
  const box = (i) => `<rect class="box" x="${(i % cols) + 0.1}" y="${((i / cols) | 0) + 0.1}" width="0.8" height="0.8" rx="0.1" fill="${INK}"/>`;
  const given = new Set(P.boxIdx);
  for (const i of given) g += box(i);
  if (sol) {
    for (let i = 0; i < P.N; i++) if (P.clueAt[i] < 0 && !given.has(i) && sol.cell[i] === SHADED) g += box(i);
    for (let x = 0; x < P.numEdges; x++) {
      if (sol.e[x] !== E_ON) continue;
      const a = x >> 1, b = (x & 1) ? a + cols : a + 1;
      g += `<line class="loop" x1="${(a % cols) + 0.5}" y1="${((a / cols) | 0) + 0.5}" x2="${(b % cols) + 0.5}" y2="${((b / cols) | 0) + 0.5}" stroke="${INK}" stroke-width="0.14" stroke-linecap="round"/>`;
    }
  }
  g += `<rect x="0" y="0" width="${cols}" height="${rows}" fill="none" stroke="${INK}" stroke-width="0.08"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="print-board" viewBox="${-pad} ${-pad} ${cols + 2 * pad} ${rows + 2 * pad}">${g}</svg>`;
}

// --- The page --------------------------------------------------------------------------------------------------
const div = (cls, parent, text) => {
  const el = document.createElement('div');
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  parent?.appendChild(el);
  return el;
};

/**
 * Fill (and return) the #print-root element.
 *   book       { title } the current book
 *   puzzles    the book's compiled puzzles;  ids  the 1-based numbers to print
 *   size       'comfortable' or 'compact' (SIZES)
 *   solutionOf puzzle -> decoded solution ({ cell, e }) or null
 */
export function buildPrintRoot({ book, puzzles, ids, size = 'comfortable', includeKey, solutionOf }) {
  let root = document.getElementById('print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.textContent = '';

  const link = (text, cls) => { const a = document.createElement('a'); a.href = SITE_URL; a.textContent = text; a.className = cls; return a; };
  const addPages = (list, layout, withSolution, heading) => {
    const k = layout.perPage;
    for (let i = 0; i < list.length; i += k) {
      const page = div('print-page', root);
      const head = div('print-head', page);
      div('print-brand', head).append(link('Yajilin', 'print-name'));
      head.append(link(SITE_TEXT, 'print-url'));
      div('print-book', head, `${book.title}${heading ? ` · ${heading}` : ''}`);
      const grid = div('print-grid', page);
      grid.style.setProperty('--cols', layout.cols);
      for (const id of list.slice(i, i + k)) {
        const P = puzzles[id - 1];
        const fig = div('print-item', grid);
        div('print-caption', fig, `#${id}${!withSolution && P.tier ? ` · ${P.tier}` : ''}`);
        fig.insertAdjacentHTML('beforeend', boardSvg(P, withSolution ? solutionOf(P) : null));
        fig.lastElementChild.style.width = `${boardUnits(P)[0] * layout.cellMm}mm`;       // one cell size for every board, whatever its shape
      }
    }
  };

  const keyIds = includeKey ? ids.filter((id) => solutionOf(puzzles[id - 1])) : [];
  const plan = planPrint({ puzzles, ids, keyIds, size });
  addPages(ids, plan.puzzleLayout, false, null);
  if (keyIds.length) addPages(keyIds, plan.keyLayout, true, 'Answers');
  return root;
}
