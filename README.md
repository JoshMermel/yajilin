# Yajilin

A browser game and (eventually) puzzle toolkit for **Yajilin**, built to the same pattern as
`polyomino-panel` and `multiverse-star-battle`: generators, a human-style scorer, a corpus turned into books, and a GUI.

**Rules:** draw one closed loop through every cell that is not a clue cell and not shaded. A clue cell's number says
how many cells are shaded in the direction of its arrow (to the board's edge). Shaded cells never touch each other
orthogonally. Every cell is a clue, shaded, or on the loop.

## Status

| Part | State |
| --- | --- |
| Exact solver / uniqueness counter (`js/logic.js`) | done, cross-checked against a brute-force reference (`tests/`) |
| Browser GUI (`index.html`, `js/board.js`, `js/main.js`) | playable: tap to cycle empty/shaded/dot, drag to draw the loop, undo/redo, saves, "Correct so far?" |
| Human-style scorer + Hint (`js/rating.js`) | not started: next, calibrated on the borrowed puzzles |
| Generator | not started |
| Corpus, books, print | not started |

See [TODO.md](TODO.md).

## Run

Plain HTML/CSS/JS modules, no build step:

```bash
python3 -m http.server 8766
```

then open <http://localhost:8766>. Tests: `node --test tests/*.test.mjs`.

## Puzzle CSV format

```
name,rows,cols,clues,solution,rules,tier,score
```

- `clues`: items joined by `;`, each `row:col:dir:n` with `dir` one of `U R D L` (0-based row and column).
- `solution`: one char per cell, row-major: `#` clue cell, `x` shaded, otherwise a hex digit of the loop cell's exits
  (U=1, R=2, D=4, L=8; so `6` is a corner joining right and down, `a` a horizontal straight, `5` a vertical one).
- `rules`, `tier`, `score`: optional difficulty (filled in by the scorer once it exists).

Progress is saved in `localStorage` keyed by a hash of the puzzle (size and clues), so it survives renumbering.

## Layout

| Path | Purpose |
| --- | --- |
| `js/logic.js` | Pure logic: puzzle compile, propagation + search solver (counts solutions), solved check, CSV |
| `js/board.js` | SVG board and pointer gestures (tap a cell, drag across cells) |
| `js/main.js` | App controller: books, pager, marks, undo/redo, saves, settings |
| `tools/import_puzzlemadness.mjs` | Convert the borrowed calibration puzzles in `tools/calibration/` to `data/tmp.csv` |
| `tests/` | `node --test tests/*.test.mjs`; `reference_solver.mjs` is the slow cross-check |
| `data/manifest.json` | Published books (none yet). On localhost a git-ignored `data/tmp.csv` shows up as a scratch book |

## Calibration puzzles

12 puzzles (easy 6x6/7x7, medium 8x8, hard 9x9) borrowed from puzzlemadness.co.uk are used **privately** to check the
solver (all 12 have exactly one solution under our reading of the rules) and later to calibrate the scorer against the
site's easy/medium/hard labels. They live in `tools/calibration/` and `data/tmp.csv`, both git-ignored, and must never be
published. The site embeds each puzzle as `puzzleData.data.rawclues` in its page: 4 numbers per clue,
`[x, y, direction, count]`, direction 1=up 2=down 3=left 4=right.
