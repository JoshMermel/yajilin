// App controller: books and puzzle selection, marks, undo/redo, persistence, checks, settings.
import { compile, parseCsv, puzzleHash, solve, decodeSolution, checkSolved, E_ON, SHADED, LOOP } from './logic.js';
import { Board } from './board.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode etc.: progress just isn't saved */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const state = {
  books: [],        // [{ id, name, file | puzzles }]
  book: null,       // the loaded book: { id, name, puzzles: [compiled puzzle] }
  idx: 0,
  P: null,
  marks: null,      // { cells: Uint8Array, edges: Uint8Array }
  undo: [], redo: [],
  pending: null,    // snapshot at the start of the current gesture
  drawMode: 1,
  solved: false,
};

const board = new Board($('board'), {
  onStart: () => { state.pending = snapshot(); },
  onTap: (cell) => cycleCell(cell),
  onStep: (a, b, first) => dragStep(a, b, first),
  onEnd: (cancelled) => endGesture(cancelled),
});

// ------------------------------------------------------------ marks

const snapshot = () => ({ cells: state.marks.cells.slice(), edges: state.marks.edges.slice() });
const sameMarks = (a, b) => a.cells.every((v, i) => v === b.cells[i]) && a.edges.every((v, i) => v === b.edges[i]);
const emptyMarks = (P) => ({ cells: new Uint8Array(P.N), edges: new Uint8Array(P.numEdges) });

function cycleCell(i) {
  const P = state.P;
  if (P.clueAt[i] >= 0) return;
  const m = state.marks;
  m.cells[i] = [2, 0, 1][m.cells[i]]; // empty -> dot -> shaded -> empty
  if (m.cells[i] === 1) removeEdgesAt(i); // a shaded cell is not on the loop
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
  if (sameMarks(state.marks, emptyMarks(state.P))) return;
  state.undo.push(snapshot()); state.redo = [];
  state.marks = emptyMarks(state.P);
  save(); refresh();
}

// ------------------------------------------------------------ analysis for drawing

function analyse() {
  const P = state.P, m = state.marks;
  const clueState = P.clues.map((cl, k) => {
    let s = 0;
    for (const i of P.rays[k]) if (m.cells[i] === 1) s++;
    return s > cl.n ? 'bad' : s === cl.n ? 'ok' : '';
  });
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

function refresh() {
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
  $('reset-btn').disabled = sameMarks(state.marks, emptyMarks(state.P));
}

// ------------------------------------------------------------ persistence

const saveKey = (P) => `yj_save_${puzzleHash(P)}`;

function save() {
  const P = state.P, m = state.marks;
  const empty = sameMarks(m, emptyMarks(P));
  if (empty) { store.del(saveKey(P)); return; }
  store.set(saveKey(P), JSON.stringify({ c: Array.from(m.cells).join(''), e: Array.from(m.edges).join('') }));
}

function load(P) {
  const m = emptyMarks(P);
  try {
    const s = JSON.parse(store.get(saveKey(P)) || 'null');
    if (s && s.c.length === P.N && s.e.length === P.numEdges) {
      for (let i = 0; i < P.N; i++) m.cells[i] = +s.c[i];
      for (let i = 0; i < P.numEdges; i++) m.edges[i] = +s.e[i];
    }
  } catch { /* corrupt save: start fresh */ }
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
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
$('toast').addEventListener('click', () => { $('toast').hidden = true; });

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

// ------------------------------------------------------------ books and puzzles

async function fetchBook(entry) {
  if (entry.puzzles) return entry.puzzles;
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error(`${entry.file}: ${res.status}`);
  return parseCsv(await res.text());
}

async function openBook(id, idx = 0) {
  const entry = state.books.find((b) => b.id === id) || state.books[0];
  if (!entry) { $('puz-info').textContent = 'No puzzle books found.'; return; }
  const raw = await fetchBook(entry);
  state.book = { id: entry.id, name: entry.name, puzzles: raw.map(compile) };
  $('book-select').value = entry.id;
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
  // On localhost, a git-ignored data/tmp.csv shows up as a scratch book (the borrowed calibration puzzles).
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    try {
      const r = await fetch('data/tmp.csv', { method: 'HEAD' });
      if (r.ok) state.books.push({ id: 'tmp', name: 'tmp (local scratch)', file: 'data/tmp.csv' });
    } catch { /* no scratch book */ }
  }
  const sel = $('book-select');
  sel.innerHTML = state.books.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
  if (!state.books.length) { $('puz-info').textContent = 'No puzzle books yet. Load a CSV in Settings.'; return; }
  const params = new URLSearchParams(location.search);
  let last = null;
  try { last = JSON.parse(store.get('yj_last') || 'null'); } catch { /* ignore */ }
  const bookId = params.get('book') || (last && last.book) || manifest.default || state.books[0].id;
  const idx = params.has('puzzle') ? +params.get('puzzle') - 1 : (last && last.book === bookId ? last.idx : 0);
  await openBook(bookId, Number.isFinite(idx) ? idx : 0);
}

// ------------------------------------------------------------ wiring

const step = (d) => { if (state.book) openPuzzle((state.idx + d + state.book.puzzles.length) % state.book.puzzles.length); };
$('prev-puz').addEventListener('click', () => step(-1));
$('next-puz').addEventListener('click', () => step(1));
$('puz-num').addEventListener('change', (e) => { if (state.book) openPuzzle(Math.min(Math.max((+e.target.value || 1) - 1, 0), state.book.puzzles.length - 1)); });
$('book-select').addEventListener('change', (e) => openBook(e.target.value, 0));
$('undo-btn').addEventListener('click', undo);
$('redo-btn').addEventListener('click', redo);
$('reset-btn').addEventListener('click', reset);
$('check-btn').addEventListener('click', checkSoFar);
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

const clearBtn = $('clear-saves-btn');
const disarmClear = () => { clearBtn.classList.remove('danger-btn--confirm'); clearBtn.textContent = 'Clear saves'; };
const settingsModal = setupModal('settings-modal', 'settings-btn', () => {
  $('setting-dark-mode').checked = document.documentElement.dataset.theme === 'dark';
  disarmClear();
});
setupModal('help-modal', 'help-btn');

$('setting-dark-mode').addEventListener('change', (e) => {
  document.documentElement.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
  store.set('yj_dark', e.target.checked ? '1' : '0');
});
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
  $('book-select').innerHTML = state.books.map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
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
