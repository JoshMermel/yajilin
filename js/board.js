// SVG board rendering and pointer gestures. Knows nothing about undo, saving or books: main.js owns those.
//
// Gestures (decoded geometrically, nothing depends on timing):
//   * a press and release in one cell      -> handlers.onTap(cell)
//   * a right-click on a cell              -> handlers.onRight(cell)
//   * a press that moves into other cells  -> handlers.onStep(fromCell, toCell, isFirstStep) for each step
// handlers.onStart() / handlers.onEnd() bracket every gesture, so a whole gesture is one undo step.
import { colName } from './logic.js';

const S = 44;     // cell size in SVG units
const PAD = 4;    // room for the frame
const LABEL = 16; // extra room at the top and left for row/column numbers
const PATH_COLORS = 8;
const ARROWS = ['↑', '→', '↓', '←'];
const SVG_NS = 'http://www.w3.org/2000/svg';

export class Board {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.P = null;
    this.gesture = null;
    this.hoverCell = -1;
    this.opts = { colorLines: false, labels: false };
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('pointerleave', () => { if (!this.gesture) this.setHover(-1); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setPuzzle(P) { this.P = P; }

  /** Display options: { colorLines: color each separate path differently, labels: number the rows and columns }. */
  setOptions(opts) { Object.assign(this.opts, opts); if (this.marks) this.render(this.marks, this.info, this.hint); }

  get offset() { return this.opts.labels ? LABEL : 0; }

  /** Number of loop segments at each cell, and the color index of the path each segment belongs to. */
  analyseLines(marks) {
    const P = this.P;
    const deg = new Uint8Array(P.N);
    const parent = new Int32Array(P.N);
    for (let i = 0; i < P.N; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let x = 0; x < P.numEdges; x++) {
      if (!marks.edges[x]) continue;
      const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
      deg[a]++; deg[b]++;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); // the root is the path's lowest cell
    }
    // colors follow the order of the paths' first cells, so they stay put as a path grows away from its first cell
    const colorOf = new Map();
    for (let i = 0; i < P.N; i++) if (deg[i] > 0) { const r = find(i); if (!colorOf.has(r)) colorOf.set(r, colorOf.size % PATH_COLORS); }
    return { deg, colorOf, find };
  }

  /**
   * marks = { cells: Uint8Array (0 blank, 1 shaded, 2 dot), edges: Uint8Array (1 = loop segment) }
   * info  = { clueState: array of 'ok'|'bad'|'' per clue, badShaded: Set of cell indexes }
   * hint  = optional overlay (ghost marks, nothing is changed):
   *   { roles: { clue, range, focus, problem, exit, path: [cells] }, undecided: [cells], shaded: [cells], loop: [cells],
   *     segOn: [edges], segOff: [edges], wrongCells: [cells], wrongEdges: [edges] }
   */
  render(marks, info, hint = null) {
    const P = this.P;
    if (!P) { this.el.innerHTML = ''; return; }
    this.marks = marks; this.info = info; this.hint = hint;
    const OFF = this.offset;
    const W = P.cols * S + 2 * PAD + OFF, H = P.rows * S + 2 * PAD + OFF;
    const cx = (c) => PAD + c * S + S / 2, cy = (r) => PAD + r * S + S / 2;
    const cellX = (i) => PAD + (i % P.cols) * S, cellY = (i) => PAD + ((i / P.cols) | 0) * S;
    const { deg, colorOf, find } = this.analyseLines(marks);
    let g = '';
    for (let r = 0; r < P.rows; r++) {
      for (let c = 0; c < P.cols; c++) {
        const i = r * P.cols + c;
        const x = PAD + c * S, y = PAD + r * S;
        const k = P.clueAt[i];
        if (k >= 0) {
          const cl = P.clues[k];
          g += `<rect class="clue-bg ${info.clueState[k] || ''}" x="${x}" y="${y}" width="${S}" height="${S}"/>`;
          const horiz = cl.d === 1 || cl.d === 3;
          // number and arrow side by side along the arrow's axis keeps the glyph readable in every direction
          g += `<text class="clue-text" x="${x + S / 2 - (horiz ? 0 : 7)}" y="${y + S / 2 + (horiz ? -8 : 1)}" font-size="${S * 0.46}">${cl.n}</text>`;
          g += `<text class="clue-text" x="${x + S / 2 + (horiz ? 0 : 11)}" y="${y + S / 2 + (horiz ? 12 : 1)}" font-size="${S * 0.42}">${ARROWS[cl.d]}</text>`;
        } else {
          g += `<rect class="cell-bg" x="${x}" y="${y}" width="${S}" height="${S}"/>`;
        }
      }
    }
    // hint tints, under the grid lines
    if (hint) {
      const rect = (i, cls) => `<rect class="${cls}" x="${cellX(i)}" y="${cellY(i)}" width="${S}" height="${S}"/>`;
      for (const i of hint.undecided || []) g += rect(i, 'hint-undecided');
      const roles = hint.roles || {};
      for (const role of ['range', 'clue', 'path', 'problem', 'focus']) for (const i of roles[role] || []) g += rect(i, `hint-${role}`);
    }
    for (let r = 0; r <= P.rows; r++) g += `<line class="grid-line" x1="${PAD}" y1="${PAD + r * S}" x2="${PAD + P.cols * S}" y2="${PAD + r * S}"/>`;
    for (let c = 0; c <= P.cols; c++) g += `<line class="grid-line" x1="${PAD + c * S}" y1="${PAD}" x2="${PAD + c * S}" y2="${PAD + P.rows * S}"/>`;
    // a cell with three or four segments is an error
    for (let i = 0; i < P.N; i++) if (deg[i] > 2) g += `<rect class="over" x="${cellX(i) + 2}" y="${cellY(i) + 2}" width="${S - 4}" height="${S - 4}" rx="6"/>`;
    // shaded cells and dots
    const boxes = new Set(P.boxIdx);
    for (let i = 0; i < P.N; i++) {
      const r = (i / P.cols) | 0, c = i % P.cols;
      if (marks.cells[i] === 1) {
        g += `<rect class="shaded ${info.badShaded.has(i) ? 'bad' : ''}" x="${cellX(i) + 3}" y="${cellY(i) + 3}" width="${S - 6}" height="${S - 6}" rx="5"/>`;
        if (boxes.has(i)) g += `<rect class="given-ring" x="${cellX(i) + 9}" y="${cellY(i) + 9}" width="${S - 18}" height="${S - 18}" rx="3"/>`;
      } else if (marks.cells[i] === 2 && deg[i] === 0) {
        // a dot only says "on the loop, exits unknown": once a segment passes through, the line says it better
        g += `<circle class="dot${marks.auto && marks.auto[i] ? ' auto' : ''}" cx="${cx(c)}" cy="${cy(r)}" r="${S * 0.055}"/>`;
      }
    }
    // loop segments, centre to centre (each separate path its own color, if asked)
    for (let x = 0; x < P.numEdges; x++) {
      if (!marks.edges[x]) continue;
      const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
      const style = this.opts.colorLines ? ` style="stroke:var(--path-${colorOf.get(find(a))})"` : '';
      g += `<line class="seg"${style} stroke-width="${S * 0.13}" x1="${cx(a % P.cols)}" y1="${cy((a / P.cols) | 0)}" x2="${cx(b % P.cols)}" y2="${cy((b / P.cols) | 0)}"/>`;
    }
    if (hint) {
      const seg = (x) => { const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1; return [cx(a % P.cols), cy((a / P.cols) | 0), cx(b % P.cols), cy((b / P.cols) | 0)]; };
      const roles = hint.roles || {};
      // outlines on top of the marks: the cell being decided, and the ways out
      for (const i of roles.exit || []) g += `<rect class="hint-exit" x="${cellX(i) + 3}" y="${cellY(i) + 3}" width="${S - 6}" height="${S - 6}" rx="6"/>`;
      for (const i of roles.focus || []) g += `<rect class="hint-focus-ring" x="${cellX(i) + 2}" y="${cellY(i) + 2}" width="${S - 4}" height="${S - 4}" rx="6"/>`;
      for (const i of hint.shaded || []) g += `<rect class="ghost-shade" x="${cellX(i) + 6}" y="${cellY(i) + 6}" width="${S - 12}" height="${S - 12}" rx="5"/>`;
      for (const i of hint.loop || []) g += `<circle class="ghost-dot" cx="${cx(i % P.cols)}" cy="${cy((i / P.cols) | 0)}" r="${S * 0.1}"/>`;
      // ghost segments stop short of the cell centres, so a dot or box in the cell stays visible
      for (const x of hint.segOn || []) {
        const [x1, y1, x2, y2] = seg(x);
        const len = Math.hypot(x2 - x1, y2 - y1), k = (S * 0.3) / len;
        g += `<line class="ghost-seg" stroke-width="${S * 0.12}" x1="${x1 + (x2 - x1) * k}" y1="${y1 + (y2 - y1) * k}" x2="${x2 - (x2 - x1) * k}" y2="${y2 - (y2 - y1) * k}"/>`;
      }
      for (const x of hint.segOff || []) {
        const [x1, y1, x2, y2] = seg(x), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, d = S * 0.17;
        const path = `M${mx - d} ${my - d} L${mx + d} ${my + d} M${mx - d} ${my + d} L${mx + d} ${my - d}`;
        g += `<path class="ghost-x-halo" d="${path}"/><path class="ghost-x" d="${path}"/>`;
      }
      for (const i of hint.wrongCells || []) g += `<rect class="wrong" x="${cellX(i) + 2}" y="${cellY(i) + 2}" width="${S - 4}" height="${S - 4}" rx="6"/>`;
      for (const x of hint.wrongEdges || []) { const [x1, y1, x2, y2] = seg(x); g += `<line class="wrong-seg" stroke-width="${S * 0.2}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
    }
    if (this.hoverCell >= 0 && !this.gesture) {
      g += `<rect class="hover" x="${cellX(this.hoverCell)}" y="${cellY(this.hoverCell)}" width="${S}" height="${S}"/>`;
    }
    g += `<rect class="frame" x="${PAD}" y="${PAD}" width="${P.cols * S}" height="${P.rows * S}"/>`;
    if (this.opts.labels) {
      for (let c = 0; c < P.cols; c++) g += `<text class="axis-label" x="${cx(c)}" y="${PAD - 6}">${colName(c)}</text>`;
      for (let r = 0; r < P.rows; r++) g += `<text class="axis-label side" x="${PAD - 6}" y="${cy(r)}">${r + 1}</text>`;
    }
    const defs = '<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="8" class="hatch-line" stroke-width="4"/></pattern></defs>';
    this.el.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" role="img">${defs}<g transform="translate(${OFF} ${OFF})">${g}</g></svg>`;
  }

  // ---- pointer decoding

  cellAtPoint(clientX, clientY) {
    const svg = this.el.querySelector('svg');
    if (!svg || !this.P) return -1;
    const rect = svg.getBoundingClientRect();
    const OFF = this.offset;
    const px = ((clientX - rect.left) / rect.width) * (this.P.cols * S + 2 * PAD + OFF) - PAD - OFF;
    const py = ((clientY - rect.top) / rect.height) * (this.P.rows * S + 2 * PAD + OFF) - PAD - OFF;
    const c = Math.floor(px / S), r = Math.floor(py / S);
    if (r < 0 || c < 0 || r >= this.P.rows || c >= this.P.cols) return -1;
    return r * this.P.cols + c;
  }

  down(e) {
    const cell = this.cellAtPoint(e.clientX, e.clientY);
    if (e.button === 2) { // right-click: a box, straight away
      if (cell >= 0 && this.h.onRight) { this.h.onStart(); this.h.onRight(cell); this.h.onEnd(false); }
      return;
    }
    if (e.button !== undefined && e.button > 0) return;
    if (cell < 0) return;
    this.el.setPointerCapture?.(e.pointerId);
    this.gesture = { start: cell, last: cell, moved: false, steps: 0, x: e.clientX, y: e.clientY };
    this.h.onStart();
  }

  move(e) {
    const gs = this.gesture;
    if (!gs) { this.setHover(this.cellAtPoint(e.clientX, e.clientY)); return; }
    // Sample along the pointer's path so a fast drag cannot skip a cell.
    const n = Math.max(1, Math.ceil(Math.hypot(e.clientX - gs.x, e.clientY - gs.y) / (this.cellPixels() / 4)));
    for (let t = 1; t <= n; t++) {
      const cell = this.cellAtPoint(gs.x + ((e.clientX - gs.x) * t) / n, gs.y + ((e.clientY - gs.y) * t) / n);
      if (cell < 0 || cell === gs.last) continue;
      const dr = Math.abs(((cell / this.P.cols) | 0) - ((gs.last / this.P.cols) | 0));
      const dc = Math.abs((cell % this.P.cols) - (gs.last % this.P.cols));
      if (dr + dc === 1) { gs.moved = true; this.h.onStep(gs.last, cell, gs.steps++ === 0); }
      gs.last = cell;
    }
    gs.x = e.clientX; gs.y = e.clientY;
  }

  /** On-screen size of one cell in CSS pixels. */
  cellPixels() {
    const svg = this.el.querySelector('svg');
    if (!svg || !this.P) return S;
    return (svg.getBoundingClientRect().width / (this.P.cols * S + 2 * PAD + this.offset)) * S;
  }

  up() {
    const gs = this.gesture;
    if (!gs) return;
    this.gesture = null;
    if (!gs.moved) this.h.onTap(gs.start);
    this.h.onEnd(false);
  }

  cancel() {
    if (!this.gesture) return;
    this.gesture = null;
    this.h.onEnd(true);
  }

  setHover(cell) {
    if (cell === this.hoverCell) return;
    this.hoverCell = cell;
    if (this.marks) this.render(this.marks, this.info, this.hint);
  }
}
