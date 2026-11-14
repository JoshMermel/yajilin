// SVG board rendering and pointer gestures. Knows nothing about undo, saving or books: main.js owns those.
//
// Gestures (decoded geometrically, nothing depends on timing):
//   * a press and release in one cell  -> handlers.onTap(cell)
//   * a press that moves into other cells -> handlers.onStep(fromCell, toCell, isFirstStep) for each step
// handlers.onStart() / handlers.onEnd() bracket every gesture, so a whole gesture is one undo step.
const S = 44;     // cell size in SVG units
const PAD = 4;    // room for the frame
const ARROWS = ['↑', '→', '↓', '←'];
const SVG_NS = 'http://www.w3.org/2000/svg';

export class Board {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.P = null;
    this.gesture = null;
    this.hoverCell = -1;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('pointerleave', () => { if (!this.gesture) this.setHover(-1); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setPuzzle(P) { this.P = P; }

  /**
   * marks = { cells: Uint8Array (0 blank, 1 shaded, 2 dot), edges: Uint8Array (1 = loop segment) }
   * info  = { clueState: array of 'ok'|'bad'|'' per clue, badShaded: Set of cell indexes }
   */
  render(marks, info) {
    const P = this.P;
    if (!P) { this.el.innerHTML = ''; return; }
    this.marks = marks; this.info = info;
    const W = P.cols * S + 2 * PAD, H = P.rows * S + 2 * PAD;
    const cx = (c) => PAD + c * S + S / 2, cy = (r) => PAD + r * S + S / 2;
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
    for (let r = 0; r <= P.rows; r++) g += `<line class="grid-line" x1="${PAD}" y1="${PAD + r * S}" x2="${PAD + P.cols * S}" y2="${PAD + r * S}"/>`;
    for (let c = 0; c <= P.cols; c++) g += `<line class="grid-line" x1="${PAD + c * S}" y1="${PAD}" x2="${PAD + c * S}" y2="${PAD + P.rows * S}"/>`;
    // shaded cells and dots
    for (let i = 0; i < P.N; i++) {
      const r = (i / P.cols) | 0, c = i % P.cols;
      if (marks.cells[i] === 1) {
        g += `<rect class="shaded ${info.badShaded.has(i) ? 'bad' : ''}" x="${PAD + c * S + 3}" y="${PAD + r * S + 3}" width="${S - 6}" height="${S - 6}" rx="5"/>`;
      } else if (marks.cells[i] === 2) {
        g += `<circle class="dot" cx="${cx(c)}" cy="${cy(r)}" r="${S * 0.1}"/>`;
      }
    }
    // loop segments, centre to centre
    for (let x = 0; x < P.numEdges; x++) {
      if (!marks.edges[x]) continue;
      const a = x >> 1, b = (x & 1) ? a + P.cols : a + 1;
      g += `<line class="seg" stroke-width="${S * 0.13}" x1="${cx(a % P.cols)}" y1="${cy((a / P.cols) | 0)}" x2="${cx(b % P.cols)}" y2="${cy((b / P.cols) | 0)}"/>`;
    }
    if (this.hoverCell >= 0 && !this.gesture) {
      const r = (this.hoverCell / P.cols) | 0, c = this.hoverCell % P.cols;
      g += `<rect class="hover" x="${PAD + c * S}" y="${PAD + r * S}" width="${S}" height="${S}"/>`;
    }
    g += `<rect class="frame" x="${PAD}" y="${PAD}" width="${P.cols * S}" height="${P.rows * S}"/>`;
    this.el.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
  }

  // ---- pointer decoding

  cellAtPoint(clientX, clientY) {
    const svg = this.el.querySelector('svg');
    if (!svg || !this.P) return -1;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * (this.P.cols * S + 2 * PAD) - PAD;
    const py = ((clientY - rect.top) / rect.height) * (this.P.rows * S + 2 * PAD) - PAD;
    const c = Math.floor(px / S), r = Math.floor(py / S);
    if (r < 0 || c < 0 || r >= this.P.rows || c >= this.P.cols) return -1;
    return r * this.P.cols + c;
  }

  down(e) {
    if (e.button !== undefined && e.button > 0) return;
    const cell = this.cellAtPoint(e.clientX, e.clientY);
    if (cell < 0) return;
    this.el.setPointerCapture?.(e.pointerId);
    this.gesture = { start: cell, last: cell, moved: false, steps: 0, x: e.clientX, y: e.clientY };
    this.h.onStart();
  }

  move(e) {
    const gs = this.gesture;
    if (!gs) { this.setHover(this.cellAtPoint(e.clientX, e.clientY)); return; }
    // Sample along the pointer's path so a fast drag cannot skip a cell.
    const n = Math.max(1, Math.ceil(Math.hypot(e.clientX - gs.x, e.clientY - gs.y) / (S / 4)));
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
    if (this.marks) this.render(this.marks, this.info);
  }
}
