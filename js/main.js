// App controller: books and puzzle selection, marks, undo/redo, persistence, checks, settings.
import { rotated, turnMarks, realEdges } from './rotate.js';
import { parseSelection, planPrint, buildPrintRoot } from './print.js';
import { compile, parseCsv, puzzleHash, colName, solve, decodeSolution, checkSolved, initialState, E_ON, SHADED, LOOP, UNKNOWN } from './logic.js';
import { RULES } from './rating.js';
import { hexNextStep, describeHexStep } from './hexhint.js';
import { nextMarkableStep, reliesOn } from './hintstep.js';
import { explainStep, describeMarks, ROLES } from './explain.js';
import { Board, LABEL } from './board.js';
import { clueStates } from './clues.js';
import { nextMark, reconcile as reconcileDots, applyAutoDots } from './marks.js';
import { PRESETS, CUSTOM, MIN_CUSTOM, MAX_CUSTOM, sanitizeCustom, validId, lightColors, resolvePalette, eyesOf, alikeMatrix } from './palettes.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc.: progress just isn't saved */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const state = {
  books: [],        // [{ id, name, label, group, blurb, file | puzzles }]
  groups: [],       // [{ name, blurb, layout }]: the book picker's sections, in order
  loaded: new Map(),// book id -> its raw puzzles (for the solved counts in the picker)
  book: null,       // the loaded book: { id, name, puzzles: [compiled puzzle] }
  idx: 0,
  P: null,
  marks: null,      // { cells: Uint8Array, edges: Uint8Array }
  undo: [], redo: [],
  pending: null,    // snapshot at the start of the current gesture
  drawMode: 1,
  solved: false,
  hint: null,       // { sig, kind: 'wrong'|'stuck'|'step', visible, ... } for the Hint button
};

// Settings (all remembered in localStorage)
const savedCustom = (() => { try { return sanitizeCustom(JSON.parse(store.get('yj_pathCustom'))); } catch { return null; } })();
const settings = {
  colorLines: store.get('yj_colorLines') === '1', // color each separate path differently
  palette: validId(store.get('yj_pathPalette'), savedCustom), // ... with this palette: a preset's id, or 'custom' (js/palettes.js)
  custom: savedCustom,                                         // the player's own palette: a list of '#rrggbb' for the white board
  autoDots: store.get('yj_autoDots') === '1',     // automatic dots: next to a box, and along a satisfied clue
};

const board = new Board($('board'), {
  onStart: () => { state.pending = snapshot(); },
  onTap: (cell) => cycleCell(cell),
  onStep: (a, b, first) => dragStep(a, b, first),
  onEnd: (cancelled) => endGesture(cancelled),
  onRight: (cell) => toggleBox(cell),
});
const themeName = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
const pathColors = () => resolvePalette(settings.palette, settings.custom, themeName());
const paletteOptions = () => { const pathColorList = pathColors(); return { pathColors: pathColorList, pathAlike: alikeMatrix(pathColorList, eyesOf(settings.palette)) }; };
board.setOptions({ colorLines: settings.colorLines, ...paletteOptions() });

// ------------------------------------------------------------ marks

const snapshot = () => ({ cells: state.marks.cells.slice(), edges: state.marks.edges.slice(), auto: state.marks.auto.slice() });
const sameMarks = (a, b) => a.cells.every((v, i) => v === b.cells[i]) && a.edges.every((v, i) => v === b.edges[i]) && a.auto.every((v, i) => v === b.auto[i]);
const emptyMarks = (P) => {
  const m = { cells: new Uint8Array(P.N), edges: new Uint8Array(P.numEdges), auto: new Uint8Array(P.N) };
  for (const i of P.boxIdx) m.cells[i] = 1; // pre-placed boxes are always there
  return m;
};
const isBox = (i) => state.P.boxIdx.includes(i);

/** Nothing of the player's own on the board (automatic dots do not count). */
function isPristine(m) {
  const P = state.P;
  if (m.edges.some((v) => v)) return false;
  for (let i = 0; i < P.N; i++) {
    const want = P.boxIdx.includes(i) ? 1 : 0;
    if (m.cells[i] === want) continue;
    if (!(m.cells[i] === 2 && m.auto[i])) return false;
  }
  return true;
}

// ---- automatic dots: the rules live in js/marks.js (reasonsOf, reconcile, applyAutoDots); `settings.autoDots` says whether they are on.
const reconcile = (P, prev, cur) => reconcileDots(P, prev, cur, settings.autoDots);

/** The empty board (with automatic dots for reasons that exist from the start: pre-placed boxes, clues of 0). */
function freshMarks(P) {
  const m = emptyMarks(P);
  if (settings.autoDots) reconcile(P, null, m);
  return m;
}

/** Shade cell i: a shaded cell is not on the loop, so its segments go. (Automatic dots follow in reconcile.) */
function shade(i) {
  const m = state.marks;
  m.cells[i] = 1; m.auto[i] = 0;
  removeEdgesAt(i);
}

function cycleCell(i) {
  const P = state.P;
  if (P.clueAt[i] >= 0 || isBox(i)) return;
  const m = state.marks, before = state.pending || snapshot();
  // empty -> dot -> box -> empty; a cell a segment passes through is already on the loop, so it goes straight to a box (see js/marks.js)
  let lined = false;
  for (let d = 0; d < P.K; d++) { const x = P.ed[i * P.K + d]; if (x >= 0 && m.edges[x]) lined = true; }
  const next = nextMark(m.cells[i], lined);
  if (next === 1) shade(i); else { m.cells[i] = next; m.auto[i] = 0; }
  reconcile(P, before, m);
  refresh();
}

/** Right-click: put a box on the cell, or take it off again. */
function toggleBox(i) {
  const P = state.P;
  if (P.clueAt[i] >= 0 || isBox(i)) return;
  const m = state.marks, before = state.pending || snapshot();
  if (m.cells[i] === 1) { m.cells[i] = 0; m.auto[i] = 0; } else shade(i);
  reconcile(P, before, m);
  refresh();
}

function removeEdgesAt(i) {
  const P = state.P;
  for (let d = 0; d < P.K; d++) { const x = P.ed[i * P.K + d]; if (x >= 0) state.marks.edges[x] = 0; }
}

function dragStep(a, b, first) {
  const P = state.P, m = state.marks;
  let x = -1;
  for (let d = 0; d < P.K; d++) if (P.nb[a * P.K + d] === b) x = P.ed[a * P.K + d];
  if (x < 0 || m.cells[a] === 1 || m.cells[b] === 1) return; // clue cells and shaded cells carry no loop
  if (first) state.drawMode = m.edges[x] ? 0 : 1;
  m.edges[x] = state.drawMode;
  refresh();
}

function endGesture(cancelled) {
  const before = state.pending;
  state.pending = null;
  if (!before) return;
  if (cancelled) { state.marks = before; refresh(); return; }
  if (!sameMarks(before, state.marks)) {
    state.undo.push(before);
    state.redo = [];
    save();
  }
  updateButtons();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  state.marks = state.undo.pop();
  save(); refresh();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  state.marks = state.redo.pop();
  save(); refresh();
}
function reset() {
  if (isPristine(state.marks)) return;
  state.undo.push(snapshot()); state.redo = [];
  state.marks = freshMarks(state.P);
  save(); refresh();
}

// ------------------------------------------------------------ analysis for drawing

function analyse() {
  const P = state.P, m = state.marks;
  const clueState = clueStates(P, m);
  const badShaded = new Set();
  for (let i = 0; i < P.N; i++) {
    if (m.cells[i] !== 1) continue;
    for (let d = 0; d < P.K; d++) { const j = P.nb[i * P.K + d]; if (j >= 0 && m.cells[j] === 1) { badShaded.add(i); badShaded.add(j); } }
  }
  return { clueState, badShaded };
}

function isSolved() {
  const m = state.marks;
  const shaded = Uint8Array.from(m.cells, (v) => (v === 1 ? 1 : 0));
  return checkSolved(state.P, shaded, m.edges);
}

/** Size the board so a cell is comfortable on big puzzles too: up to 46px, down to 26px, widening the page if needed. */
function fitBoard() {
  const P = state.P;
  if (!P) return;
  const off = LABEL;
  const avail = Math.min(window.innerWidth - 24, 1500);
  const px = Math.max(26, Math.min(46, Math.floor(avail / (P.cols + 0.5))));
  const width = Math.round((board.size().W * px) / 44);
  $('board').style.width = `${width}px`;
  $('game-container').style.maxWidth = `${Math.max(640, width + 24)}px`;
}
window.addEventListener('resize', fitBoard);

function refresh() {
  state.hint = null; hideHintToast(); // any change to the board clears the hint
  board.render(state.marks, analyse());
  const solved = isSolved();
  if (solved && !state.solved) markSolved();
  state.solved = solved;
  $('board').classList.toggle('solved', solved);
  $('status').textContent = solved ? 'Solved!' : '';
  $('status').classList.toggle('solved', solved);
  updateButtons();
}

function updateButtons() {
  $('undo-btn').disabled = !state.undo.length;
  $('redo-btn').disabled = !state.redo.length;
  $('reset-btn').disabled = isPristine(state.marks);
}

// ------------------------------------------------------------ persistence

const saveKey = (P) => `yj_save_${puzzleHash(P)}`;

// progress is stored in the puzzle's ORIGINAL orientation, whichever way the board is shown (js/rotate.js)
function save() {
  const P = state.P;
  const m = P.rotated ? turnMarks(state.marks, state.orig.rows, state.orig.cols, false) : state.marks;
  if (isPristine(state.marks)) { store.del(saveKey(P)); return; }
  store.set(saveKey(P), JSON.stringify({ c: Array.from(m.cells).join(''), e: Array.from(m.edges).join(''), a: Array.from(m.auto).join('') }));
}

function load(P) {
  let m = null;
  const O = P.rotated ? state.orig : P;       // the saved marks are in the original's orientation
  try {
    const s = JSON.parse(store.get(saveKey(P)) || 'null');
    if (s && s.c.length === O.N && s.e.length === O.numEdges) {
      m = emptyMarks(O);
      for (let i = 0; i < O.N; i++) m.cells[i] = +s.c[i];
      const real = O.hex ? Array.from(O.edgeA, (a) => a >= 0) : realEdges(O.rows, O.cols);       // saves written by an older build may hold segments on slots that are no edge (a turning bug): drop them
      for (let i = 0; i < O.numEdges; i++) m.edges[i] = real[i] ? +s.e[i] : 0;
      if (s.a && s.a.length === O.N) for (let i = 0; i < O.N; i++) m.auto[i] = +s.a[i];
      if (P.rotated) m = turnMarks(m, O.rows, O.cols, true);
    }
  } catch { m = null; /* corrupt save: start fresh */ }
  if (!m) return freshMarks(P);
  for (const i of P.boxIdx) m.cells[i] = 1;
  if (!settings.autoDots) applyAutoDots(P, m, false);      // a save made with automatic dots on shows none while they are off
  return m;
}

const solvedSet = () => { try { return new Set(JSON.parse(store.get('yj_solved') || '[]')); } catch { return new Set(); } };
function markSolved() {
  const s = solvedSet(); s.add(puzzleHash(state.P));
  store.set('yj_solved', JSON.stringify([...s]));
  recordBookSolved();
}

// How many puzzles of each book are solved, remembered per book so the book picker can show it without loading every book (a book's
// puzzles are fetched only when it is opened; the count is refreshed then and whenever a puzzle is solved).
const bookSolved = () => { try { return JSON.parse(store.get('yj_book_solved') || '{}'); } catch { return {}; } };
function recordBookSolved() {
  if (!state.book) return;
  const solved = solvedSet();
  const all = bookSolved();
  all[state.book.id] = state.book.puzzles.filter((p) => solved.has(puzzleHash(p))).length;
  store.set('yj_book_solved', JSON.stringify(all));
}

// ------------------------------------------------------------ check / toast

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.classList.remove('hint', 'below', 'ghost');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
// A message that sits in the page under the board keeps its space when it goes away (invisible, not removed): taking it out would shorten the page,
// the board would jump under the pointer, and the click that dismissed it would land on the wrong cell.
function retireToast(t) {
  if (t.classList.contains('below') && !t.hidden) { t.classList.add('ghost'); } else t.hidden = true;
}
function hideHintToast() { const t = $('toast'); if (t.classList.contains('hint')) retireToast(t); }
function dropToast() { const t = $('toast'); t.hidden = true; t.classList.remove('hint', 'below', 'ghost'); }   // no message and no reserved space (a new puzzle)
function dismissToast() {
  const t = $('toast');
  if (t.hidden || t.classList.contains('ghost')) return;
  retireToast(t);
  if (state.hint && state.hint.visible) { state.hint.visible = false; board.render(state.marks, analyse()); } // dismissed: keep our place in the cycle
}
// a click anywhere dismisses a message (the Hint button itself is exempt: pressing it again shows the next step)
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#hint-btn')) dismissToast(); }, true);

function solutionOf(P) {
  if (!P._sol) {
    if (P.solution) P._sol = decodeSolution(P, P.solution);
    else { const r = solve(P, { limit: 1 }); P._sol = r.solutions[0] || null; }
  }
  return P._sol;
}

function checkSoFar() {
  const P = state.P, m = state.marks, sol = solutionOf(P);
  if (!sol) { toast('This puzzle has no solution on file.'); return; }
  let wrong = 0, marked = 0;
  for (let i = 0; i < P.N; i++) {
    if (m.cells[i] === 1) { marked++; if (sol.cell[i] !== SHADED) wrong++; }
    else if (m.cells[i] === 2) { marked++; if (sol.cell[i] !== LOOP) wrong++; }
  }
  for (let x = 0; x < P.numEdges; x++) if (m.edges[x]) { marked++; if (sol.e[x] !== E_ON) wrong++; }
  toast(wrong ? `${wrong} mark${wrong === 1 ? ' is' : 's are'} incorrect.` : marked ? 'So far so good!' : 'Nothing marked yet.');
}


// ------------------------------------------------------------ hint: show how the draft solver thinks

const signature = () => `${Array.from(state.marks.cells).join('')}|${Array.from(state.marks.edges).join('')}`;

/** The player's marks as a position for the solver: shaded = shaded, dot = loop, segment = on. */
function solverState() {
  const P = state.P, m = state.marks, st = initialState(P);
  for (let i = 0; i < P.N; i++) {
    if (P.clueAt[i] >= 0) continue;
    if (m.cells[i] === 1) st.cell[i] = SHADED; else if (m.cells[i] === 2) st.cell[i] = LOOP;
  }
  for (let x = 0; x < P.numEdges; x++) if (m.edges[x]) st.e[x] = E_ON;
  return st;
}

function hint() {
  const P = state.P, m = state.marks;
  if (state.solved) { toast('Already solved!'); return; }
  const sig = signature();
  const h = state.hint;
  if (h && h.sig === sig) {
    if (h.visible && h.kind === 'step') h.idx = (h.idx + 1) % h.res.firings.length; // pressing again: the next step of the same rule
    h.visible = true;
  } else {
    const sol = solutionOf(P);
    const wrongCells = [], wrongEdges = [];
    if (sol) {
      for (let i = 0; i < P.N; i++) {
        if ((m.cells[i] === 1 && sol.cell[i] !== SHADED) || (m.cells[i] === 2 && sol.cell[i] !== LOOP)) wrongCells.push(i);
      }
      for (let x = 0; x < P.numEdges; x++) if (m.edges[x] && sol.e[x] !== E_ON) wrongEdges.push(x);
    }
    if (wrongCells.length || wrongEdges.length) {
      state.hint = { sig, kind: 'wrong', visible: true, wrongCells, wrongEdges };
    } else {
      const st = solverState();
      const t0 = performance.now();
      if (P.hex) {                                 // hex boards: the machine's own reasoning (js/hexhint.js), not the square rules
        const step = hexNextStep(P, st), ms = Math.round(performance.now() - t0);
        if (step) state.hint = { sig, kind: 'hexstep', visible: true, step, ms };
        else {
          const undecided = [];
          for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) undecided.push(i);
          state.hint = { sig, kind: 'stuck', visible: true, undecided, ms };
        }
        showHint();
        return;
      }
      const next = nextMarkableStep(P, st);       // skips steps that only rule a segment out (nothing to mark); see js/hintstep.js
      const res = next && next.res;
      const ms = Math.round(performance.now() - t0);
      if (!res) {
        const undecided = [];
        for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) undecided.push(i);
        state.hint = { sig, kind: 'stuck', visible: true, undecided, ms };
      } else {
        state.hint = { sig, kind: 'step', visible: true, res, idx: 0, ms, st, background: next.background };
      }
    }
  }
  showHint();
}

function showHint() {
  const h = state.hint, P = state.P;
  const t = $('toast');
  clearTimeout(toastTimer);
  t.classList.remove('ghost');
  t.classList.add('hint');
  t.replaceChildren();
  const line = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; t.appendChild(d); };
  const legend = (roles, chain = []) => {
    const used = Object.keys(ROLES).filter((r) => (roles[r] || []).length);
    if (!used.length && !chain.length) return;
    const d = document.createElement('div');
    d.className = 'hint-legend';
    for (const r of used) {
      const span = document.createElement('span');
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.background = r === 'problem' ? 'repeating-linear-gradient(45deg, var(--hint-problem) 0 2px, transparent 2px 4px)' : r === 'exit' ? 'transparent' : `var(--hint-${r === 'focus' ? 'focus' : r})`;
      if (r === 'exit') chip.style.border = '2px dashed var(--hint-exit)';
      span.append(chip, ROLES[r]);
      d.appendChild(span);
    }
    if (chain.length) {     // the lines the imagined box would force (drawn dashed in the problem colour)
      const span = document.createElement('span'), chip = document.createElement('span');
      chip.className = 'chip'; chip.style.background = 'transparent'; chip.style.border = '2px dashed var(--hint-problem)';
      span.append(chip, 'the lines the box would force');
      d.appendChild(span);
    }
    t.appendChild(d);
  };
  let overlay = null;
  if (h.kind === 'wrong') {
    overlay = { wrongCells: h.wrongCells, wrongEdges: h.wrongEdges };
    const n = h.wrongCells.length + h.wrongEdges.length;
    line('hint-meta', 'mistake');
    line('', `${n} mark${n === 1 ? ' is' : 's are'} incorrect (shown in red). Fix them before asking for a step.`);
  } else if (h.kind === 'hexstep') {
    const s = h.step, name = (i) => `${colName(i % P.cols)}${((i / P.cols) | 0) + 1}`;
    overlay = { roles: { focus: s.focus, clue: s.clue || [], range: s.range || [] }, shaded: s.shaded, loop: s.loop, segOn: s.segOn, chain: s.chain };
    line('hint-meta', `${s.kind === 'rule' ? s.rule : s.kind} · ${h.ms} ms`);
    line('', describeHexStep(s, name));
  } else if (h.kind === 'stuck') {
    overlay = { undecided: h.undecided };
    line('hint-meta', P.hex ? `stuck · ${h.ms} ms` : `stuck · ${RULES.filter((r) => !r.free).length} rules tried · ${h.ms} ms`);
    line('', `The draft solver is stuck: none of its rules finds a next step from here. The tinted cells are the ${h.undecided.length} it still cannot decide.`);
    line('hint-more', 'This is a place to look for an inference the solver is missing.');
  } else {
    const f = h.res.firings[h.idx];
    const e = explainStep(P, { rule: h.res.rule, tier: h.res.tier, weight: h.res.weight, sets: f.sets, info: f.info }, h.st);
    overlay = { roles: e.roles, shaded: e.targets.shaded, loop: e.targets.loop, segOn: e.targets.segOn, segOff: e.targets.segOff, chain: e.chain };
    line('hint-meta', `${e.rule} · ${e.tier} · weight ${e.weight} · ${h.ms} ms`);
    line('', e.text);
    line('hint-marks', describeMarks(e.targets));
    if (h.background && h.background.length) {     // the skipped "no segment here" facts this step needs (not the ones merely passed on the way): see reliesOn
      const used = reliesOn(P, h.st, h.res.rule, f, h.background), shown = used.slice(-2);
      if (shown.length) line('hint-more', `Relies on: ${shown.map((b) => b.text).join(' ')}${used.length > shown.length ? ` (and ${used.length - shown.length} more)` : ''}`);
    }
    legend(e.roles, e.chain);
    if (h.res.firings.length > 1) line('hint-more', `${h.idx + 1} of ${h.res.firings.length} steps of this rule; press Hint for the next.`);
  }
  t.hidden = false;
  // sit at the bottom of the window unless that would cover the board: then it goes in the page, just under the board (scrolled into view)
  t.classList.remove('below');
  const b = $('board').getBoundingClientRect(), tr = t.getBoundingClientRect();
  if (tr.top < b.bottom && tr.bottom > b.top) {
    t.classList.add('below');
    const r = t.getBoundingClientRect();
    if (r.bottom > innerHeight) t.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }
  board.render(state.marks, analyse(), overlay);
}

// ------------------------------------------------------------ books and puzzles

async function fetchBook(entry) {
  if (entry.puzzles) return entry.puzzles;
  if (state.loaded.has(entry.id)) return state.loaded.get(entry.id);
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error(`${entry.file}: ${res.status}`);
  const raw = parseCsv(await res.text());
  state.loaded.set(entry.id, raw);
  return raw;
}

async function openBook(id, idx = 0) {
  const entry = state.books.find((b) => b.id === id) || state.books[0];
  if (!entry) { $('puz-info').textContent = 'No puzzle books found.'; return; }
  const raw = await fetchBook(entry);
  state.book = { id: entry.id, name: entry.name, puzzles: raw.map(compile) };
  recordBookSolved();
  syncBookButton();
  $('puz-total').textContent = state.book.puzzles.length;
  $('puz-num').max = state.book.puzzles.length;
  openPuzzle(Math.min(Math.max(idx, 0), state.book.puzzles.length - 1));
}

function openPuzzle(idx) {
  const book = state.book;
  if (!book || !book.puzzles.length) return;
  state.idx = idx;
  state.flip = false;
  const orig = state.orig = book.puzzles[idx];
  const P = state.P = shownPuzzle(orig);
  state.marks = load(P);
  state.undo = []; state.redo = [];
  state.solved = false;
  board.setPuzzle(P);
  fitBoard();
  $('puz-num').value = idx + 1;
  $('prev-puz').disabled = idx === 0;
  $('next-puz').disabled = idx === book.puzzles.length - 1;
  showInfo();
  store.set('yj_last', JSON.stringify({ book: book.id, idx }));
  const url = new URL(location.href);
  url.searchParams.set('book', book.id); url.searchParams.set('puzzle', idx + 1);
  history.replaceState(null, '', url);
  refresh();
  state.solved = isSolved(); // opening an already-solved save should not count as a fresh solve
}

function showInfo() {
  const P = state.P, tier = P.tier ? ` · ${P.tier}` : '';
  $('puz-info').textContent = `${P.name} · ${P.cols}×${P.rows}${tier}`;
  $('rotate-btn').hidden = !state.orig || state.orig.hex || state.orig.rows === state.orig.cols && !state.flip;   // a square board looks the same turned (a hex board is never turned)
}

/** How big a cell could be if a rows x cols board had the window to itself (the width AND the height count). */
function cellFit(rows, cols) {
  const off = LABEL;
  const w = Math.min(window.innerWidth - 24, 1500) - off, h = window.innerHeight - 230;
  return Math.min(46, w / (cols + 0.5), h / (rows + 0.5));
}
/** The puzzle as it is shown: a quarter turn if that gives bigger cells, flipped by the Rotate button. */
function shownPuzzle(orig) {
  if (orig.hex) return orig;
  const sideways = orig.rows !== orig.cols && cellFit(orig.cols, orig.rows) > cellFit(orig.rows, orig.cols) * 1.1;
  return sideways !== !!state.flip ? rotated(orig, puzzleHash(orig)) : orig;
}
/** Show the current puzzle the other way up (or back), keeping the marks and the undo history. */
function reorient() {
  if (!state.orig) return;
  const P = shownPuzzle(state.orig);
  if (P === state.P) return;
  const turn = (m) => turnMarks(m, state.orig.rows, state.orig.cols, P.rotated);   // from the old orientation to the new
  const back = (m) => (state.P.rotated ? turnMarks(m, state.orig.rows, state.orig.cols, false) : m);
  const conv = (m) => { const o = back(m); return P.rotated ? turn(o) : o; };
  state.marks = conv(state.marks);
  state.undo = state.undo.map(conv); state.redo = state.redo.map(conv);
  state.P = P; state.hint = null; dropToast();
  board.setPuzzle(P);
  fitBoard();
  showInfo();
  refresh();
}
let resizeTimer = 0;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(reorient, 200); });

// A CSV the player loaded from disk is remembered (the latest one), so a reload, or a link with ?book=file:name.csv, finds it again.
function rememberFileBook(name, text) { store.set('yj_file_book', JSON.stringify({ name, text })); }
function restoreFileBook() {
  try {
    const f = JSON.parse(store.get('yj_file_book') || 'null');
    const puzzles = f && parseCsv(f.text);
    if (puzzles && puzzles.length) state.books.push({ id: `file:${f.name}`, name: f.name, puzzles });
  } catch { /* unreadable: forget it */ }
}

async function init() {
  let manifest = { books: [] };
  try { manifest = await (await fetch('data/manifest.json')).json(); } catch { /* none yet */ }
  state.books = manifest.books || [];
  state.groups = manifest.groups || [];
  restoreFileBook();
  if (!state.books.length) { $('puz-info').textContent = 'No puzzle books yet. Load a CSV in Settings.'; return; }
  const params = new URLSearchParams(location.search);
  let last = null;
  try { last = JSON.parse(store.get('yj_last') || 'null'); } catch { /* ignore */ }
  let bookId = params.get('book') || (last && last.book) || manifest.default || state.books[0].id;
  const known = state.books.some((b) => b.id === bookId);
  if (!known) bookId = manifest.default || state.books[0].id;      // a remembered or linked book that no longer exists: start at the default
  const idx = !known ? 0 : params.has('puzzle') ? +params.get('puzzle') - 1 : (last && last.book === bookId ? last.idx : 0);
  await openBook(bookId, Number.isFinite(idx) ? idx : 0);
}

// ------------------------------------------------------------ wiring

// the arrows (and the arrow keys) stop at either end of the book rather than wrapping round
const step = (d) => { if (!state.book) return; const j = state.idx + d; if (j >= 0 && j < state.book.puzzles.length) openPuzzle(j); };
$('prev-puz').addEventListener('click', () => step(-1));
$('next-puz').addEventListener('click', () => step(1));
$('puz-num').addEventListener('change', (e) => { if (state.book) openPuzzle(Math.min(Math.max((+e.target.value || 1) - 1, 0), state.book.puzzles.length - 1)); });
$('undo-btn').addEventListener('click', undo);
$('redo-btn').addEventListener('click', redo);
$('reset-btn').addEventListener('click', reset);
$('check-btn').addEventListener('click', checkSoFar);
$('hint-btn').addEventListener('click', hint);
// --- Modals (settings, help): same overlay pattern as polyomino-panel
const modals = [];
function setupModal(modalId, openBtnId, onOpen) {
  const modal = $(modalId), openBtn = $(openBtnId);
  const close = () => { modal.classList.add('modal-hidden'); openBtn.focus(); };
  const open = () => { onOpen?.(); modal.classList.remove('modal-hidden'); modal.querySelector('[data-close]').focus(); };
  openBtn.addEventListener('click', open);
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modals.push({ modal, close });
  return { open, close };
}
const modalOpen = () => modals.some(({ modal }) => !modal.classList.contains('modal-hidden'));

// --- Puzzle selector (Browse): a grid of tiles for the current book that augments the prev/next arrows and the number box
// (the same idea as polyomino-panel's Browse). A tile is solved, in progress (the saved game is not pristine) or not started.
const hasSave = (P) => store.get(saveKey(P)) !== null;
function renderBrowse() {
  const book = state.book;
  if (!book) return;
  const solved = solvedSet();
  const isDone = (P) => solved.has(puzzleHash(P));
  const grid = $('browse-grid');
  grid.textContent = '';
  const doneCount = book.puzzles.filter(isDone).length;
  $('browse-summary').textContent = `${book.name}: ${doneCount} of ${book.puzzles.length} solved`;
  // Headings only where they help: tiers if the book runs through them in order, otherwise board sizes if it runs through those in order.
  const TIER_ORDER = ['Beginner', 'Medium', 'Hard', 'Expert'];
  const inOrder = (vals) => new Set(vals).size > 1 && vals.every((v, i) => i === 0 || v >= vals[i - 1]);
  const byTier = book.puzzles.every((P) => P.tier) && inOrder(book.puzzles.map((P) => TIER_ORDER.indexOf(P.tier)));
  const bySize = !byTier && inOrder(book.puzzles.map((P) => P.rows * P.cols));
  const section = (P) => (byTier ? P.tier : bySize ? `${P.cols}×${P.rows}` : null);
  let current = null;
  book.puzzles.forEach((P, i) => {
    const sec = section(P);
    if (sec && sec !== current) {
      current = sec;
      const head = document.createElement('div');
      head.className = 'browse-section-header';
      head.innerHTML = '<span class="browse-section-name"></span>';
      head.firstChild.textContent = sec;
      grid.append(head);
    }
    const done = isDone(P), started = !done && hasSave(P);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'browse-tile' + (done ? ' bt-solved' : started ? ' bt-in-progress' : '') + (i === state.idx ? ' bt-current' : '');
    b.textContent = i + 1;
    const what = `${P.name} · ${P.cols}×${P.rows}${P.tier ? ' · ' + P.tier : ''}`;
    b.title = what;
    b.setAttribute('aria-label', `Puzzle ${i + 1}, ${what}${done ? ' (solved)' : started ? ' (in progress)' : ''}`);
    b.addEventListener('click', () => { browseModal.close(); openPuzzle(i); });
    grid.append(b);
  });
  requestAnimationFrame(() => grid.querySelector('.bt-current')?.scrollIntoView({ block: 'nearest' }));   // the modal is shown right after this runs
}

const clearBtn = $('clear-saves-btn');
const disarmClear = () => { clearBtn.classList.remove('danger-btn--confirm'); clearBtn.textContent = 'Clear saves'; };
const settingsModal = setupModal('settings-modal', 'settings-btn', () => {
  $('setting-dark-mode').checked = document.documentElement.dataset.theme === 'dark';
  disarmClear();
});
const helpModal = setupModal('help-modal', 'help-btn');
// the very first visit opens the rules, then remembers it was seen (like polyomino-panel and star battle)
if (!store.get('yj_seenHelp')) { store.set('yj_seenHelp', '1'); helpModal.open(); }

// --- Print puzzles (Settings -> Print puzzles): pick a range of the current book, build a print-only page (js/print.js) and open the
// browser's print dialog ("Save as PDF" there). The booklet styles apply only while a booklet is being printed, so Ctrl+P on the
// game still prints the page as usual.
const endBookletPrint = () => document.body.classList.remove('printing-booklet');
window.addEventListener('afterprint', endBookletPrint);
matchMedia('print').addEventListener?.('change', (e) => { if (!e.matches) endBookletPrint(); });   // iOS skips afterprint
const printSolution = (P) => (P.solution ? solutionOf(P) : null);       // only stored solutions: solving a whole book here would freeze the page
function setupPrint() {
  const sel = $('print-selection'), sizeSel = $('print-size'), keyBox = $('print-answer-key');
  const err = $('print-error'), summary = $('print-summary'), go = $('print-go-btn');
  const savedSize = store.get('yj_printSize');
  if ([...sizeSel.options].some((o) => o.value === savedSize)) sizeSel.value = savedSize;
  keyBox.checked = store.get('yj_printKey') !== '0';
  const update = () => {
    const puzzles = state.book ? state.book.puzzles : [];
    const { ids, error } = parseSelection(sel.value, puzzles.length);
    err.hidden = !error; err.textContent = error ?? ''; go.disabled = Boolean(error);
    if (error) { summary.textContent = ''; return null; }
    const size = sizeSel.value;
    const keyIds = keyBox.checked ? ids.filter((id) => printSolution(puzzles[id - 1])) : [];
    const plan = planPrint({ puzzles, ids, keyIds, size });
    const pages = (n) => `${n} page${n === 1 ? '' : 's'}`;
    summary.textContent = `${ids.length} puzzle${ids.length === 1 ? '' : 's'}, ${plan.perPage} per page: ${pages(plan.puzzlePages)}`
      + (plan.keyPages ? ` + ${pages(plan.keyPages)} of answers (${plan.keyPerPage} per page).` : '.');
    return { ids, puzzles, size };
  };
  setupModal('print-modal', 'print-btn', () => {
    settingsModal.close();
    const total = state.book ? state.book.puzzles.length : 0;
    $('print-book-name').textContent = state.book ? state.book.name : '';
    $('print-book-total').textContent = total;
    sel.value = total <= 1 ? '1' : `${state.idx + 1}-${Math.min(total, state.idx + 10)}`;      // ten puzzles from the one you are on
    update();
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => { sel.focus(); sel.select(); }, 0);   // not on a phone: it would pop the keyboard up
  });
  sel.addEventListener('input', update);
  sizeSel.addEventListener('change', () => { store.set('yj_printSize', sizeSel.value); update(); });
  keyBox.addEventListener('change', () => { store.set('yj_printKey', keyBox.checked ? '1' : '0'); update(); });
  go.addEventListener('click', () => {
    const r = update();
    if (!r) return;
    buildPrintRoot({ book: { title: state.book.name }, puzzles: r.puzzles, ids: r.ids, size: r.size, includeKey: keyBox.checked, solutionOf: printSolution });
    document.body.classList.add('printing-booklet');      // style.css prints only the booklet while this is set
    window.print();
  });
}
setupPrint();

// --- Book picker: a button showing the current book opens a modal to choose one from, with what each holds and how many of its puzzles are
// solved (the same idea as polyomino-panel's and Star Battle's). Books and groups come from data/manifest.json.
function syncBookButton() {
  const btn = $('book-btn');
  btn.textContent = '';
  const name = document.createElement('span');
  name.className = 'book-btn-name';
  const entry = state.books.find((b) => state.book && b.id === state.book.id);
  name.textContent = entry ? entry.label || entry.name : 'Choose a book';
  btn.append(name);
}

// The picker is two or three screens deep, like the Star Battle one: cards for the manifest's groups; a group with books in more than one
// sub-category ("sub" on the book, described by the group's "subs") shows a card per sub-category; and the last screen lists the books. A
// group or sub-category with a single book opens it straight away. Books and groups come from data/manifest.json:
//   groups: [{ name, icon, blurb, subs: { "Sub name": { icon, blurb } } }]    books: [{ ..., group, sub }]
function renderBookPicker(view = {}) {
  const body = $('bp-body');
  body.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  // the manifest's groups in order, then any group a book names that the manifest does not list (a file loaded from disk, say)
  const groups = [...state.groups];
  const listed = state.books.filter((b) => !b.hidden);      // a hidden book (the armory of docs/how_to_solve.md) opens from a link, not from here
  for (const b of listed) { const g = b.group || 'Your files'; if (!groups.some((x) => x.name === g)) groups.push({ name: g, icon: '📂' }); }
  const booksOf = (g) => listed.filter((b) => (b.group || 'Your files') === g.name);
  const isCurrent = (b) => !!state.book && b.id === state.book.id;
  const countText = (b) => {
    const total = b.count ?? (b.puzzles ? b.puzzles.length : null), done = bookSolved()[b.id] || 0;
    return { text: total === null ? '' : done ? `${done} / ${total} solved` : `${total} puzzles`, done: total !== null && done > 0 && done === total };
  };
  const pick = (b) => { bookModal.close(); if (!isCurrent(b)) openBook(b.id, 0); };
  const show = (v) => renderBookPicker(v);

  // a card for a group or sub-category: icon, name, blurb and a line saying what is inside
  const card = (icon, name, blurb, meta, current, onClick) => {
    const node = el('button', 'bp-card' + (current ? ' bp-current' : ''));
    node.type = 'button';
    if (current) node.setAttribute('aria-current', 'true');
    node.append(el('span', 'bp-card-icon', icon || '📖'), el('span', 'bp-card-name', name));
    if (blurb) node.append(el('span', 'bp-card-blurb', blurb));
    if (meta) node.append(el('span', 'bp-card-meta', meta));
    node.addEventListener('click', onClick);
    return node;
  };
  const header = (title, blurb, backLabel, onBack) => {
    if (onBack) { const back = el('button', 'bp-back', backLabel); back.type = 'button'; back.addEventListener('click', onBack); body.append(back); }
    body.append(el('h3', 'bp-title', title));
    if (blurb) body.append(el('p', 'bp-blurb', blurb));
  };
  const bookList = (books) => {
    const list = el('div', 'bp-list');
    for (const b of books) {
      const node = el('button', 'bp-book' + (isCurrent(b) ? ' bp-current' : ''));
      node.type = 'button';
      if (isCurrent(b)) node.setAttribute('aria-current', 'true');
      const text = el('span', 'bp-book-text');
      text.append(el('span', 'bp-book-title', b.label || b.name));
      if (b.blurb) text.append(el('span', 'bp-book-blurb', b.blurb));
      const c = countText(b), count = el('span', 'bp-count', c.text);
      count.classList.toggle('bp-count-done', c.done);
      node.append(text, count);
      node.addEventListener('click', () => pick(b));
      list.append(node);
      // a book of unknown size (no manifest count: a file loaded from disk) is fetched to be counted; the others show their manifest count
      // and the solved count remembered for them (see recordBookSolved), so opening the picker never loads a thousand-puzzle file
      if (b.count === undefined && !b.puzzles) {
        const solved = solvedSet();
        fetchBook(b).then((raw) => {
          const n = raw.filter((p) => solved.has(puzzleHash(p))).length;
          count.textContent = n ? `${n} / ${raw.length} solved` : `${raw.length} puzzles`;
        }).catch(() => { /* the count stays as it was */ });
      }
    }
    body.append(list);
    requestAnimationFrame(() => body.querySelector('.bp-current')?.scrollIntoView({ block: 'center' }));
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const group = view.group && groups.find((g) => g.name === view.group);
  if (!group) {                                                        // screen 1: the groups
    const grid = el('div', 'bp-cards');
    for (const g of groups) {
      const books = booksOf(g);
      if (!books.length) continue;
      const only = books.length === 1 ? books[0] : null;               // a lone book opens straight away
      grid.append(card(g.icon, g.name, g.blurb || (only && only.blurb), only ? countText(only).text : plural(books.length, 'book'),
        books.some(isCurrent), () => (only ? pick(only) : show({ group: g.name }))));
    }
    body.append(grid);
    return;
  }
  const books = booksOf(group);
  const subs = [...new Set(books.map((b) => b.sub).filter(Boolean))];
  const hasOther = subs.length > 0 && books.some((b) => !b.sub);
  if (subs.length < 2 && !(subs.length && hasOther)) {                 // screen 2 is the book list
    header(group.name, group.blurb, '← All books', () => show({}));
    bookList(books);
    return;
  }
  const subName = view.sub === null ? 'Other' : view.sub;
  if (view.sub !== undefined && (view.sub === null ? hasOther : subs.includes(view.sub))) {      // screen 3: one sub-category's books
    header(`${group.name} · ${subName}`, group.subs?.[view.sub]?.blurb, `← ${group.name}`, () => show({ group: group.name }));
    bookList(books.filter((b) => (view.sub === null ? !b.sub : b.sub === view.sub)));
    return;
  }
  header(group.name, group.blurb, '← All books', () => show({}));      // screen 2: the group's sub-categories
  const grid = el('div', 'bp-cards');
  for (const s of hasOther ? [...subs, null] : subs) {
    const inSub = books.filter((b) => (s === null ? !b.sub : b.sub === s));
    const info = (s !== null && group.subs?.[s]) || {};
    const only = inSub.length === 1 ? inSub[0] : null;
    grid.append(card(info.icon || group.icon, s === null ? 'Other' : s, info.blurb || (only && only.blurb), only ? countText(only).text : plural(inSub.length, 'book'),
      inSub.some(isCurrent), () => (only ? pick(only) : show({ group: group.name, sub: s }))));
  }
  body.append(grid);
}
const bookModal = setupModal('book-modal', 'book-btn', renderBookPicker);
const browseModal = setupModal('browse-modal', 'browse-btn', renderBrowse);
$('browse-jump-btn').addEventListener('click', () => {
  const solved = solvedSet();
  const next = state.book && state.book.puzzles.findIndex((P) => !solved.has(puzzleHash(P)));
  browseModal.close();
  if (next >= 0) openPuzzle(next); else toast('You have solved every puzzle in this book!');
});

$('setting-dark-mode').addEventListener('change', (e) => {
  document.documentElement.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
  store.set('yj_dark', e.target.checked ? '1' : '0');
  board.setOptions(paletteOptions());
  renderPaletteUI();
});
$('rotate-btn').addEventListener('click', () => { state.flip = !state.flip; reorient(); });
for (const [id, key, store_key] of [['setting-color-lines', 'colorLines', 'yj_colorLines'], ['setting-auto-dots', 'autoDots', 'yj_autoDots']]) {
  const el = $(id);
  el.checked = settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    store.set(store_key, el.checked ? '1' : '0');
    board.setOptions({ colorLines: settings.colorLines });
    if (key === 'colorLines') renderPaletteUI();
    fitBoard();
    if (key === 'autoDots' && state.P) {      // on: dots for everything already on the board; off: the automatic ones go (yours stay)
      const before = snapshot();
      applyAutoDots(state.P, state.marks, settings.autoDots);
      // not an undo step of its own; the history is brought in line instead, so Undo never brings back dots the switch has turned off
      for (const m of [...state.undo, ...state.redo]) applyAutoDots(state.P, m, settings.autoDots);
      if (!sameMarks(before, state.marks)) { save(); refresh(); }
    }
  });
}
// ---- line colors: a preset palette, or one the player builds (the strip under "Color separate lines" in the settings)
function renderPaletteUI() {
  const custom = settings.palette === CUSTOM;
  $('palette-group').hidden = !settings.colorLines;
  $('setting-palette').value = settings.palette;
  $('palette-desc').textContent = custom ? 'Colors you pick yourself' : PRESETS.find((p) => p.id === settings.palette).desc;
  $('palette-custom').hidden = !custom;
  const strip = $('palette-strip');
  strip.replaceChildren();
  (custom ? settings.custom : pathColors()).forEach((color, i, all) => {
    const sw = document.createElement('span');
    sw.className = 'swatch'; sw.style.background = color; sw.title = `Color ${i + 1}`;
    if (custom) {
      const input = document.createElement('input');
      input.type = 'color'; input.value = color; input.setAttribute('aria-label', `Color ${i + 1}`);
      input.addEventListener('input', () => { settings.custom[i] = input.value; sw.style.background = input.value; changeCustom(false); });   // live, and the picker stays open
      sw.append(input);
      if (all.length > MIN_CUSTOM) {
        const x = document.createElement('button');
        x.type = 'button'; x.className = 'swatch-x'; x.textContent = '×'; x.setAttribute('aria-label', `Remove color ${i + 1}`);
        x.addEventListener('click', () => { settings.custom.splice(i, 1); changeCustom(true); });
        sw.append(x);
      }
    }
    strip.append(sw);
  });
  $('palette-add').disabled = custom && settings.custom.length >= MAX_CUSTOM;
}
function changeCustom(redraw) {
  store.set('yj_pathCustom', JSON.stringify(settings.custom));
  board.setOptions(paletteOptions());
  if (redraw) renderPaletteUI();
}
for (const p of [...PRESETS, { id: CUSTOM, name: 'Custom…' }]) $('setting-palette').add(new Option(p.name, p.id));
$('setting-palette').addEventListener('change', (e) => {
  if (e.target.value === CUSTOM && !settings.custom) settings.custom = lightColors(settings.palette, null).slice(0, 8);   // start from what you were using
  settings.palette = e.target.value;
  store.set('yj_pathPalette', settings.palette);
  changeCustom(true);
});
$('palette-add').addEventListener('click', () => {
  settings.custom.push(PRESETS[0].light.find((c) => !settings.custom.includes(c)) || '#808080');
  changeCustom(true);
});
$('palette-reset').addEventListener('click', () => { settings.custom = PRESETS[0].light.slice(0, 8); changeCustom(true); });
renderPaletteUI();
clearBtn.addEventListener('click', () => {
  if (!clearBtn.classList.contains('danger-btn--confirm')) { clearBtn.classList.add('danger-btn--confirm'); clearBtn.textContent = 'Are you sure?'; return; }
  try { Object.keys(localStorage).filter((k) => k.startsWith('yj_save_') || k === 'yj_solved' || k === 'yj_book_solved').forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  disarmClear();
  if (state.P) openPuzzle(state.idx);
  toast('Saved progress cleared.');
});
$('csv-btn').addEventListener('click', () => $('csv-file').click());
$('csv-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const text = await f.text(), puzzles = parseCsv(text);
  if (!puzzles.length) { toast('No puzzles found in that file.'); return; }
  rememberFileBook(f.name, text);
  const id = `file:${f.name}`;
  state.books = state.books.filter((b) => b.id !== id);
  state.books.push({ id, name: f.name, puzzles });
  settingsModal.close();
  openBook(id, 0);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (board.gesture) { board.cancel(); return; }
    modals.find(({ modal }) => !modal.classList.contains('modal-hidden'))?.close();
    return;
  }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (modalOpen()) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});

init();
