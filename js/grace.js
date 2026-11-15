// A grace period before something turns red, so a double tap can finish first (same idea as BAD_DELAY_MS in polyomino-panel).
//
// The first tap of a double tap (empty -> dot) can leave an arrow with no open cell and too few boxes, which would flash red for an
// instant before the second tap (dot -> box) fixes it. So an item that is newly bad waits; if the board changes again before the wait
// is over and it is no longer bad, it never shows. Items that are already red stay red, and clearing red is immediate.
//
// Pure bookkeeping (no DOM, no timers); board.js owns the timer. Keys are any strings ("c3" for clue 3, "s17" for shaded cell 17).

export function makeGrace() {
  let shown = new Set(), waiting = new Set(), waitKey = '';
  return {
    /**
     * wanted: Set of keys that are bad right now. immediate: show new ones at once (a puzzle that has just been opened).
     * Returns { show, waiting, fresh }: draw `show` red; `waiting` are bad but not yet shown; `fresh` is true when the waiting set is
     * different from last time, i.e. a new wait should start (an unchanged waiting set keeps the wait it already has).
     */
    update(wanted, immediate = false) {
      shown = new Set([...shown].filter((k) => wanted.has(k)));
      waiting = new Set();
      for (const k of wanted) if (!shown.has(k)) (immediate ? shown : waiting).add(k);
      const key = [...waiting].sort().join(',');
      const fresh = key !== waitKey;
      waitKey = key;
      return { show: shown, waiting, fresh };
    },
    /** The wait is over: everything waiting shows. */
    commit() { for (const k of waiting) shown.add(k); waiting = new Set(); waitKey = ''; },
    reset() { shown = new Set(); waiting = new Set(); waitKey = ''; },
  };
}
