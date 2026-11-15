// App controller: books and puzzle selection, marks, undo/redo, persistence, checks, settings.
import { compile, parseCsv, puzzleHash, solve, decodeSolution, checkSolved, initialState, E_ON, SHADED, LOOP, UNKNOWN } from './logic.js';
import { nextSteps, RULES } from './rating.js';
import { explainStep, describeMarks, ROLES } from './explain.js';
import { Board } from './board.js';
import { clueStates } from './clues.js';
import { nextMark } from './marks.js';

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
const settings = {
  colorLines: store.get('yj_colorLines') === '1', // color each separate path differently
  labels: store.get('yj_labels') === '1',         // number the rows and columns
  autoDots: store.get('yj_autoDots') === '1',     // automatic dots: next to a box, and along a satisfied clue
};

const board = new Board($('board'), {
  onStart: () => { state.pending = snapshot(); },
  onTap: (cell) => cycleCell(cell),
  onStep: (a, b, first) => dragStep(a, b, first),
  onEnd: (cancelled) => endGesture(cancelled),
  onRight: (cell) => toggleBox(cell),
});
board.setOptions({ colorLines: settings.colorLines, labels: settings.labels });

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

// ---- automatic dots, with their reasons
// A cell has a reason to be a dot when it is next to a box ('s<cell>') or in the line of a clue that has all its boxes
// ('c<clue>'). A dot is placed automatically when a cell gains a reason it did not have before, and an automatic dot goes
// away when its last reason does (take the box off, and the dots it caused go too). Dots the player placed are never touched.

/** Map: cell -> Set of reasons it should be a dot. */
function reasonsOf(P, m) {
  const out = new Map();
  const add = (i, r) => { let s = out.get(i); if (!s) out.set(i, (s = new Set())); s.add(r); };
  for (let i = 0; i < P.N; i++) {
    if (m.cells[i] !== 1) continue;
    for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0) add(j, `s${i}`); }
  }
  P.clues.forEach((cl, k) => {
    let shaded = 0;
    for (const i of P.rays[k]) if (m.cells[i] === 1) shaded++;
    if (shaded === cl.n) for (const i of P.rays[k]) add(i, `c${k}`);
  });
  return out;
}

/** Bring the automatic dots of `cur` in line with its reasons; `prev` is the position before the change (null: a fresh board, where every reason is new). */
function reconcile(P, prev, cur) {
  const before = prev ? reasonsOf(P, prev) : new Map(), now = reasonsOf(P, cur);
  for (let i = 0; i < P.N; i++) {
    if (P.clueAt[i] >= 0 || P.boxIdx.includes(i)) continue;
    const reasons = now.get(i);
    if (cur.cells[i] === 2 && cur.auto[i]) {
      if (!reasons) { cur.cells[i] = 0; cur.auto[i] = 0; }          // its reasons are gone
    } else if (cur.cells[i] === 0 && reasons && settings.autoDots) {
      const old = before.get(i);
      for (const r of reasons) if (!old || !old.has(r)) { cur.cells[i] = 2; cur.auto[i] = 1; break; } // a new reason
    }
  }
}

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
  for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && m.edges[x]) lined = true; }
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
  for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0) state.marks.edges[x] = 0; }
}

function dragStep(a, b, first) {
  const P = state.P, m = state.marks;
  let x = -1;
  for (let d = 0; d < 4; d++) if (P.nb[a * 4 + d] === b) x = P.ed[a * 4 + d];
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
    for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && m.cells[j] === 1) { badShaded.add(i); badShaded.add(j); } }
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
  const off = settings.labels ? 16 : 0;
  const avail = Math.min(window.innerWidth - 24, 1500);
  const px = Math.max(26, Math.min(46, Math.floor(avail / (P.cols + 0.5))));
  const width = Math.round(((P.cols * 44 + 8 + off) * px) / 44);
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

function save() {
  const P = state.P, m = state.marks;
  if (isPristine(m)) { store.del(saveKey(P)); return; }
  store.set(saveKey(P), JSON.stringify({ c: Array.from(m.cells).join(''), e: Array.from(m.edges).join(''), a: Array.from(m.auto).join('') }));
}

function load(P) {
  let m = null;
  try {
    const s = JSON.parse(store.get(saveKey(P)) || 'null');
    if (s && s.c.length === P.N && s.e.length === P.numEdges) {
      m = emptyMarks(P);
      for (let i = 0; i < P.N; i++) m.cells[i] = +s.c[i];
      for (let i = 0; i < P.numEdges; i++) m.edges[i] = +s.e[i];
      if (s.a && s.a.length === P.N) for (let i = 0; i < P.N; i++) m.auto[i] = +s.a[i];
    }
  } catch { m = null; /* corrupt save: start fresh */ }
  if (!m) return freshMarks(P);
  for (const i of P.boxIdx) m.cells[i] = 1;
  return m;
}

const solvedSet = () => { try { return new Set(JSON.parse(store.get('yj_solved') || '[]')); } catch { return new Set(); } };
function markSolved() {
  const s = solvedSet(); s.add(puzzleHash(state.P));
  store.set('yj_solved', JSON.stringify([...s]));
}

// ------------------------------------------------------------ check / toast

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.classList.remove('hint', 'top');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function hideHintToast() { const t = $('toast'); if (t.classList.contains('hint')) { t.hidden = true; t.classList.remove('hint', 'top'); } }
function dismissToast() {
  const t = $('toast');
  if (t.hidden) return;
  t.hidden = true;
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
      const res = nextSteps(P, st);
      const ms = Math.round(performance.now() - t0);
      if (!res) {
        const undecided = [];
        for (let i = 0; i < P.N; i++) if (st.cell[i] === UNKNOWN) undecided.push(i);
        state.hint = { sig, kind: 'stuck', visible: true, undecided, ms };
      } else {
        state.hint = { sig, kind: 'step', visible: true, res, idx: 0, ms, st };
      }
    }
  }
  showHint();
}

function showHint() {
  const h = state.hint, P = state.P;
  const t = $('toast');
  clearTimeout(toastTimer);
  t.classList.add('hint');
  t.replaceChildren();
  const line = (cls, text) => { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; t.appendChild(d); };
  const legend = (roles) => {
    const used = Object.keys(ROLES).filter((r) => (roles[r] || []).length);
    if (!used.length) return;
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
    t.appendChild(d);
  };
  let overlay = null;
  if (h.kind === 'wrong') {
    overlay = { wrongCells: h.wrongCells, wrongEdges: h.wrongEdges };
    const n = h.wrongCells.length + h.wrongEdges.length;
    line('hint-meta', 'mistake');
    line('', `${n} mark${n === 1 ? ' is' : 's are'} incorrect (shown in red). Fix them before asking for a step.`);
  } else if (h.kind === 'stuck') {
    overlay = { undecided: h.undecided };
    line('hint-meta', `stuck · ${RULES.filter((r) => !r.free).length} rules tried · ${h.ms} ms`);
    line('', `The draft solver is stuck: none of its rules finds a next step from here. The tinted cells are the ${h.undecided.length} it still cannot decide.`);
    line('hint-more', 'This is a place to look for an inference the solver is missing.');
  } else {
    const f = h.res.firings[h.idx];
    const e = explainStep(P, { rule: h.res.rule, tier: h.res.tier, weight: h.res.weight, sets: f.sets, info: f.info }, h.st);
    overlay = { roles: e.roles, shaded: e.targets.shaded, loop: e.targets.loop, segOn: e.targets.segOn, segOff: e.targets.segOff };
    line('hint-meta', `${e.rule} · ${e.tier} · weight ${e.weight} · ${h.ms} ms`);
    line('', e.text);
    line('hint-marks', describeMarks(e.targets));
    legend(e.roles);
    if (h.res.firings.length > 1) line('hint-more', `${h.idx + 1} of ${h.res.firings.length} steps of this rule; press Hint for the next.`);
  }
  t.hidden = false;
  // like polyomino-panel: sit at the bottom unless that would cover the board, then move to the top
  t.classList.remove('top');
  const b = $('board').getBoundingClientRect(), tr = t.getBoundingClientRect();
  if (tr.top < b.bottom && tr.bottom > b.top) t.classList.add('top');
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
  syncBookButton();
  $('puz-total').textContent = state.book.puzzles.length;
  $('puz-num').max = state.book.puzzles.length;
  openPuzzle(Math.min(Math.max(idx, 0), state.book.puzzles.length - 1));
}

function openPuzzle(idx) {
  const book = state.book;
  if (!book || !book.puzzles.length) return;
  state.idx = idx;
  const P = state.P = book.puzzles[idx];
  state.marks = load(P);
  state.undo = []; state.redo = [];
  state.solved = false;
  board.setPuzzle(P);
  fitBoard();
  $('puz-num').value = idx + 1;
  const tier = P.tier ? ` · ${P.tier}` : '';
  $('puz-info').textContent = `${P.name} · ${P.cols}×${P.rows}${tier}`;
  store.set('yj_last', JSON.stringify({ book: book.id, idx }));
  const url = new URL(location.href);
  url.searchParams.set('book', book.id); url.searchParams.set('puzzle', idx + 1);
  history.replaceState(null, '', url);
  refresh();
  state.solved = isSolved(); // opening an already-solved save should not count as a fresh solve
}

async function init() {
  let manifest = { books: [] };
  try { manifest = await (await fetch('data/manifest.json')).json(); } catch { /* none yet */ }
  state.books = manifest.books || [];
  state.groups = manifest.groups || [];
  // On localhost, a git-ignored data/tmp.csv shows up as a scratch book (the borrowed calibration puzzles).
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    try {
      const r = await fetch('data/tmp.csv', { method: 'HEAD' });
      if (r.ok) state.books.push({ id: 'tmp', name: 'tmp (local scratch)', label: 'Scratch', group: 'Local', blurb: 'The borrowed calibration puzzles (private, this machine only).', file: 'data/tmp.csv' });
    } catch { /* no scratch book */ }
  }
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

const step = (d) => { if (state.book) openPuzzle((state.idx + d + state.book.puzzles.length) % state.book.puzzles.length); };
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
setupModal('help-modal', 'help-btn');

// --- Book picker: a button showing the current book opens a modal of every book, in sections, each with what it holds and how many of
// its puzzles are solved (the same idea as polyomino-panel's). Books and sections come from data/manifest.json.
function syncBookButton() {
  const btn = $('book-btn');
  btn.textContent = '';
  const name = document.createElement('span');
  name.className = 'book-btn-name';
  const entry = state.books.find((b) => state.book && b.id === state.book.id);
  name.textContent = entry ? entry.label || entry.name : 'Choose a book';
  btn.append(name);
}

function renderBookPicker() {
  const body = $('bp-body');
  body.textContent = '';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  // the manifest's sections in order, then any section a book names that the manifest does not list (a file loaded from disk, say)
  const groups = [...state.groups];
  for (const b of state.books) { const g = b.group || 'Your files'; if (!groups.some((x) => x.name === g)) groups.push({ name: g }); }
  const counts = [];                                       // [{ book, node }]: solved counts to fill in once each book is loaded
  for (const g of groups) {
    const books = state.books.filter((b) => (b.group || 'Your files') === g.name);
    if (!books.length) continue;
    const sec = el('div', 'bp-section');
    sec.append(el('h3', '', g.name));
    if (g.blurb && books.length > 1) sec.append(el('p', 'bp-blurb', g.blurb));     // a lone book says enough in its own blurb
    const tiles = g.layout === 'tiles' && books.length > 1;
    const holder = tiles ? el('div', 'bp-grid') : sec;
    for (const b of books) {
      const current = state.book && b.id === state.book.id;
      const node = el('button', (tiles ? 'bp-tile' : 'bp-book') + (current ? ' bp-current' : ''));
      node.type = 'button';
      if (current) node.setAttribute('aria-current', 'true');
      const title = el('span', 'bp-book-title', b.label || b.name);
      const count = el('span', 'bp-count', b.puzzles ? `${b.puzzles.length} puzzles` : '');
      if (b.blurb) node.title = b.blurb;
      if (tiles) {
        const head = el('span', 'bp-tile-head');
        head.append(title, count);
        node.append(head);
        if (b.blurb) node.append(el('span', 'bp-book-blurb', b.blurb));
      } else {
        const text = el('span', 'bp-book-text');
        text.append(title);
        if (b.blurb) text.append(el('span', 'bp-book-blurb', b.blurb));
        node.append(text, count);
      }
      node.addEventListener('click', () => { bookModal.close(); if (!current) openBook(b.id, 0); });
      holder.append(node);
      counts.push({ book: b, count });
    }
    if (tiles) sec.append(holder);
    body.append(sec);
  }
  requestAnimationFrame(() => body.querySelector('.bp-current')?.scrollIntoView({ block: 'center' }));
  // how many of each book's puzzles are solved: needs the book's puzzles, so load them (small files, cached) and update the rows as they arrive
  const solved = solvedSet();
  for (const { book, count } of counts) {
    fetchBook(book).then((raw) => {
      const n = raw.filter((p) => solved.has(puzzleHash(p))).length;
      count.textContent = n ? `${n} / ${raw.length} solved` : `${raw.length} puzzles`;
      count.classList.toggle('bp-count-done', n > 0 && n === raw.length);
    }).catch(() => { /* the count stays as it was */ });
  }
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
});
for (const [id, key, store_key] of [['setting-color-lines', 'colorLines', 'yj_colorLines'], ['setting-labels', 'labels', 'yj_labels'], ['setting-auto-dots', 'autoDots', 'yj_autoDots']]) {
  const el = $(id);
  el.checked = settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    store.set(store_key, el.checked ? '1' : '0');
    board.setOptions({ colorLines: settings.colorLines, labels: settings.labels });
    fitBoard();
  });
}
clearBtn.addEventListener('click', () => {
  if (!clearBtn.classList.contains('danger-btn--confirm')) { clearBtn.classList.add('danger-btn--confirm'); clearBtn.textContent = 'Are you sure?'; return; }
  try { Object.keys(localStorage).filter((k) => k.startsWith('yj_save_') || k === 'yj_solved').forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  disarmClear();
  if (state.P) openPuzzle(state.idx);
  toast('Saved progress cleared.');
});
$('csv-btn').addEventListener('click', () => $('csv-file').click());
$('csv-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const puzzles = parseCsv(await f.text());
  if (!puzzles.length) { toast('No puzzles found in that file.'); return; }
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
