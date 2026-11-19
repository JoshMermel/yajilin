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

// ---- Automatic dots, with their reasons
// A cell has a reason to be a dot when it is next to a box ('s<cell>') or in the line of a clue that has all its boxes ('c<clue>').
// A dot is placed automatically when a cell gains a reason it did not have before, and an automatic dot goes away when its last reason
// does (take the box off, and the dots it caused go too). A box the player puts on such a cell and takes off again leaves the automatic dot
// back, since the reasons never went away. Dots the player placed are never touched.
// marks m = { cells: 0 blank / 1 box / 2 dot, edges, auto: 1 where a dot was placed automatically }; P is a compiled puzzle.

/** Map: cell -> Set of reasons it should be a dot. */
export function reasonsOf(P, m) {
  const out = new Map();
  const add = (i, r) => { let s = out.get(i); if (!s) out.set(i, (s = new Set())); s.add(r); };
  for (let i = 0; i < P.N; i++) {
    if (m.cells[i] !== BOX) continue;
    for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0) add(j, `s${i}`); }
  }
  P.clues.forEach((cl, k) => {
    let shaded = 0;
    for (const i of P.rays[k]) if (m.cells[i] === BOX) shaded++;
    if (shaded === cl.n) for (const i of P.rays[k]) add(i, `c${k}`);
  });
  return out;
}

/**
 * Bring the automatic dots of `cur` in line with its reasons; `prev` is the position before the change (null: a fresh board or a switch
 * turned on, where every reason is new). `enabled` says whether new dots may be placed (automatic dots that lost their reasons go either way).
 */
export function reconcile(P, prev, cur, enabled = true) {
  const before = prev ? reasonsOf(P, prev) : new Map(), now = reasonsOf(P, cur);
  const given = new Set(P.boxIdx);
  for (let i = 0; i < P.N; i++) {
    if (P.clueAt[i] >= 0 || given.has(i)) continue;
    const reasons = now.get(i);
    if (cur.cells[i] === DOT && cur.auto[i]) {
      if (!reasons) { cur.cells[i] = EMPTY; cur.auto[i] = 0; }          // its reasons are gone
    } else if (cur.cells[i] === EMPTY && reasons && enabled) {
      const old = before.get(i);
      if (prev && prev.cells[i] === BOX) { cur.cells[i] = DOT; cur.auto[i] = 1; }    // a box taken off a cell that still has reasons: back to its automatic dot
      else for (const r of reasons) if (!old || !old.has(r)) { cur.cells[i] = DOT; cur.auto[i] = 1; break; } // a new reason
    }
  }
}

/**
 * The automatic-dots switch was flipped (changes `m`; returns how many cells changed). On: put a dot on every cell that has a reason to
 * be one and is still blank, as if each reason had just appeared. Off: take away every automatic dot; the player's own dots stay.
 */
export function applyAutoDots(P, m, on) {
  const was = Uint8Array.from(m.cells);
  if (on) reconcile(P, null, m, true);
  else for (let i = 0; i < P.N; i++) if (m.cells[i] === DOT && m.auto[i]) { m.cells[i] = EMPTY; m.auto[i] = 0; }
  let changed = 0;
  for (let i = 0; i < P.N; i++) if (m.cells[i] !== was[i]) changed++;
  return changed;
}
