// SVG board rendering and pointer gestures. Knows nothing about undo, saving or books: main.js owns those.
//
// Gestures (decoded geometrically, nothing depends on timing):
//   * a press and release in one cell      -> handlers.onTap(cell)
//   * a right-click on a cell              -> handlers.onRight(cell)
//   * a press that moves into other cells  -> handlers.onStep(fromCell, toCell, isFirstStep) for each step
// handlers.onStart() / handlers.onEnd() bracket every gesture, so a whole gesture is one undo step.
import { colName, hexStep, HEX_ARROWS } from './logic.js';
import { makeColorKeeper, assignPathColors } from './pathcolors.js';
import { makeGrace } from './grace.js';
import { otherEnd } from './lineends.js';

const S = 44;     // cell size in SVG units
const PAD = 4;    // room for the frame
export const LABEL = 16; // extra room at the top and left for row/column numbers
const ARROWS = ['↑', '→', '↓', '←', '↗', '↘', '↙', '↖'];
// Hex boards: pointy-top hexagons that are S wide (flat side to flat side), every odd row shifted half a cell right (see logic.js).
const HR = S / Math.sqrt(3);          // the hexagon's circumradius
const HROW = 1.5 * HR;                // distance between the centres of two rows
const BAD_DELAY_MS = 300; // how long a newly red arrow or box waits, so a double tap can finish first (see js/grace.js)
const SVG_NS = 'http://www.w3.org/2000/svg';

/** The arrows whose line counts cell i (their indexes in P.clues). The inverse of P.rays, made once per puzzle and remembered. */
function pointersAt(P, i) {
  if (!P._pointers) {
    P._pointers = Array.from({ length: P.N }, () => []);
    P.clues.forEach((cl, k) => { if (cl.n >= 0 && !cl.region) for (const j of P.rays[k]) P._pointers[j].push(k); });
  }
  return P._pointers[i];
}

export class Board {
  constructor(el, handlers) {
    this.el = el;
    this.h = handlers;
    this.P = null;
    this.gesture = null;
    this.hoverCell = -1;
    this.pinned = -1;                                  // an arrow tapped or clicked: its line stays tinted (see pinArrow())
    this.opts = { colorLines: false, pathColors: null, pathAlike: null };
    this.grace = makeGrace(); this._badTimer = 0; this._graceNow = true;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('pointerleave', () => { if (!this.gesture) this.setHover(-1); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setPuzzle(P) { this.P = P; this.pinned = -1; this.colors = null; this.grace.reset(); clearTimeout(this._badTimer); this._graceNow = true; }   // the first render of a puzzle shows its red at once

  /**
   * Display options: { colorLines: color each separate path differently, pathColors: the colors to use for that (a list of '#rrggbb', see
   * js/palettes.js), pathAlike: how much those colors look alike (alikeMatrix in js/palettes.js; used to give a new line a color that
   * stands out from its neighbors) }.
   */
  setOptions(opts) {
    // a palette of another size: the colors lines were given are indexes into the old one, so every line gets a fresh one
    if (opts.pathColors && this.opts.pathColors && opts.pathColors.length !== this.opts.pathColors.length) this.colors = null;
    Object.assign(this.opts, opts);
    if (this.marks) this.render(this.marks, this.info, this.hint);
  }

  get offset() { return LABEL; }

  /** Number of loop segments at each cell, and the color index of the path each segment belongs to. */
  analyseLines(marks) {
    const P = this.P;
    const deg = new Uint8Array(P.N);
    const parent = new Int32Array(P.N);
    for (let i = 0; i < P.N; i++) parent[i] = i;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let x = 0; x < P.numEdges; x++) {
      if (!marks.edges[x]) continue;
      const a = P.edgeA[x], b = P.edgeB[x];
      deg[a]++; deg[b]++;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); // the root is the path's lowest cell
    }
    // colors stay with their lines: see pathcolors.js (a new line never recolors the others; a joined line keeps the older color)
    if (!this.colors || this.colors.birth.length !== P.numEdges) this.colors = makeColorKeeper(P.numEdges);
    const alike = this.opts.pathAlike;
    const near = alike && !P.hex ? { cols: P.cols, alike: (i, j) => alike[i][j] } : null;       // (the colour-spacing aid is square-only for now)
    const colorOf = assignPathColors(this.colors, marks.edges, (x) => find(P.edgeA[x]), (this.opts.pathColors || [0]).length, near);
    return { deg, colorOf, find };
  }

  /**
   * marks = { cells: Uint8Array (0 blank, 1 shaded, 2 dot), edges: Uint8Array (1 = loop segment) }
   * info  = { clueState: array of 'ok'|'bad'|'' per clue, badShaded: Set of cell indexes }
   * hint  = optional overlay (ghost marks, nothing is changed):
   *   { roles: { clue, range, focus, problem, exit, path: [cells] }, undecided: [cells], shaded: [cells], loop: [cells],
   *     segOn: [edges], segOff: [edges], chain: [edges: the lines an imagined box would force], wrongCells: [cells], wrongEdges: [edges] }
   */
  render(marks, info, hint = null) {
    const P = this.P;
    if (!P) { this.el.innerHTML = ''; return; }
    this.marks = marks; this.info = info; this.hint = hint;
    // Red is the only thing that scolds, and a state that is bad right now may just be the first tap of a double tap, so newly bad arrows
    // and boxes wait BAD_DELAY_MS before they show (any change that clears them cancels it; clearing red is immediate).
    const wanted = new Set();
    info.clueState.forEach((st, k) => { if (st === 'bad') wanted.add(`c${k}`); });
    for (const i of info.badShaded) wanted.add(`s${i}`);
    const { show, waiting, fresh } = this.grace.update(wanted, this._graceNow);
    this._graceNow = false;
    if (!waiting.size) clearTimeout(this._badTimer);
    else if (fresh) {
      clearTimeout(this._badTimer);
      this._badTimer = setTimeout(() => { this.grace.commit(); if (this.marks) this.render(this.marks, this.info, this.hint); }, BAD_DELAY_MS);
    }
    if (P.hex) { this.el.innerHTML = this.hexMarkup(marks, info, show, hint); return; }
    const OFF = this.offset;
    const W = P.cols * S + 2 * PAD + OFF, H = P.rows * S + 2 * PAD + OFF;
    const cx = (c) => PAD + c * S + S / 2, cy = (r) => PAD + r * S + S / 2;
    const cellX = (i) => PAD + (i % P.cols) * S, cellY = (i) => PAD + ((i / P.cols) | 0) * S;
    const { deg, colorOf, find } = this.analyseLines(marks);
    // One rect behind everything instead of one per blank cell: the same picture from a third of the markup (a 20x36 board had 617 of them),
    // and the browser's parse-and-layout of every redraw takes about 40% less.
    let g = `<rect class="cell-bg" x="${PAD}" y="${PAD}" width="${P.cols * S}" height="${P.rows * S}"/>`;
    for (let r = 0; r < P.rows; r++) {
      for (let c = 0; c < P.cols; c++) {
        const i = r * P.cols + c;
        const x = PAD + c * S, y = PAD + r * S;
        const k = P.clueAt[i];
        if (k >= 0 && P.clues[k].n < 0) {
          // a void cell: nothing goes here. Drawn like a clue cell (same gray, no number), not like the player's boxes: it is a given, part of the
          // board's wall. The thick outline round the walls is drawn after the grid lines below.
          g += `<rect class="void-bg" x="${x}" y="${y}" width="${S}" height="${S}"/>`;
        } else if (k >= 0) {
          const cl = P.clues[k];
          g += `<rect class="clue-bg ${info.clueState[k] === 'bad' ? (show.has(`c${k}`) ? 'bad' : '') : info.clueState[k] || ''}" x="${x}" y="${y}" width="${S}" height="${S}"/>`;
          const horiz = cl.d === 1 || cl.d === 3;
          // number and arrow side by side along the arrow's axis keeps the glyph readable in every direction
          g += `<text class="clue-text" x="${x + S / 2 - (horiz ? 0 : 7)}" y="${y + S / 2 + (horiz ? -8 : 1)}" font-size="${S * 0.46}">${cl.n}</text>`;
          g += `<text class="clue-text" x="${x + S / 2 + (horiz ? 0 : 11)}" y="${y + S / 2 + (horiz ? 12 : 1)}" font-size="${S * 0.42}">${ARROWS[cl.d]}</text>`;
        }                                                    // (a blank cell has no rect of its own: see the one behind the grid below)
      }
    }
    // hint tints, under the grid lines
    if (hint) {
      const rect = (i, cls) => `<rect class="${cls}" x="${cellX(i)}" y="${cellY(i)}" width="${S}" height="${S}"/>`;
      for (const i of hint.undecided || []) g += rect(i, 'hint-undecided');
      const roles = hint.roles || {};
      for (const role of ['range', 'clue', 'path', 'problem', 'focus']) for (const i of roles[role] || []) g += rect(i, `hint-${role}`);
    }
    // hovering an arrow (or tapping or clicking it, which keeps it) tints every cell it counts in: the open ones (no box, dot or line yet) strongest,
    // since that is where its boxes can still go
    for (const at of new Set([this.gesture ? -1 : this.hoverCell, this.pinned])) {
      const k = at >= 0 ? P.clueAt[at] : -1;
      if (k >= 0 && P.clues[k].n >= 0 && !P.clues[k].region) for (const i of P.rays[k]) g += `<rect class="hover-ray${marks.cells[i] === 0 && deg[i] === 0 ? '' : ' decided'}" x="${cellX(i)}" y="${cellY(i)}" width="${S}" height="${S}"/>`;
    }
    for (let r = 0; r <= P.rows; r++) g += `<line class="grid-line" x1="${PAD}" y1="${PAD + r * S}" x2="${PAD + P.cols * S}" y2="${PAD + r * S}"/>`;
    for (let c = 0; c <= P.cols; c++) g += `<line class="grid-line" x1="${PAD + c * S}" y1="${PAD}" x2="${PAD + c * S}" y2="${PAD + P.rows * S}"/>`;
    // the walls: a thick line on every edge between a gray cell (a void or a clue) and a cell that is part of the board, so gray cells side by side
    // (voids, arrows, or a frame of both) read as one shape, and an arrow looks the same whether or not it touches a void
    {
      const isGray = (i) => i >= 0 && P.clueAt[i] >= 0;
      let d = '';
      for (let i = 0; i < P.N; i++) {
        if (!isGray(i)) continue;
        const r = (i / P.cols) | 0, c = i % P.cols, x = PAD + c * S, y = PAD + r * S;
        // (P.nb leaves clue cells out, so the neighbours are found from the grid)
        const nbr = [r > 0 ? i - P.cols : -1, c < P.cols - 1 ? i + 1 : -1, r < P.rows - 1 ? i + P.cols : -1, c > 0 ? i - 1 : -1];      // up, right, down, left
        const sides = [[x, y, x + S, y], [x + S, y, x + S, y + S], [x, y + S, x + S, y + S], [x, y, x, y + S]];
        for (let q = 0; q < 4; q++) { const j = nbr[q]; if (j >= 0 && !isGray(j)) d += `M${sides[q][0]} ${sides[q][1]}L${sides[q][2]} ${sides[q][3]}`; }
      }
      if (d) g += `<path class="void-wall" d="${d}"/>`;
    }
    // regional puzzles: the regions' borders, heavier than the grid (one path for all of them)
    if (P.regional) {
      let d = '';
      for (let i = 0; i < P.N; i++) {
        const r = (i / P.cols) | 0, c = i % P.cols;
        if (c + 1 < P.cols && P.regionOf[i] !== P.regionOf[i + 1]) d += `M${PAD + (c + 1) * S} ${PAD + r * S}v${S}`;
        if (r + 1 < P.rows && P.regionOf[i] !== P.regionOf[i + P.cols]) d += `M${PAD + c * S} ${PAD + (r + 1) * S}h${S}`;
      }
      if (d) g += `<path class="region-line" d="${d}"/>`;
    }
    // a cell with three or four segments is an error
    for (let i = 0; i < P.N; i++) if (deg[i] > 2) g += `<rect class="over" x="${cellX(i) + 2}" y="${cellY(i) + 2}" width="${S - 4}" height="${S - 4}" rx="6"/>`;
    // shaded cells and dots
    const boxes = new Set(P.boxIdx);
    for (let i = 0; i < P.N; i++) {
      const r = (i / P.cols) | 0, c = i % P.cols;
      if (marks.cells[i] === 1) {
        g += `<rect class="shaded ${show.has(`s${i}`) ? 'bad' : ''}" x="${cellX(i) + 3}" y="${cellY(i) + 3}" width="${S - 6}" height="${S - 6}" rx="5"/>`;
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
      const pc = this.opts.pathColors;
      const style = this.opts.colorLines && pc ? ` style="stroke:${pc[colorOf.get(find(a)) % pc.length]}"` : '';
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
      // the lines an imagined box would force (Hint's lookahead steps): the whole segment, dashed, under the ghost marks
      for (const x of hint.chain || []) { const [x1, y1, x2, y2] = seg(x); g += `<line class="chain-seg" stroke-width="${S * 0.1}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
      for (const x of hint.segOff || []) {
        const [x1, y1, x2, y2] = seg(x), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, d = S * 0.17;
        const path = `M${mx - d} ${my - d} L${mx + d} ${my + d} M${mx - d} ${my + d} L${mx + d} ${my - d}`;
        g += `<path class="ghost-x-halo" d="${path}"/><path class="ghost-x" d="${path}"/>`;
      }
      for (const i of hint.wrongCells || []) g += `<rect class="wrong" x="${cellX(i) + 2}" y="${cellY(i) + 2}" width="${S - 4}" height="${S - 4}" rx="6"/>`;
      for (const x of hint.wrongEdges || []) { const [x1, y1, x2, y2] = seg(x); g += `<line class="wrong-seg" stroke-width="${S * 0.2}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
    }
    // regional puzzles: each region's number sits in a corner of one of its cells (that cell is an ordinary cell: a box or a dot can go there too).
    // Drawn after the hint overlays, so a ghost box or a highlight on that cell never hides it.
    if (P.regional) {
      P.clues.forEach((cl, k) => {
        const i = cl.r * P.cols + cl.c, st = info.clueState[k];
        g += `<text class="region-num ${st === 'bad' ? (show.has(`c${k}`) ? 'bad' : '') : st || ''}" x="${cellX(i) + 5}" y="${cellY(i) + 16}" font-size="15">${cl.n}</text>`;
      });
    }
    const over = this.gesture ? -1 : this.hoverCell;
    if (over >= 0) {
      g += `<rect class="hover" x="${cellX(over)}" y="${cellY(over)}" width="${S}" height="${S}"/>`;
      // every arrow that counts this cell gets an outline, so on a big board it is easy to see what points at the cell under the cursor
      for (const k of pointersAt(P, over)) { const i = P.clues[k].r * P.cols + P.clues[k].c; g += `<rect class="hover-pointer" x="${cellX(i) + 1.5}" y="${cellY(i) + 1.5}" width="${S - 3}" height="${S - 3}" rx="3"/>`; }
    }
    // the pointer on the end of a line: ring both ends of it, to help follow it across the board (not on a line that branches, see otherEnd())
    if (over >= 0 && deg[over] === 1) {
      const far = otherEnd(P, marks.edges, over);
      if (far >= 0) for (const i of [over, far]) g += `<circle class="line-end-halo" cx="${cx(i % P.cols)}" cy="${cy((i / P.cols) | 0)}" r="${S * 0.19}"/><circle class="line-end" cx="${cx(i % P.cols)}" cy="${cy((i / P.cols) | 0)}" r="${S * 0.19}"/>`;
    }
    g += `<rect class="frame" x="${PAD}" y="${PAD}" width="${P.cols * S}" height="${P.rows * S}"/>`;
    // row and column labels; those of the cell under the cursor stand out
    const hc = over >= 0 ? over % P.cols : -1, hr = over >= 0 ? (over / P.cols) | 0 : -1;
    for (let c = 0; c < P.cols; c++) g += `<text class="axis-label${c === hc ? ' here' : ''}" x="${cx(c)}" y="${PAD - 6}">${colName(c)}</text>`;
    for (let r = 0; r < P.rows; r++) g += `<text class="axis-label side${r === hr ? ' here' : ''}" x="${PAD - 6}" y="${cy(r)}">${r + 1}</text>`;
    const defs = '<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="8" class="hatch-line" stroke-width="4"/></pattern>'
      + '</defs>';
    this.el.innerHTML = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" role="img">${defs}<g transform="translate(${OFF} ${OFF})">${g}</g></svg>`;
  }

  /** The drawing's size in SVG units (labels included). */
  size() {
    const P = this.P, OFF = this.offset;
    return P.hex ? { W: P.cols * S + S / 2 + 2 * PAD + OFF, H: HROW * P.rows + HR / 2 + 2 * PAD + OFF } : { W: P.cols * S + 2 * PAD + OFF, H: P.rows * S + 2 * PAD + OFF };
  }

  /** Centre of a hex cell, in the board's own coordinates (before the label offset). */
  hexCenter(r, c) { return [PAD + S / 2 + c * S + (r & 1) * (S / 2), PAD + HR + r * HROW]; }

  /** The markup of a hex board: the same marks, colours and classes as the square board. The hint overlay is the part of the square one that js/hexhint.js uses. */
  hexMarkup(marks, info, show, hint = null) {
    const P = this.P, OFF = this.offset, { W, H } = this.size();
    const ctr = (i) => this.hexCenter((i / P.cols) | 0, i % P.cols);
    const verts = (i, k = 1) => {
      const [x, y] = ctr(i), w = (S / 2) * k, h = (HR / 2) * k, t = HR * k;
      return [[x, y - t], [x + w, y - h], [x + w, y + h], [x, y + t], [x - w, y + h], [x - w, y - h]];
    };
    const points = (i, k = 1) => verts(i, k).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const outline = (i) => 'M' + verts(i).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
    const { deg, colorOf, find } = this.analyseLines(marks);
    let g = '', bg = '';
    for (let i = 0; i < P.N; i++) bg += outline(i);
    g += `<path class="cell-bg" d="${bg}"/><path class="grid-line" fill="none" d="${bg}"/>`;
    for (let k = 0; k < P.clues.length; k++) {
      const cl = P.clues[k], i = cl.r * P.cols + cl.c, [x, y] = ctr(i);
      if (cl.n < 0) { g += `<polygon class="void-bg" points="${points(i)}"/>`; continue; }
      const st = info.clueState[k] === 'bad' ? (show.has(`c${k}`) ? 'bad' : '') : info.clueState[k] || '';
      const horiz = cl.d === 0 || cl.d === 3;
      g += `<polygon class="clue-bg ${st}" points="${points(i)}"/>`;
      g += `<text class="clue-text" x="${x - (horiz ? 0 : 7)}" y="${y + (horiz ? -8 : 1)}" font-size="${S * 0.46}">${cl.n}</text>`;
      g += `<text class="clue-text" x="${x + (horiz ? 0 : 11)}" y="${y + (horiz ? 12 : 1)}" font-size="${S * 0.42}">${HEX_ARROWS[cl.d]}</text>`;
    }
    const roles = (hint && hint.roles) || {};
    if (hint) {
      for (const i of hint.undecided || []) g += `<polygon class="hint-undecided" points="${points(i)}"/>`;
      for (const i of roles.focus || []) g += `<polygon class="hint-focus" points="${points(i)}"/>`;
    }
    // an arrow that is hovered (or tapped, which keeps it) tints the cells it counts in
    for (const at of new Set([this.gesture ? -1 : this.hoverCell, this.pinned])) {
      const k = at >= 0 ? P.clueAt[at] : -1;
      if (k >= 0 && P.clues[k].n >= 0) for (const i of P.rays[k]) g += `<polygon class="hover-ray${marks.cells[i] === 0 && deg[i] === 0 ? '' : ' decided'}" points="${points(i)}"/>`;
    }
    // the board's outline: every side of a cell that has no neighbour
    let wall = '';
    for (let i = 0; i < P.N; i++) {
      const v = verts(i), r = (i / P.cols) | 0, c = i % P.cols;
      for (let d = 0; d < 6; d++) {
        const [nr, nc] = hexStep(r, c, d);
        if (nr >= 0 && nc >= 0 && nr < P.rows && nc < P.cols) continue;
        const [a, b] = [[v[1], v[2]], [v[2], v[3]], [v[3], v[4]], [v[4], v[5]], [v[5], v[0]], [v[0], v[1]]][d];       // the side facing direction d
        wall += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
      }
    }
    g += `<path class="frame" stroke-linejoin="round" d="${wall}"/>`;
    for (let i = 0; i < P.N; i++) if (deg[i] > 2) g += `<polygon class="over" points="${points(i, 0.85)}"/>`;
    for (let i = 0; i < P.N; i++) {
      const [x, y] = ctr(i);
      if (marks.cells[i] === 1) g += `<polygon class="shaded ${show.has(`s${i}`) ? 'bad' : ''}" stroke-linejoin="round" points="${points(i, 0.72)}"/>`;
      else if (marks.cells[i] === 2 && deg[i] === 0) g += `<circle class="dot${marks.auto && marks.auto[i] ? ' auto' : ''}" cx="${x}" cy="${y}" r="${S * 0.055}"/>`;
    }
    for (let x = 0; x < P.numEdges; x++) {
      if (!marks.edges[x]) continue;
      const a = P.edgeA[x], b = P.edgeB[x], [x1, y1] = ctr(a), [x2, y2] = ctr(b), pc = this.opts.pathColors;
      const style = this.opts.colorLines && pc ? ` style="stroke:${pc[colorOf.get(find(a)) % pc.length]}"` : '';
      g += `<line class="seg"${style} stroke-width="${S * 0.13}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    }
    if (hint) {
      const seg = (x) => { const [x1, y1] = ctr(P.edgeA[x]), [x2, y2] = ctr(P.edgeB[x]); return [x1, y1, x2, y2]; };
      for (const i of roles.focus || []) g += `<polygon class="hint-focus-ring" stroke-linejoin="round" points="${points(i, 0.94)}"/>`;
      for (const i of hint.shaded || []) g += `<polygon class="ghost-shade" stroke-linejoin="round" points="${points(i, 0.5)}"/>`;
      for (const i of hint.loop || []) { const [x, y] = ctr(i); g += `<circle class="ghost-dot" cx="${x}" cy="${y}" r="${S * 0.1}"/>`; }
      for (const x of hint.chain || []) { const [x1, y1, x2, y2] = seg(x); g += `<line class="chain-seg" stroke-width="${S * 0.1}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
      for (const x of hint.segOn || []) {                                      // ghost segments stop short of the centres, so a dot or box in the cell stays visible
        const [x1, y1, x2, y2] = seg(x), k = (S * 0.3) / Math.hypot(x2 - x1, y2 - y1);
        g += `<line class="ghost-seg" stroke-width="${S * 0.12}" x1="${x1 + (x2 - x1) * k}" y1="${y1 + (y2 - y1) * k}" x2="${x2 - (x2 - x1) * k}" y2="${y2 - (y2 - y1) * k}"/>`;
      }
      for (const i of hint.wrongCells || []) g += `<polygon class="wrong" stroke-linejoin="round" points="${points(i, 0.92)}"/>`;
      for (const x of hint.wrongEdges || []) { const [x1, y1, x2, y2] = seg(x); g += `<line class="wrong-seg" stroke-width="${S * 0.2}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; }
    }
    const over = this.gesture ? -1 : this.hoverCell;
    if (over >= 0) {
      g += `<polygon class="hover" points="${points(over)}"/>`;
      for (const k of pointersAt(P, over)) g += `<polygon class="hover-pointer" stroke-linejoin="round" points="${points(P.clues[k].r * P.cols + P.clues[k].c, 0.92)}"/>`;
    }
    if (over >= 0 && deg[over] === 1) {
      const far = otherEnd(P, marks.edges, over);
      if (far >= 0) for (const i of [over, far]) { const [x, y] = ctr(i); g += `<circle class="line-end-halo" cx="${x}" cy="${y}" r="${S * 0.19}"/><circle class="line-end" cx="${x}" cy="${y}" r="${S * 0.19}"/>`; }
    }
    const hc = over >= 0 ? over % P.cols : -1, hr = over >= 0 ? (over / P.cols) | 0 : -1;
    for (let c = 0; c < P.cols; c++) g += `<text class="axis-label${c === hc ? ' here' : ''}" x="${this.hexCenter(0, c)[0]}" y="${PAD - 6}">${colName(c)}</text>`;
    for (let r = 0; r < P.rows; r++) g += `<text class="axis-label side${r === hr ? ' here' : ''}" x="${PAD - 6}" y="${this.hexCenter(r, 0)[1]}">${r + 1}</text>`;
    return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${W} ${H}" role="img"><g transform="translate(${OFF} ${OFF})">${g}</g></svg>`;
  }

  // ---- pointer decoding

  /** The hex cell under a point in board coordinates (SVG units, label offset already removed), or -1. */
  hexCellAt(px, py) {
    const P = this.P;
    let best = -1, bestD = Infinity;
    const r0 = Math.round((py - PAD - HR) / HROW);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(P.rows - 1, r0 + 1); r++) {
      const c = Math.min(P.cols - 1, Math.max(0, Math.round((px - PAD - S / 2 - (r & 1) * (S / 2)) / S)));
      const [x, y] = this.hexCenter(r, c), d = Math.hypot(px - x, py - y);
      if (d < bestD) { bestD = d; best = r * P.cols + c; }
    }
    return bestD <= HR ? best : -1;                       // (the hexagon fits inside a circle of its circumradius)
  }

  /** Do two cells touch (a step of the loop from one to the other)? */
  adjacent(a, b) {
    const P = this.P;
    if (!P.hex) return Math.abs(((a / P.cols) | 0) - ((b / P.cols) | 0)) + Math.abs((a % P.cols) - (b % P.cols)) === 1;
    for (let d = 0; d < 6; d++) { const [r, c] = hexStep((a / P.cols) | 0, a % P.cols, d); if (r * P.cols + c === b && c >= 0 && c < P.cols) return true; }
    return false;
  }

  cellAtPoint(clientX, clientY) {
    const svg = this.el.querySelector('svg');
    if (!svg || !this.P) return -1;
    const rect = svg.getBoundingClientRect();
    const OFF = this.offset;
    if (this.P.hex) {
      const { W, H } = this.size();
      return this.hexCellAt(((clientX - rect.left) / rect.width) * W - OFF, ((clientY - rect.top) / rect.height) * H - OFF);
    }
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
    this.gesture = { start: cell, last: cell, moved: false, steps: 0, x: e.clientX, y: e.clientY, mouse: e.pointerType === 'mouse' };
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
      if (this.adjacent(gs.last, cell)) { gs.moved = true; this.h.onStep(gs.last, cell, gs.steps++ === 0); }
      gs.last = cell;
    }
    gs.x = e.clientX; gs.y = e.clientY;
  }

  /**
   * Tapping (or clicking) an arrow tints its line and keeps it tinted (tap it again to clear it, tap another arrow to move it).
   * It stays while you mark cells in that line, which is the use of it, and goes when you tap a cell outside the line. Touch has no hover,
   * so this is all it has; a mouse also tints the line under the pointer, and the click keeps it once the pointer moves on.
   */
  pinArrow(gs) {
    if (!this.P) return;
    const k = this.P.clueAt[gs.start], P = this.P;
    const isArrow = k >= 0 && P.clues[k].n >= 0 && !P.clues[k].region;
    const was = this.pinned;
    if (isArrow) this.pinned = gs.start === was ? -1 : gs.start;
    else if (was >= 0 && !P.rays[P.clueAt[was]].includes(gs.start)) this.pinned = -1;
    if (this.pinned !== was && this.marks) this.render(this.marks, this.info, this.hint);
  }

  /** On-screen size of one cell in CSS pixels. */
  cellPixels() {
    const svg = this.el.querySelector('svg');
    if (!svg || !this.P) return S;
    return (svg.getBoundingClientRect().width / this.size().W) * S;
  }

  up() {
    const gs = this.gesture;
    if (!gs) return;
    this.gesture = null;
    if (!gs.moved) { this.pinArrow(gs); this.h.onTap(gs.start); }
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
