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
| Browser GUI (`index.html`, `js/board.js`, `js/main.js`) | playable: tap to cycle empty/dot/shaded, drag to draw the loop, undo/redo, saves, "Correct so far?" |
| Human-style scorer (`js/rating.js`) | first rule table done (below); solves all 12 borrowed puzzles; weights and tiers not yet calibrated with Josh |
| Hint button | not started: will read the same rule table |
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
| `js/rating.js` | The rule table (rule, tier, weight) and the human-style solver that rates puzzles (and will drive Hint) |
| `js/board.js` | SVG board and pointer gestures (tap a cell, drag across cells) |
| `js/main.js` | App controller: books, pager, marks, undo/redo, saves, settings |
| `tools/rate_puzzles.mjs` | Rate every puzzle in a CSV and print tier, score and rule usage (`--steps` lists each step) |
| `tools/import_puzzlemadness.mjs` | Convert the borrowed calibration puzzles in `tools/calibration/` to `data/tmp.csv` |
| `tests/` | `node --test tests/*.test.mjs`; `reference_solver.mjs` is the slow cross-check |
| `data/manifest.json` | Published books (none yet). On localhost a git-ignored `data/tmp.csv` shows up as a scratch book |

## Difficulty: rules, tiers and score

A rule-based solver solves each puzzle the way a person would: it always applies the easiest applicable rule and never
looks at the stored solution. A puzzle's **tier** is the tier of the hardest rule it needed, its **score** the weighted
sum of the steps taken (+10 per undecided cell if the rules get stuck, which makes it Expert, "beyond the hints").
The table lives in `js/rating.js` (`RULES`); re-binning a rule or changing a weight is a one-line edit.

| Rule | What it does | Tier | Weight |
| --- | --- | --- | --- |
| `clueDone` | a clue already has all its shaded cells: the rest of its line is loop | Beginner | 1 |
| `clueFull` | a clue needs as many shaded cells as it has open cells left: shade them all | Beginner | 1 |
| `shadedNeighbor` | cells next to a shaded cell are loop | Beginner | 1 |
| `deadEnd` | a cell with fewer than two exits cannot be on the loop: shaded | Beginner | 2 |
| `forcedExits` | a loop cell with exactly two exits left uses both | Beginner | 0.3 |
| `deadEndNeighbor` | shading a cell would strand a neighbour: the cell is loop | Beginner | 2 |
| `clueCapacity` | a clue needs as many shaded cells as its open stretches can hold at most: shade every other cell of each odd stretch | Medium | 4 |
| `noEarlyClose` | a segment joining the two ends of one path would close the loop while other loop cells are outside it | Medium | 3 |
| `tryCell` | assume a cell is shaded (loop), follow the rules above to a contradiction: it is the other | Hard | 12 |
| `tryEdge` | the same for a segment (on / off) | Hard | 14 |

Segments touching a shaded cell are off, a segment makes both its cells loop cells, and a loop cell with two segments has
no others: these are bookkeeping (weight 0), not counted as steps. A *contradiction* is two touching shaded cells, a clue
with too many or too few possible shaded cells, a loop cell with fewer than two exits or more than two segments, or a loop
closed while other loop cells lie outside it.

First calibration against the borrowed puzzles (private, see below): the site's Easy and Medium puzzles all rate Medium
here (every one needs `noEarlyClose`; two Medium ones also need `clueCapacity`), and all four Hard ones rate Hard and need
`tryCell`. These tiers are a first guess: `noEarlyClose` is taught early by the site's own tutorial and probably belongs
in Beginner, and the Easy/Medium split looks driven by board size and clue density more than by technique.

## Calibration puzzles

12 puzzles (easy 6x6/7x7, medium 8x8, hard 9x9) borrowed from puzzlemadness.co.uk are used **privately** to check the
solver (all 12 have exactly one solution under our reading of the rules) and later to calibrate the scorer against the
site's easy/medium/hard labels. They live in `tools/calibration/` and `data/tmp.csv`, both git-ignored, and must never be
published. The site embeds each puzzle as `puzzleData.data.rawclues` in its page: 4 numbers per clue,
`[x, y, direction, count]`, direction 1=up 2=down 3=left 4=right.
