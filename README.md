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
| Hint button | done: shows the draft solver's next step (rule, tier, weight, explanation, ghost marks); says when it is stuck |
| Generator (`js/generator.js`, `tools/generate.mjs`) | done for boards up to about 12x12; bigger boards need long runs (see TODO) |
| Corpus and books (`tools/library/`, `tools/build_book.mjs`) | first draft: one "Large (draft)" book; no tier shares, no picker, no print yet |

See [TODO.md](TODO.md).

## Run

Plain HTML/CSS/JS modules, no build step:

```bash
python3 -m http.server 8766
```

then open <http://localhost:8766>. Tests: `node --test tests/*.test.mjs`.

Making puzzles (the pattern from the sibling projects: pools, then books):

```bash
node tools/generate.mjs --size 12x12 --count 3 --seed 1 --budget 600   # COLSxROWS, rows*cols even; appends to tools/library/
node tools/build_book.mjs --id large --name "Large (draft)"            # pools -> data/large.csv + manifest.json
```

`generate.mjs` re-checks every puzzle (stored solution valid; exactly one solution by a *complete* exhaustive search) and rates it
before storing. A search that hit its node limit is reported by `solve()` as `exceeded` and never counts as proof of uniqueness.

## Puzzle CSV format

```
name,rows,cols,clues,solution,rules,tier,score
```

- `clues`: items joined by `;`, each `row:col:dir:n` with `dir` one of `U R D L` (0-based row and column).
- `solution`: one char per cell, row-major: `#` clue cell, `x` shaded, otherwise a hex digit of the loop cell's exits
  (U=1, R=2, D=4, L=8; so `6` is a corner joining right and down, `a` a horizontal straight, `5` a vertical one).
- `rules`, `tier`, `score`: difficulty from the human-style solver (`tools/generate.mjs` fills them in).
- `boxes`: optional pre-placed boxes, `row:col` items joined by `;`. They are shaded from the start and cannot be changed (drawn with an inner
  ring); they are not clues and not on the loop. The solver, rater, checker and GUI support them; the generator does not make them yet.

Progress is saved in `localStorage` keyed by a hash of the puzzle (size and clues), so it survives renumbering.

## Layout

| Path | Purpose |
| --- | --- |
| `js/logic.js` | Pure logic: puzzle compile, propagation + search solver (counts solutions), solved check, CSV |
| `js/explain.js` | Turns a solver step into a sentence, the cells to look at and the marks it makes (used by Hint) |
| `js/generator.js` | Solution-first generator: random loop (2-factor + cycle merging), holes become shaded or clue cells, then simulated annealing aims clues until the human rules (or the rules plus a tiny search) solve it |
| `js/rating.js` | The rule table (rule, tier, weight) and the human-style solver that rates puzzles (and will drive Hint) |
| `js/board.js` | SVG board and pointer gestures (tap a cell, drag across cells) |
| `js/main.js` | App controller: books, pager, marks, undo/redo, saves, settings |
| `tools/generate.mjs`, `tools/build_book.mjs` | Fill pools in `tools/library/` (git-ignored), then assemble `data/<book>.csv` |
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
| `tightCell` | a neighbour has only two cells it can ever connect to (board edge and clue cells around it: a corner, clues touching diagonally, a gap between two clues): the cell is loop. Seen at a glance | Beginner | 0.5 |
| `deadEndNeighbor` | shading a cell would strand a neighbour (given the marks so far): the cell is loop | Beginner | 2 |
| `sameSegmentExits` | a loop cell has three ways out and two of them lead to the two ends of one path: using both would close the loop early, so it uses the third | Medium | 3 |
| `closingCell` | a cell has only two ways out and both lead to the two ends of one path: using them would close the loop early, so the cell is a box | Medium | 3 |
| `noEarlyClose` | a segment joining the two ends of one path would close the loop while other loop cells are outside it | Medium | 3 |
| `cluePlacements` | try every way to place the clue's boxes without two touching: a cell they all use is shaded, a cell none uses is loop | Medium | 4 |
| `crossingParity` | the loop crosses the border of any rectangle an even number of times (every loop cell has exactly two segments): when all but one crossing is settled, the last is forced. Checked for small rectangles, corner-anchored ones and full-width or full-height bands | Medium | 6 |
| `rangeSame` | two clues in a line point the same way: the cells between them hold (first number - second number) boxes; use that range like a clue | Medium | 6 |
| `shadeForcesLines` | imagine a cell shaded and add the lines that forces (a loop cell with two exits uses both): if a line end must do two incompatible things (a cell gets three lines, or is stranded), the cell is loop | Hard | 8 |
| `parityForces` | a move (a cell shaded, a segment drawn or missing) would cut off a group of cells that can still be joined and holds an odd number of open ends (cells with one line that still need a second), which can never be completed: it is the other way | Hard | 9 |
| `rangeFacing` | two clues point at each other: how many boxes fit between them (given what each end can hold) pins how many each end needs; use the three ranges like clues | Hard | 10 |
| `tryCell` | assume a cell is shaded (loop), follow the rules above to a contradiction: it is the other | Hard | 12 |
| `tryEdge` | the same for a segment (on / off) | Hard | 14 |

Segments touching a shaded cell are off, a segment makes both its cells loop cells, and a loop cell with two segments has
no others: these are bookkeeping (weight 0), not counted as steps. A *contradiction* is two touching shaded cells, a group of cells that can still be joined holding an odd number of open ends (every segment still to be drawn adds one end to each of two cells in the same group, so each group must hold an even number), a clue
with too many or too few possible shaded cells, a loop cell with fewer than two exits or more than two segments, or a loop
closed while other loop cells lie outside it.

Calibration against the borrowed puzzles (private, see below). With the first nine rules, every site Easy and Medium
puzzle rates Medium here (each needs `noEarlyClose`) and all four site-Hard ones need `tryCell`. After adding the patterns
Josh described (`cluePlacements`, `shadeForcesLines`, `rangeSame`, `rangeFacing`), three of the four site-Hard puzzles
solve at Medium, without trial-and-error lookahead (`shadeForcesLines` does the work), and only one still needs `tryCell`
(9 uses, down from 24). With `shadeForcesLines` moved to Hard (Josh: "would force a line end to do two incompatible things"; the site's puzzles just do not need it much), three site-Hard puzzles rate Hard again. Open questions: `noEarlyClose` is taught early by the site's own tutorial and probably belongs in Beginner, and the Easy/Medium split looks driven by board size and clue density more than by technique.

### How the generator targets human-viable puzzles

The generator never uses exhaustive search to *make* a puzzle unique. The rules are sound, so a puzzle they solve has exactly one solution;
the generator climbs (simulated annealing over clue directions and which non-loop cells are clues) until the rules leave nothing
undecided, or only a small region that a complete exhaustive search then proves has one solution (a person finishes those with a little
trial: tier Hard). That is also why rating is fast: a 12x12 puzzle rates in well under a second, where an arbitrary 36x20 board
took minutes. Generating is the expensive part: 10x10 takes seconds, 12x12 under a minute, and 14x14 and up needs long runs.

### Hint button

Hint runs the same `nextSteps` the rater uses on the player's marks (shaded = shaded, dot = loop, segment = on), so it shows how the draft solver thinks and where it gets stuck. It first reports marks that are wrong (red); otherwise it shows the easiest available step: the rule id, tier, weight and time, a sentence, the cells it looks at (blue) and the move as dashed ghost marks. Pressing Hint again steps through the other firings of the same rule. If no rule has a step it says the solver is stuck and tints the cells it still cannot decide. Clicking anywhere dismisses the message; any change to the board clears it. Highlights have roles: blue clue and the cells it counts, a yellow ring for the cell being decided, a hatched cell for the neighbour that would be stranded, dashed green outlines for its remaining ways out, purple for the two ends of a path; ghost segments are shortened so a dot underneath stays visible, and a red cross means "no segment here".

### Settings

Dark mode; **Colour separate lines** (each separate piece of the loop gets its own colour); **Number rows and columns** (columns get letters, rows numbers: cell E3 is column E, row 3, the same names the hints use); **Automatic dots** (a dot in every cell next to a box and in every other cell of a clue that has all its boxes, including 0-clues from the start; drawn fainter, each remembers why it exists and goes away when its last reason does, so taking a box off removes the dots it caused; dots you place are never touched). Right-click puts a box on a cell. A cell with three lines is outlined in red (drawing it is allowed, so you can see the mistake).

## Calibration puzzles

12 puzzles (easy 6x6/7x7, medium 8x8, hard 9x9) borrowed from puzzlemadness.co.uk are used **privately** to check the
solver (all 12 have exactly one solution under our reading of the rules) and later to calibrate the scorer against the
site's easy/medium/hard labels. They live in `tools/calibration/` and `data/tmp.csv`, both git-ignored, and must never be
published. The site embeds each puzzle as `puzzleData.data.rawclues` in its page: 4 numbers per clue,
`[x, y, direction, count]`, direction 1=up 2=down 3=left 4=right.
