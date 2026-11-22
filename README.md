# Yajilin

**Play it:** <https://joshmermelstein.com/yajilin/> (or run it locally, below). Feedback: see the link in the app's help, or <https://joshmermelstein.com>.

A browser game and puzzle toolkit for **Yajilin**, built to the same pattern as
`polyomino-panel` and `multiverse-star-battle`: generators, a human-style scorer, a corpus turned into books, and a GUI.

**Rules:** draw one closed loop through every cell that is not a clue cell and not shaded. A clue cell's number says
how many cells are shaded in the direction of its arrow (to the board's edge). Shaded cells never touch each other
orthogonally. Every cell is a clue, shaded, or on the loop.

## Status

| Part | State |
| --- | --- |
| Exact solver / uniqueness counter (`js/logic.js`) | done, cross-checked against a brute-force reference (`tests/`) |
| Browser GUI (`index.html`, `js/board.js`, `js/main.js`) | playable: tap to cycle empty/dot/shaded, drag to draw the loop, undo/redo, saves, "Correct so far?", Hint, a Browse modal (grid of the book's puzzles: solved / in progress / current) next to the prev/next arrows |
| Human-style scorer (`js/rating.js`) | first rule table done (below); solves all 12 borrowed puzzles; weights and tiers not yet calibrated with Josh |
| Hint button | done: shows the draft solver's next step (rule, tier, weight, explanation, ghost marks); says when it is stuck |
| Generator (`js/generator.js`, `tools/generate.mjs`) | done up to 20x36: a unique-by-construction loop (`tightLoop`), then clues aimed so the human rules solve it; 14x14 in about a second, 20x36 in under a minute |
| Corpus and books (`tools/library/`, `tools/build_book.mjs`) | forty-nine books in the app (a Gentle intro, five Default books of 1000 puzzles each, by board size: 8×8, 12×12, 16×16, 20×20, 20×36; twenty Bonus books (twelve of 250 puzzles, each theme at 8×8, 12×12 and 16×16: the long way round, one direction, all zeros and no zeros (no arrow says 0 and the numbers run large; in about a third of the 12×12 puzzles every arrow says 2 or more); two Symmetry mix books of 60 (8×8 and 12×12; mirror, diagonal mirror, quarter turn and half turn, twenty each of Beginner, Medium and Hard, five of each symmetry in every tier: the whole puzzle, numbers and loop included, is its own image, so the loop is symmetric too; `js/generator_symmetry.js`, `--layout mirror|transpose|rot90|rot180`, pools by `tools/make_symmetry_exact.sh`, books by `tools/build_symmetry_exact.mjs`); two Symmetric layout books of 250 (8×8 and 12×12, 84/83/83 of Beginner, Medium and Hard; only the clue cells are symmetric under a half turn, quarter turn, mirror or diagonal mirror, while arrows, numbers, boxes and the loop are free: `--layout layout-rot180|layout-rot90|layout-mirror|layout-transpose`, pools by `tools/make_symmetric_layout.sh`, books by `tools/build_symmetric_layout.mjs`; the 16×16 versions of both are made overnight by `tools/run_symmetry_16x16.sh`); three Skyscraper books of 250 (4×36, 6×36 and 8×36, 84/83/83 of Beginner, Medium and Hard: `tools/make_skyscraper.sh`, `tools/build_skyscraper.mjs`; they were one Skinny book of 100 until 2026-11-22); and the Frame experiment (arrows only round the border, a few dozen puzzles named by recipe: `tools/build_frame_experiment.mjs`; inspired by stefliew's 20×20 on Logic Masters, puzzle 0006NR, but deliberately not its layout: arrows on an irregular set of rows and columns, or on every second or fourth line with clearly varied numbers, never every third line and never one number on an even lattice; `--layout frame` with `--lines rows/cols`, `--lattice 2|4` or `--uniform n`, and `tools/cpsat_frame2.py --row-lines --col-lines --rows --cols` for the OR-tools version, stored with `tools/frame_json_to_pool.mjs`); seven Regional books (no arrows: regions with numbers; layout-first, the regions drawn before the solution and OR-tools finding one that makes the layout a unique puzzle, `experiments/regional/LAYOUTS.md`: Pentominoes at 12×5, one of each pentomino, 100 puzzles; Dominoes, Rooms (rectangles) and Symmetric (regions in half-turn pairs) at 8×8 and 10×10, 53 to 65 each; mostly Medium, nothing that needs trial and error; pools by `tools/make_regional_layout_pools.sh`, books by `tools/build_regional_books.mjs`; the old 54-puzzle corpus of grown regions was dropped on 2026-11-22); and the experiments: ten Diagonal books of 250 (an every-arrow-diagonal and a mixed one at each of 8×8, 12×12, 16×16, 20×20 and 20×36, the same sizes as the Default books), and six Sparse ones: an 8×8 and a 12×12 book each for orthogonal, for diagonal and for both kinds of arrows, every one running from Beginner to Hard with as few arrows as a search could find (30 puzzles at 8×8, 24 at 12×12; about one arrow per eleven cells, fewer with diagonals). The bonus themes are one book per size (8×8, 12×12 and 16×16; the few-boxes, packed-with-boxes, voids and voids-only books were dropped on 2026-11-20), 5×5 to 8×8 for the intro, 4×36, 6×36 and 8×36 for the Skyscraper books (a book each), chosen in a picker modal that drills from a card per group (Start here, Default, Diagonal, Sparse, Regional, Bonus) through sub-categories (Diagonal: one per size; Sparse: 8×8, 12×12; Regional: one per kind of layout; Bonus: one per gimmick, each sized book's blurb giving its size and tier spread, written by `tools/bonus_manifest.mjs` from the builders) to the books, with solved counts (the manifest holds each book's puzzle count; solved counts are remembered per book, so the picker never loads a book it does not need); `data/manifest.json` lists the books (id, name, label, group, sub, blurb, count, file) and the groups (name, icon, blurb, subs); no tier shares |
| Printing (`js/print.js`, Settings → Print puzzles) | a printable booklet of any range of the current book (`1-10, 15`), optionally followed by an answer key; boards are drawn in fixed black and white (so dark mode and paper agree), laid out by cell size so a page holds as many as fit (A4 and Letter alike), and every page's header links to the site, so a PDF ("Save as PDF" in the print dialog) leads back to the puzzles; tested in `tests/print.test.mjs` |

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
node tools/build_book.mjs --id bonus-intro --name "Bonus: gentle intro" --glob intro3_   # pools -> data/<id>.csv; a rebuilt book keeps its place, group and blurb in manifest.json
sh tools/make_bonus_standard.sh   # tops up the pools of the bonus books at their standard sizes (flags per book are in the script; ONLY="skinny" (the old name of the Skyscraper pools) SEED=5000 limits it to some books)
sh tools/make_bonus_split.sh && node tools/build_bonus_split.mjs   # pools, then the themed books (long way round, one direction, all zeros, no zeros; 8x8 and 12x12, or --sizes 16x16 with ONLYSIZE=16x16 for the pools; 250 each by default via --limit, an even share from each recipe)
node tools/generate.mjs --size 10x10 --numbers zeros       # style options: --voids K (K void cells), --numbers big|small|zeros|twos|nozeros (every arrow at least 1), --boxes LO,HI (share of boxes among the non-loop cells), --one-dir, --edge-bias q
```

`generate.mjs` re-checks every puzzle (stored solution valid; exactly one solution by a *complete* exhaustive search) and rates it
before storing. A search that hit its node limit is reported by `solve()` as `exceeded` and never counts as proof of uniqueness.

## Puzzle CSV format

```
name,rows,cols,clues,solution,rules,tier,score
```

- `clues`: items joined by `;`, each `row:col:dir:n` with `dir` one of `U R D L` or, for **diagonal arrows** (experiment, branch `experiment/diagonal`), `E C Z Q` = up-right, down-right, down-left, up-left, the keyboard's diagonal keys (0-based row and column). A diagonal arrow counts the shaded cells on its diagonal to the edge; directions 4 to 7 in the code; `turnDir`/`oppositeDir`/`isDiagonal` in logic.js. `node tools/generate.mjs --diagonal 1` makes every arrow diagonal, `--diagonal 0.5` half of them. A **void** cell is written
  `row:col:V:-1` (a clue with no arrow and no number): nothing goes there. It is not shaded and not on the loop, arrows skip over it when they
  count (as they skip clue cells), and a shaded cell may touch it. Everything (solver, rules, hints, GUI, print, generator) supports voids;
  the rest of the code simply treats them as clues with `n < 0`, which have no line and no count.
- **Regional puzzles**: no arrows and no clue cells. A tenth CSV column, `regions`, gives each cell's
  region id (ids joined by `.`, row-major), and a region's number is written `row:col:G:n` (the number sits in that cell and counts the
  cell's whole region; a region may have no number). `compile` turns a region clue into an ordinary clue whose line is the region
  (`P.regional`, `P.regionOf`, `P.regionCells`, `P.labelAt`), so the exhaustive solver and most rules work unchanged; `regionDeduce`
  (rating.js) is the placement rule for a two-dimensional line. Generator: `generateRegional` (a unique loop with independent boxes,
  random regions, a climb that moves border cells, then number pruning); tool: `node tools/generate.mjs --regional --size 8x8 --avg-size 4`.
  The Regional books are layout-first instead: `tools/regional_layouts.mjs` (rooms, symmetric, dominoes, tetrominoes, pentominoes),
  `tools/cpsat_regional.py` (OR-tools) and `tools/regional_json_to_pool.mjs` (checks, drops numbers, rates); see `experiments/regional/LAYOUTS.md`.
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
| `js/palettes.js`, `js/palette_presets.js`, `js/colormath.js` | Line palettes for "Color separate lines": presets (generated by `tools/make_palettes.mjs`), custom palettes, Lab color math and a color-blindness simulation |
| `js/main.js` | App controller: books, pager, marks, undo/redo, saves, settings |
| `tools/overnight.mjs` | Many puzzles per board size in resumable chunks with a stop time and a summary (`tools/library/overnight/`), for long unattended runs; `build_book.mjs --dir <pool dir> --glob <prefix>` turns a pool directory into a book |
| `tools/generate.mjs`, `tools/build_book.mjs` | Fill pools in `tools/library/` (git-ignored), then assemble `data/<book>.csv` |
| `tools/audit_books.mjs` | Independent audit of every shipped puzzle (valid stored solution, exactly one solution proved by the sound rules or an exhaustive search, no duplicates, manifest counts; `--rate` also re-checks tiers and scores). Run before publishing |
| `tools/bench.mjs` | CPU timings of the exhaustive solver, rating and generation, with a fingerprint of every output (proves an optimization changed speed only; `--js DIR` compares with another copy of `js/`; see `experiments/optimization/REPORT.md`) |
| `tools/rate_puzzles.mjs` | Rate every puzzle in a CSV and print tier, score and rule usage (`--steps` lists each step) |
| `tests/` | `node --test tests/*.test.mjs`; `reference_solver.mjs` is the slow cross-check |
| `data/manifest.json` | The books shown in the app, their groups and sub-categories, labels, blurbs and puzzle counts |
| `docs/how_to_solve.md` | Every rule the Hint button knows, each with a screenshot of the hint at work; the pictures link to the hidden `armory` book (`index.html?book=armory&puzzle=N`, not in the picker: a manifest book with `"hidden": true`). Made by `tools/how_to_examples.mjs scan` then `build` (pick one position per rule by replaying the Hint button: `data/armory.csv`, `docs/examples/examples.json`), `tools/capture_how_to_images.py` (Playwright screenshots into `docs/images/`) and `tools/build_how_to_solve.mjs` (the markdown, with each rule's text from the table above). After a rule change, rerun those three to refresh |

## Difficulty: rules, tiers and score

A rule-based solver solves each puzzle the way a person would: it always applies the easiest applicable rule and never
looks at the stored solution. A puzzle's **tier** is the tier of the hardest rule it needed, its **score** the weighted
sum of the costs of the steps taken (+100 per undecided cell if the rules get stuck, which makes it Expert, "beyond the hints"). Costs are integers and every rule costs something, bookkeeping included.
The table lives in `js/rating.js` (`RULES`); re-binning a rule or changing a cost is a one-line edit, and the order a person meets the rules in follows from the costs (ties: table order). After changing costs, run `node tools/rescore.mjs` to refresh the stored scores in the books. Costs were reworked 2026-11-14 after Josh reviewed the order (integers, bookkeeping costs 1, Hard rules several times Medium, so a puzzle with one Hard and one Medium step scores well below one with two Hard steps) and again 2026-11-21 after a review of how often each rule fires: the chain and parity rules were split by size (their short cases are Medium), "imagine a dot", "a segment starves a clue" and Josh's chokepoint rule were added, and the rules whose arguments grow (`shadeForcesLines`, `segmentForcesLines`, `parityForces`, `dotForcesLines`, `tryCell`, `tryEdge`) add an extra cost per line, open end or step past their Medium split, in the score only (the order uses the base cost). The eight "imagine" rules flagged `costly` in the table are left out of the generator's solvability check and of the closure inside `tryCell`/`tryEdge`, which keeps both as fast as before; the rating and Hint use them.

| # | Rule | What it does | Tier | Cost |
| --- | --- | --- | --- | --- |
| 1 | `edgesOffShaded` | bookkeeping: a segment touching a box is off (charged once per step in which it had something to do) | Beginner | 1 |
| 2 | `edgeEnds` | bookkeeping: a segment makes both its cells loop cells (dots) (charged once per step in which it had something to do) | Beginner | 1 |
| 3 | `fullCells` | bookkeeping: a loop cell with two segments takes no more (the others are off) (charged once per step in which it had something to do) | Beginner | 1 |
| 4 | `shadedNeighbor` | cells next to a shaded cell are loop | Beginner | 1 |
| 5 | `clueDone` | a clue already has all its shaded cells: the rest of its line is loop | Beginner | 2 |
| 6 | `clueFull` | a clue needs as many shaded cells as it has open cells left: shade them all | Beginner | 2 |
| 7 | `clueTight` | a clue still needs r >= 2 boxes and its open cells (not touching a box) form odd-length runs that hold exactly r boxes between them (a run of 2m - 1 cells holds m, on every other cell): boxes go on every other cell of each run, dots between them. The special case of `cluePlacements` seen at a glance; Nikoli's setters use it a lot | Beginner | 3 |
| 8 | `rangeSameOne` | two clues in a line point the same way with exactly one cell between them: that cell holds (first number - second number) boxes, so it is a box if the difference is 1 and a dot if it is 0 | Beginner | 3 |
| 9 | `deadEnd` | a cell with fewer than two exits cannot be on the loop: shaded | Beginner | 4 |
| 10 | `forcedExits` | a loop cell with exactly two exits left uses both | Beginner | 4 |
| 11 | `tightCell` | a neighbour has only two cells it can ever connect to (board edge and clue cells around it: a corner, clues touching diagonally, a gap between two clues): a box here would leave it one way out and it cannot be a box itself, so this cell gets a dot. Seen at a glance. Beginner since 2026-11-21: it is board geometry, and it was the only Medium step in a quarter of the 8x8 book | Beginner | 5 |
| 12 | `noEarlyClose` | a segment joining the two ends of one path would close the loop while other loop cells are outside it | Beginner | 6 |
| 13 | `sameSegmentExits` | a loop cell has three ways out and two of them lead to the two ends of one path: using both would close the loop early, so it uses the third. The same kind of step as `noEarlyClose` | Beginner | 7 |
| 14 | `closingCell` | a cell has only two ways out and both lead to the two ends of one path: using them would close the loop early, so the cell is a box. The same kind of step as `noEarlyClose` | Beginner | 7 |
| 15 | `deadEndNeighbor` | shading a cell would strand a neighbour (given the marks so far): the cell is loop | Medium | 10 |
| 16 | `cluePlacements` | try every way to place the clue's boxes without two touching: a cell they all use is shaded, a cell none uses is loop | Medium | 12 |
| 17 | `placementDeadEnd` | `cluePlacements` that throws out placements which would strand a neighbour: boxes in them are tried against the dots they create, and a placement that leaves a cell next to a box with fewer than two exits is dropped. E.g. a 2-arrow down the right edge with room in rows 12, 14 and 20: boxes in rows 12 and 14 would leave row 13 (wall on one side) with one way out, so one box is in row 20 | Medium | 14 |
| 18 | `shadeShortChain` | the easy cases of `shadeForcesLines`: the imagined box makes one cell end up with three lines, and only a couple of the forced lines are needed to get there (at most 2, `SHORT_CHAIN` in `js/rating.js`; a cell with two ways out draws both lines, but only the one that feeds the contradiction counts). Longer or messier contradictions (a stranded cell, two separate cells filled, the loop closing early) are left to `shadeForcesLines` and `shadeClosesLoop`, which are Hard. Hint draws just the lines that matter, dashed | Medium | 15 |
| 19 | `boxStarvesClue` | imagine a cell shaded: boxes never touch, so its open neighbours would be dots. If that takes so many open cells out of a clue's line that the boxes it has plus the open cells it has left fall short of its number, the cell is a dot. E.g. a 1-arrow down a diagonal whose cells are F3, G4 and H5, with H5 on the loop: a box at G3 would turn F3 and G4 into dots and leave the arrow nothing to count, so G3 is a dot. Only the dots right next to the box count; `boxStarvesClueByLines` is the version that follows lines | Medium | 16 |
| 20 | `closingNeighbor` | imagine a cell shaded: its undecided neighbour would be a dot whose only two ways out lead to the two ends of one path, so using both would close the loop early. The cell is a dot (`closingCell` one step removed) | Medium | 20 |
| 21 | `dotShortChain` | imagine a **dot** on a cell that a clue counts and follow the easy consequences for at most 4 steps: a clue then needing every open cell it has left (or exactly every other one), dots next to boxes, dead ends, cells with two ways out using both. If that breaks something (boxes touch, a cell is stranded or gets three lines, a clue can't reach its number, the loop closes early, an area is cut off with an odd number of open ends), the cell is a box. The mirror of the "imagine a box" rules. When the dot's first consequence is just "that clue's one other open cell is its last box", it is the same as imagining that box, so it is told that way: "a box at X would complete the clue, so the cell is a dot, and then ... So X is a dot" (the clue itself then makes the first cell a box). E.g. a dot at I9 would make the 1← clue at L9 need J9, and the lines that follow cut off an area with 3 open ends | Medium | 21 |
| 22 | `twoEndsJoin` | the easy case of `pairedEnds`: a sealed-off area has just two open ends, so they join each other, which makes their far ends the two ends of one path: nothing may join those (a segment between them, or a cell whose only two ways out they are) | Medium | 22 |
| 23 | `chokepoint` | (Josh's "two gates") imagine a segment missing or a box: if that leaves one cell as the only way between two parts of the board that both hold loop cells, the loop could not get in and back out (it passes through a cell once), so it is the other way. For a part of at most 12 cells. E.g. FRAME-IRR-MIX-10x10-1: the area G2-I3 joins the board through G3 and I3, so without the segment I3-I4, G3 would be the only way in, and I3 goes down. Also part of the contradiction check, so trial and error knows it | Medium | 23 |
| 24 | `rangeSame` | two clues in a line point the same way with two or more cells between them: those cells hold (first number - second number) boxes; use that range like a clue | Medium | 24 |
| 25 | `shadeFewLines` | `shadeForcesLines` when at most 3 of the forced lines matter (any kind: three lines or a stranded cell; `shadeShortChain` is the 2-line, three-lines case). About two in five of the old `shadeForcesLines` steps | Medium | 25 |
| 26 | `segmentShortChain` | `segmentForcesLines` when at most 2 of the forced lines matter (the lines the contradiction rests on, as Hint draws them) | Medium | 26 |
| 27 | `boxStarvesClueByLines` | the same imagined box, but the dots come further: a neighbour of the box that is left with exactly two ways out (a cell on the edge, say, with a box on its other side) must use both, and the cells at the far ends of those lines are dots too. Those forced lines are not as obvious as the dots next to a box, but it is one forced step, so it is late Medium (Hard until 2026-11-21) (which only counts the dots next to the box). E.g. a 1-arrow pointing left along the bottom row with B8 on the loop: a box at B7 leaves B8 only A8 and C8, so both are dots and the arrow has nothing to count; Hint draws the forced lines dashed | Medium | 27 |
| 28 | `rangeFacingKnown` | two clues point at each other and so split the line into three parts: between them (seen by both) and beyond each (seen by one). When one part holds a known number of boxes (filled in, or no room for more), the other two follow (first = between + beyond second, second = between + beyond first); place them like clues | Medium | 28 |
| 29 | `parityPocket` | `parityForces` when the area cut off is a small pocket: at most 3 open ends and 9 cells, so it can be seen at a glance | Medium | 28 |
| 30 | `regionPairs` | (regional puzzles) two neighbouring numbered regions together: every way to place both numbers of boxes without touching includes (or leaves out) a cell | Hard | 45 |
| 31 | `rangeFacing` | the same when no part is exact: how many boxes fit in each part (bounds from the room each has) still pins how many each part holds. Moved before the chain rules on 2026-11-21 (it is counting along one line) | Hard | 48 |
| 32 | `colorBalance` | colour the board like a chessboard: the loop alternates colours, so light boxes minus dark boxes is fixed (light cells minus dark cells); with the range of the total number of boxes (known in regional puzzles) that can fix how many boxes each colour holds, and settle a whole colour's open cells. Arrow puzzles too since 2026-11-21: there the total is open, so it only fires in endgames (in about 1 puzzle in 20 to 100) | Hard | 50 |
| 33 | `chokepointArea` | `chokepoint` when the part cut off is larger than 12 cells | Hard | 62 |
| 34 | `shadeForcesLines` | (firings come shortest chain first) imagine a cell shaded and add the lines that forces (a loop cell with two exits uses both): if a cell ends up with three lines or too few ways out, the cell is a dot. The cases with at most 3 lines that matter are `shadeFewLines` (Medium); here the score adds 2 per line that matters past 3 | Hard | 70 |
| 35 | `boxStarvesClueByPlacements` | imagine a cell shaded and follow only the lines it forces (as in `shadeForcesLines`); if some clue's line is then left without room for the boxes it still needs, the cell is a dot. Room is counted along the whole line in one pass (so long lines work, unlike `placementDeadEnd`): boxes never touch, and two cells one apart cannot both be boxes when the loop cell between them would keep fewer than two ways out. Hint: names the starved clue, the groups of cells that each hold at most one box, and draws the forced lines dashed (the column F argument of the logic-masters 20×20 puzzle) | Hard | 72 |
| 36 | `segmentStarvesClue` | `boxStarvesClueByPlacements` for a segment: imagine it drawn (or missing) next to the known loop and follow the forced lines; if the lines are fine but a clue's line is then left without room for its boxes (counted as in `boxStarvesClueByPlacements`), the segment is the other way | Hard | 74 |
| 37 | `shadeClosesLoop` | the same imagined box, but the forced lines close the loop while other loop cells lie outside it: the cell is a dot | Hard | 75 |
| 38 | `dotForcesLines` | `dotShortChain` with no limit on the steps; the score adds 2 per step past 4 | Hard | 78 |
| 39 | `segmentForcesLines` | `shadeForcesLines` for a segment: imagine it missing (or drawn) next to a loop cell and add the forced lines; if a cell is left with three lines or too few ways out, the segment is there (or is not). E.g. a dot with three ways out that cannot skip the left one without a contradiction uses it. The cases with at most 2 lines that matter are `segmentShortChain` (Medium); here the score adds 2 per line past 2 | Hard | 80 |
| 40 | `segmentClosesLoop` | the same imagined segment, but the forced lines close the loop early | Hard | 85 |
| 41 | `crossingParity` | the loop crosses the border of any rectangle an even number of times (every loop cell has exactly two segments): when all but one crossing is settled, the last is forced. Checked for small rectangles, corner-anchored ones and full-width or full-height bands (janko.at's "parity rule 1": a row or column cut, and the quadrants of a row/column cross). Placed just before `parityForces`, so a cut is shown before a large area's count | Hard | 90 |
| 42 | `parityForces` | a move (a cell shaded, a segment drawn or missing) would cut off a group of cells that can still be joined and holds an odd number of open ends (cells with one line that still need a second), which can never be completed: it is the other way. A small pocket is `parityPocket` (Medium); here the score adds 2 per open end past 3. Firings come smallest area first | Hard | 95 |
| 43 | `pairedEnds` | the same with four or six open ends: list every way to pair them up, drop those that close the loop early (e.g. joining the two ends of one little path), and see what is left in common: in every remaining pairing two ends outside the group become the two ends of one line, so a segment between them is not there. (Two open ends: `twoEndsJoin`) | Hard | 110 |
| 44 | `uniqueRoute` | **assumes the puzzle has one solution.** A group of cells that can still be joined, all of them known loop cells, holds open ends that must be paired up through it. A pairing that can be drawn two different ways over the same cells would give two solutions (the boxes, so the clue counts, do not change), so it is not the real one; what is left may settle segments. E.g. two dots side by side between two open ends above and two below: they cannot join each other | Hard | 125 |
| 45 | `tryCell` | assume a cell is shaded (loop), follow the rules above to a contradiction: it is the other. The score adds 2 per step of the chain it follows (an 8-step trial costs 156, an 80-step one 300) | Hard | 140 |
| 46 | `tryEdge` | the same for a segment (on / off); the score adds 2 per step of the chain, as for `tryCell` | Hard | 160 |

The table is in the order a person meets the rules (cheapest first; the Hint button and the rating use this order). The three bookkeeping rules are applied before every step: a segment touching a box is off, a segment makes both its cells loop cells, and a loop cell with two segments has no others. They are not shown as hints but they cost something, like every rule.

**Special cases.** `uniqueRoute` assumes the puzzle has exactly one solution (it is never used by the generator or by anything that takes "solved by the rules" as proof of uniqueness). `tryCell` and `tryEdge` are trial and error.

A *contradiction* is two touching shaded cells, a group of cells that can still be joined holding an odd number of open ends (every segment still to be drawn adds one end to each of two cells in the same group, so each group must hold an even number), a clue
with too many or too few possible shaded cells, a loop cell with fewer than two exits or more than two segments, or a loop
closed while other loop cells lie outside it.

Calibration against the borrowed puzzles (private, see below). With the first nine rules, every site Easy and Medium
puzzle rates Medium here (each needs `noEarlyClose`) and all four site-Hard ones need `tryCell`. After adding the patterns
Josh described (`cluePlacements`, `shadeForcesLines`, `rangeSame`, `rangeFacing`), three of the four site-Hard puzzles
solve at Medium, without trial-and-error lookahead (`shadeForcesLines` does the work), and only one still needs `tryCell`
(9 uses, down from 24). With `shadeForcesLines` moved to Hard (Josh: "would force a line end to do two incompatible things"; the site's puzzles just do not need it much), three site-Hard puzzles rate Hard again. Open questions: `noEarlyClose` is taught early by the site's own tutorial and probably belongs in Beginner, and the Easy/Medium split looks driven by board size and clue density more than by technique.

### How the generator works

1. **A loop that is unique by construction** (`tightLoop`). Clues can only decide which non-loop cells are boxes, never how the loop
   routes through the others, so the hole pattern itself has to admit exactly one loop. Alternative loops come from two flips (one
   splits the loop in two, a second merges the halves again): each 2x2 block with two parallel loop edges is a *chord* of the cycle,
   and two interleaving chords give another loop (`crossingChords`: a loop with a crossing pair is never unique, one without was
   unique every time in testing). `tightLoop` starts from a random loop with few holes and adds hole pairs beside a crossing, keeping
   a move only if the crossing count drops. Random loops are unique 55% of the time at 8x8 but almost never beyond 14x14; this builds
   a verified-unique loop at every size, 12x12 to 20x36, in under half a second with 24-28% non-loop cells (Nikoli: about 28%).
2. **Clues aimed at the rules.** The non-loop cells become boxes (a non-touching subset) or clue cells; simulated annealing re-aims
   clues and moves clue/box roles until the human rules (no trial and error) solve it. The rules are sound, so a puzzle they solve is
   unique with no exhaustive search. The climb uses only the cheap rules and asks the full set when few cells remain (on a stuck
   20x36 board: 4 ms instead of 112 ms).
3. **Style knobs** in the same climb: `--edge-bias` (arrows toward the nearer edge, Nikoli 66-84%), `--one-dir`, `--numbers big|small`,
   `--max-tier medium`. The climb's objective includes how far the puzzle is from the requested style.

Rating a generated puzzle is instant (a 20x36 takes under a second).

### Hint button

Hint runs the same `nextSteps` the rater uses on the player's marks (shaded = shaded, dot = loop, segment = on), so it shows how the draft solver thinks and where it gets stuck. It first reports marks that are wrong (red); otherwise it shows the easiest available step: the rule id, tier, weight and time, a sentence, the cells it looks at (blue) and the move as dashed ghost marks. Pressing Hint again steps through the other firings of the same rule. If no rule has a step it says the solver is stuck and tints the cells it still cannot decide. Clicking anywhere dismisses the message; any change to the board clears it. Highlights have roles: blue clue and the cells it counts, a yellow ring for the cell being decided, a hatched cell where the box would cause trouble (the neighbour it would strand, or the dots it would leave a clue short of room), dashed green outlines for its remaining ways out, purple for the two ends of a path, dashed orange lines for the segments an imagined box would force (the lookahead rules show how it goes wrong); ghost segments are shortened so a dot underneath stays visible, and a red cross means "no segment here".

### Settings

Dark mode; **Color separate lines** (each separate piece of the loop gets its own color; colors stay with their lines: a new line never recolors the others, and joined lines keep the color of the one started first, see `js/pathcolors.js`; the **Line colors** choice under it picks the palette: *Default* (24 colors, in an order made for a player with few lines: the first three are about 100 apart in Lab distance, the first eight over 40, and the three kinds of color blindness are taken into account with a lower bar; the white and the dark board each have their own list), *Red-green color blindness*, *Blue-yellow color blindness*, or *Custom…*, where you click swatches to change colors, add (up to 32) or remove them; colors come into use left to right, and custom colors are lightened automatically in dark mode. The presets are generated by `tools/make_palettes.mjs` into `js/palette_presets.js`: the ORDER is optimized, not only the set: an ordering scores the sum over k of (smallest distance among its first k colors) / k, so the first few colors weigh most; it is found by a greedy start from every possible first color, then polished by replacing and swapping colors (distance is Lab distance as the target eyes see it; the default also accepts a third of the gap in the three kinds of color blindness). A new line (or the other half of a split one) is colored for where it is: a color nobody uses beats one in use, and among those the one least like the colors of the lines within five cells wins, nearer lines counting more; when every color is in use the repeat goes as far as it can from lines of that color and of colors that look like it (as the palette's target eyes see it). Colors still never change once given; see `js/palettes.js` and `js/colormath.js`); **Automatic dots** (a dot in every cell next to a box and in every other cell of a clue that has all its boxes, including 0-clues from the start; drawn fainter, each remembers why it exists and goes away when its last reason does, so taking a box off removes the dots it caused; dots you place are never touched; switching it on or off acts on the board at once). An arrow turns green when its boxes are all there, and also when another arrow pointing the same way further along its line covers it (e.g. a 3 with two boxes before a 1 that points the same way: it has nothing more to tell you; see `js/clues.js`). Always on, no setting: columns get letters and rows numbers (cell E3 is column E, row 3, the same names the hints use); the labels of the cell under the cursor are bold and blue, and every arrow that counts that cell gets an outline; a tall board is shown sideways when that gives bigger cells (the Turn button above the board turns one by hand); resting the pointer on the end of a line rings both of its ends, unless the line branches (`js/lineends.js`). The settings dialog keeps the real settings apart from its Tools (load puzzles from a file, print) and Your progress (clear saves) sections. Right-click puts a box on a cell. A cell with three lines is outlined in red (drawing it is allowed, so you can see the mistake).

## Calibration puzzles

A few dozen puzzles from other sources and from a printed Nikoli book were used **privately** while building the solver and the
scorer: to check that the solver agrees with their published solutions (every one has exactly one solution under our reading of
the rules) and to calibrate the Beginner / Medium / Hard tiers. They are not part of this repository (a scan of the whole history
finds none of them) and none is in the app: every puzzle you can play here was generated by this program.
