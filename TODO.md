# TODO

Order follows the pattern in the sibling projects (see README).

1. **Scorer** (`js/rating.js`): first rule table done (it solves all 12 borrowed puzzles). Next: play puzzles with Josh and
   record the inferences he makes, add the missing rules, settle where `noEarlyClose` belongs, tune weights. Original plan: a rule table (rule, tier, weight) and a human-style solver that always applies the
   easiest applicable rule. Seed it with the techniques from PuzzleMadness's tutorial (0-clues make loop cells, a loop
   cell with two exits, dead ends become shaded, shaded neighbours become loop, forced clue shading, a closing loop can't
   skip cells) and then add rules by playing puzzles with Josh and writing down the inferences he makes. Compare the
   tiers it gives the 12 borrowed puzzles with the site's own Easy/Medium/Hard labels.
2. ~~Hint button~~ done (one-press, shows the solver's thinking). Possible later: two-press step-by-step hints like polyomino-panel, peeks when stuck.
3. **Generator**: random loop, shade cells off it, add clues, strip clues while the solution stays unique. Verify with
   the exact solver. Then pools in `tools/library/`, `tools/build_books.mjs`, recipes, `rescore`/`rerate`.
4. **Books**: manifest, book picker, Browse grid by tier, print booklet, offline play (as in polyomino-panel).
5. GUI polish: edge crosses ("no line here"), clue-satisfied coloring options, touch testing.
6. Solver speed for bigger boards (the generator will call it a lot): consider a WASM or tighter implementation only if
   measured to matter.

## Scaling to Nikoli-size boards (up to about 20x36)

Measured 2026-11-14 on 36x20 boards (no generator yet, so on feasible sparse boards, not real puzzles):
- `logic.solve` finds a first solution in about 90 ms, so plain search is fine on a sparse board. A 14-clue 36x20 board with
  no solution took 83 s to prove infeasible: uniqueness checking on a big board needs stronger pruning (use the rating
  rules' deductions as propagation, better branching) before the generator can lean on it.
- `rate()` takes 145-175 s on a stuck 36x20 board: each lookahead attempt reruns every rule over the whole board. Needed:
  dirty tracking so a closure only re-runs rules whose lines/cells changed, only trying cells/segments near the frontier,
  and caching the placement counts. (`rangeDeduce` already counts instead of enumerating: a 36-cell line is instant.)
- The GUI draws cells at a fixed size scaled to a 640px column: 36 columns would be ~17px a cell. Needs a wider board
  container and/or zoom and pan.

## Generator and books

- [ ] **Frame by constraint solving** (`tools/cpsat_frame.py`, holes from `tools/frame_holes.mjs`): numbers are chosen first (every arrow N, or one number per line), OR-tools plants boxes that give them,
  the loop builder makes a loop that is unique for holes that include those boxes, then a local search over which holes are voids looks for one solution. Works on small boards (10×10 with 2s, 14×14
  with 1s), but at 12×12 and up the nearest other solution stays 8 or more edges away, and planting many boxes often leaves the loop builder with no loop. Ideas: let the solver also change which cells are
  on the loop (CEGAR on the loop set), or build the voids around the solution (sparse arrows first, then add voids that kill the nearest alternative). Samples: `data/frame-experiment.csv`.
- [ ] **Layout experiments** (`js/generator_layouts.js`, `generate.mjs --layout symmetric|frame`). Symmetric is in as two small Bonus books. Frame (every border cell an
  inward arrow or a void, only boxes and voids inside) generates unique puzzles at 8×8 to 12×12, but its numbers stay 0 to 2 and the arrow at one end of a row repeats
  the one at the other. The logic-masters.de example Josh remembers had mostly voids and all clues 6 on a big board; a local search for "every arrow says N" found nothing
  (0 of 6 at 10×10 to 14×14), so try building the box pattern first (N per line) or a mostly-void frame. Also wanted: at-least / at-most arrows, two-way and four-way
  arrows, number-only clues, regional plus arrows (order agreed 2026-11-21).
- [ ] **6×10 pentomino book** (Josh, 2026-11-22: the 12×5 Pentominoes book is a hit). The twelve pentominoes also tile a 6×10 board (about
  2,300 tilings, so plenty of layouts): `KINDS=pentominoes SIZES=10x6 START=101 SEEDS=110 COUNT=4 TIME=120 sh tools/make_regional_layout_pools.sh`
  (`polyominoLayout` with `distinct` already handles any 60-cell board), then add `10x6` to the pentominoes sizes in `tools/build_regional_books.mjs`.
  Check the tiling search speed at 6×10 (12×5 takes under a second to a few seconds) and the Medium share (12×5: 93 of 100).
- [ ] **16×16 symmetry books** (planned for the night of 2026-11-22; `nohup sh tools/run_symmetry_16x16.sh > /dev/null 2>&1 &` starts the wait for 22:00): a 16×16 Symmetry mix (exact: mirror, diagonal mirror, quarter turn, half turn; 60) and a 16×16 Symmetric layout book (clue cells symmetric: half turn, quarter turn, mirror, diagonal mirror; 120), pools in `tools/library/xsym_*` and `lsym_*`, log `tools/library/symmetry16.log`. Check the tier spread (everything at 16×16 tends to be Hard), the audit and the tests, then ask before committing.
- [x] **16×16 bonus books** (done 2026-11-22): the long way round, one direction, all zeros, no zeros; 250 each, built overnight by `tools/run_bonus_16x16.sh`
  (Medium/Hard about half and half; all zeros 43/136/71). The Bonus picker is grouped by gimmick again. Not tried: 20×20 (expect several times the 16×16 cost).
- Larger boards (14x14 up to Nikoli's 20x36). Measured 2026-11-14: 10x10 takes seconds, 12x12 about 10-50 s, but 14x14 and 16x16 did
  not finish in 15-25 minutes per puzzle. The loop generator is fast even at 36x20 (about 0.5 s); the climb over clue directions
  is what stalls (loop and holes are fixed, so only informative clue placement can help). Ideas: re-roll the loop's holes during the
  climb, allow pre-placed boxes as extra information, more local moves (swap a clue and a box), parallel restarts, accept a
  bigger undecided region once lookahead (`tryCell`) is cheap on big boards. Rating is not the problem: it is fast on generated puzzles.
- Tier targets: every generated puzzle so far rates Hard because the generator's solvability check includes `shadeForcesLines`
  and `rangeFacing`. `generate.mjs --max-tier medium` limits the rules; make Beginner/Medium pools and a real `build_book` with tier shares.
- Pre-placed boxes in the generator (the format, solver, rater, checker and GUI already support them).
- Bonus books / modes (ideas): *Boxes given* (some boxes pre-placed, fewer clues); *Sparse* (as few clues as the rules allow, the
  pruning pass); *Symmetric* (rotationally symmetric loop and clues); *Zeros only* style puzzles (clues are all 0s and 1s: a gentle intro);
  *Giants* (20x36); *Beginner tour* (small boards, one new rule per puzzle, which doubles as the tutorial); *Mixed* (the daily-style
  Easy/Medium/Hard split by board size). Like polyomino-panel's Bonus books these are built from the same pools with their own recipe.
- Bonus book ideas from Josh (2026-11-14), for future exploration:
  - *All zeros*: every clue is a 0 arrow (no boxes counted at all; the puzzle is pure loop reasoning plus where boxes can hide).
  - *Big numbers only*: the smallest number on any arrow is large, maybe > 0 or even > 1 (no cheap 0 and 1 clues to lean on; the existing
    `numbers: 'big'` style weighting is a start, but a hard floor on the number is a different constraint).
  - *Diagonal arrows* (maybe?): arrows may also point along diagonals. Needs a new ray definition in the logic, the rules (ranges become
    diagonal lines, boxes on a diagonal can touch only at corners, which is allowed) and the GUI; a much bigger change than the others.

## GUI ideas not done yet

- Parity of open ends: done (`parityForces` rule and part of `contradiction()`; Josh's definition: an open end is a cell that has one segment but still needs its second). It is sound but rarely the easiest rule on the puzzles we have.
- Two-press (step-by-step) hints like polyomino-panel; a "peek" when the solver is stuck.
- Edge crosses ("no segment here") as player marks.
- Three lines into a cell: currently allowed and outlined in red. Alternative: drawing a third line removes the oldest.
- Book picker modal: done (a button with the current book's name opens sections of books with blurbs and solved counts, like polyomino-panel's; the old dropdown is gone). Books removed from the list 2026-11-14 (files kept in `data/`): Large (draft), Large (Nikoli-style), Difficulty samples.
- Default books (2026-11-15; formerly the "Nikoli-style" books, renamed 2026-11-15 to the plain sizes 8x8, 12x12, 16x16, 20x20, 20x36, ids and puzzle names without Nikoli branding): 1000 puzzles each at 8x8, 12x12, 16x16, 20x20 and 20x36, from the overnight run (generate settings: edge bias 0.8, shade 0.7, tight arrows 0.5 per 100 cells), easiest first within each book. Everything from 16x16 up is Hard; only 8x8 and 12x12 have easier puzzles. To think about: a real Beginner/Medium Nikoli-style ladder (generate with a rule cap at the larger sizes). The 25-puzzle 'Experiment: Nikoli imitation' book was removed 2026-11-15 as redundant with these (its pools are still in `tools/library/imit_*.csv`).
- Puzzle selector modal: done (the Browse button next to the pager; it augments the prev/next arrows and the number box). A grid of numbered
  tiles for the current book, solved / in progress / current, a summary line, "First unsolved", and section headings by tier (if the book runs
  through tiers in order) or by board size. Modeled on polyomino-panel's `renderBrowse()`. Not done: a tier/size filter, keyboard navigation of tiles.
- Cell and line interaction (Josh, 2026-11-14): DONE (agreed 2026-11-14; `js/marks.js`). Today the tap cycle is empty -> dot -> box -> empty, a line
  passing through a cell leaves its mark alone (a dot under a line is hidden), and shading a cell erases the segments at it (so a lined cell
  already becomes a box after TWO taps, the first of which is invisible because the new dot hides under the line). Proposal: a cell with a
  segment is already "on the loop", so the dot state is skipped for it: tap on a lined cell = box (its segments are erased, one undo step
  brings everything back), then empty, then the normal cycle. Whether a dot was there before the line does not matter: dots are the player's
  claims, kept (hidden) under lines, replaced when the cell becomes a box, never restored automatically (undo does that). Right-click already
  toggles a box on any cell. Open: erase silently (proposed, undo covers it) or only when the cell has at most one segment.

## Other grids (hex)

Possible, but not with the current code as it stands: `logic.js` assumes a square grid (four directions, edges named by `2*i` and
`2*i+1`, rays along rows and columns, a bipartite grid for the loop generator). polyomino-panel solved the same problem with a
`topology.js` (neighbours, edge kinds, symmetries, geometry per grid) that every rule loops over. The plan would be the same: a
topology object (six neighbours, six arrow directions, rays along the six lines), rules written once over `dirs`, SVG geometry from the
topology. Differences that matter: on a hex grid the loop uses two of six exits per cell; shaded cells may not touch (six neighbours);
the cell graph is not bipartite, so the 2-factor generator needs another method (cycles in the triangular lattice, or a grow-and-merge
approach); `rangeFacing`/`rangeSame` generalise to the three line directions; "deadEnd" and "tight cell" change meaning since cells
have more neighbours. A day or two of work, best done as its own project phase after the square-grid rules settle.

## Learned from three real Nikoli puzzles (20x36, from photos of the answer key; all verified by the solver)

| | nk_99 | nk_105 | nk_102 | our generated 14x14 |
| --- | --- | --- | --- | --- |
| clue cells | 12.4% | 12.8% | 12.9% | 14-15% |
| boxes | 15.7% | 13.9% | 13.5% | 10-12% |
| zero clues (of clues) | 9% | 23% | 12% | 36% |
| mean clue number | 2.4 | 1.6 | 1.9 | 1.1 |
| mean ray length | 9.0 | 6.6 | 8.4 | 6.9 |
| touching clue pairs | 44 | 20 | 0 | few |
| arrows U / R / D / L | 24/41/5/19 | 18/24/14/36 | 22/41/9/21 | about equal |
| hardest rule | parityForces (Hard) | rangeSame (Medium) | tryCell (Hard) | parityForces / shadeForcesLines |

What holds across all three: about 12-13% clue cells (ours a little high), more boxes (14-16%, ours 10-12%), far fewer zero clues
(9-23%, ours 36%), bigger numbers (1.6-2.4, ours 1.1). What does not: clue stacks (nk_102 has none touching, but is built from regular
diagonal lattices of "1 right" clues, so Nikoli designs patterned layouts too) and the arrow mix: each puzzle leans on one horizontal
direction (right in 99 and 102, left in 105) and uses down least. A "dominant direction" per puzzle is a cheap generator parameter.
Rating each takes about 0.1 s, so large puzzles are fine for the human-style solver; generation is what is slow.

## Auto-dots

Done: dots for satisfied clues, and each auto-dot's reasons (shaded neighbour 's<cell>', satisfied clue 'c<clue>') so it disappears with its last reason.
Done 2026-11-15: flipping the switch acts on the board: ON puts dots for every reason already there, OFF removes the automatic dots (yours stay); it is not an undo step (Josh: that is excessive), but the undo/redo history is converted the same way so Undo never brings back dots the switch turned off; a save made with dots on shows none while the switch is off. The logic is pure, in `js/marks.js` (`reasonsOf`, `reconcile`, `applyAutoDots`), tested in `tests/marks.test.mjs`.

## Hint to think about (from play, 2026-11-14)

"If H9 sent a line down (column H, row 9... Josh's words: row 9 col 10), then the dot at row 10, col 11 can't be satisfied."
A line-level consequence: drawing one segment leaves a dot cell that cannot get its two lines. `tryEdge` (Hard) may already find it;
check against that exact position (14x14, the screenshot is in the session) before adding a cheaper named rule, and if it is a
pattern, give it a name, a tier and a weight like the others.

## Arrow direction style (edgeBias)

Nikoli's arrows point toward the nearer board edge 66-84% of the time (random: 50%); PuzzleMadness's and our old generator's mostly
point the long way (4-47%). `generate.mjs --edge-bias q` points each clue at the nearer edge with probability q (0.5 = neutral; the
default without the option is the old length-weighted pick). Feasibility at 14x14 (2 seeds each, 4 minutes): none 2/2, 0.5 2/2, 0.75 1/2,
0.9 0/2: strongly edge-ward arrows have short rays and carry little information, so they are harder to make solvable. The opposite
direction (q near 0, long rays) should be easy: a candidate bonus book, "the long way round" (PuzzleMadness-style). A main book at
q = 0.75 would match Nikoli but needs longer runs.

## Rule candidates (researched 2026-11-14)

Sources read: the puzzles.wiki Yajilin page, a Puzzle Magazine walkthrough, rollforfantasy's guide (the UKPL guide and a LIACS
thesis were PDFs the fetcher could not read). Their techniques are all already rules here (tightCell, forcedExits, deadEnd,
shadedNeighbor, deadEndNeighbor, cluePlacements for a 2N-1 run, rangeSame, rangeFacing, noEarlyClose) except one, now added:

- **Done: `crossingParity`** (wiki: "the loop enters and exits any region an even number of times"). Nikoli's nk_99 drops from Hard
  to Medium with it. Generalisation: every non-clue cell has even degree (0 or 2), so the loop is an element of the cycle space and
  *every* region's border parity is a GF(2) sum of those cell equations; Gaussian elimination would find all of them for any shape.
  Too powerful to call human-style, but the shapes people use (L-shapes, staircases, diagonal bands) are a possible next step.
- Chessboard color balance: loop cells alternate colors, so the non-clue cells of each color minus the boxes of that color are
  equal: (boxes on black) - (boxes on white) = (non-clue black) - (non-clue white). Useful in endgames; global, so likely Hard.
  Regionally, a strand inside a region with c crossings can differ by at most c/2.
- Loop-aware clue placements: `cluePlacements` only forbids touching boxes. The wiki's "an empty 2x3 holds at most two boxes" is
  really about the loop: three diagonal boxes in 2x3 strand the middle cell. Enumerating placements while rejecting any that leave a
  cell with fewer than two ways out would find more. nk_102 (still needs `tryCell`) may be waiting on something like this.
- Two-clue stacks: clues of 1 pointing the same way on adjacent lines (nk_102's diagonal lattice) give strong `rangeSame` chains;
  worth checking whether a chain of three needs its own, cheaper, name.

## Rule review (2026-11-21)

Done: a usage study of every rule (120-150 puzzles per book, step by step), then, with Josh: `tightCell` to Beginner (5); `rangeFacing` to 48
(before the chains); `boxStarvesClueByLines` to late Medium (27); `crossingParity` to 90 (before `parityForces`); the chain and parity rules
split by size into Medium cases (`shadeFewLines`, `segmentShortChain`, `parityPocket`, `twoEndsJoin`); "imagine a dot" (`dotShortChain`,
`dotForcesLines`), `segmentStarvesClue` and Josh's chokepoint rule (`chokepoint` / `chokepointArea`: one cell as the only way into an area with loop cells; also in `contradiction()`) added; colour balance on for arrow puzzles; extra score per line / end / step for the long cases
and for `tryCell`/`tryEdge`. On the samples, Hard went 83% -> 27% at 12x12, 96% -> 43% at 16x16, 98% -> 68% at 20x20; the 8x8 book gets
about 30% Beginner. The eight costly "imagine" rules are skipped by prefix closures (generator, `tryCell`), so generation is as fast as before.
Books and pools rescored and re-sorted (puzzle numbers changed), and `docs/how_to_solve.md` regenerated with new examples, the same day.
Open:
- The Hint panel's colour key reuses role names that read oddly for the chokepoint rules ("the cells it counts" for the cut-off area,
  "where the box would cause trouble" for the only way in): give those roles labels per rule.
- An Expert tier for puzzles that need trial and error or very long chains: a janko.at sample (31 puzzles up to 20x20) needed `tryCell` in
  3 of 4 at levels 7-8 and 1 of 26 below; the generator would have to accept such puzzles for the books to have any.
- Calibrate the tiers and costs against janko.at's human difficulty levels (620 Yajilin with solutions in the page source; keep them private).
- Untested ideas from the review: two neighbouring parallel clue lines placed together (the puzzles.wiki "2x3 holds two boxes" argument);
  "forced lines then an odd area" as a named rule (it mostly took over `parityForces` steps in a test, so it was not added).

## Why larger boards are hard to generate (diagnosed 2026-11-14)

The bottleneck is neither the clue/box density nor human-viability: it is that **clues cannot change how the loop routes through the
cells it visits.** The generator fixes the non-loop cells (holes) first; clues only decide which holes are boxes. So a hole pattern
whose remaining cells admit two loops can never become a unique puzzle, whatever the clues.

Evidence:
- Best positions the climb reached on 12x12 up to 36x20 (12 runs, 150 s each): all had every cell decided by the rules (0 open cells)
  yet 2+ solutions, at 19-22% clue density (Nikoli 12-13%).
- A random hole pattern (30% holes) has a unique loop through its other cells in about 55% of cases at 8x8, 30% at 10x10, 15% at
  12x12, 2.5% at 14x14, 5% at 16x16, 0 of 40 at 20x20 (`loopIsUnique` in js/generator.js).
- Early (naive) experiments adding random hole pairs until the loop is unique needed 34-48% holes at 10x10-12x12 and were far too slow
  beyond that: a smarter construction is needed.

**Solved (same day).** A loop with two interleaving chords is never unique, a loop without was unique every time, and `tightLoop`
repairs crossings locally: 12x12 to 20x36 loops in 0.07-0.4 s, and whole 20x36 puzzles in 16-60 s (they never finished before). See
the README ("How the generator works"). Remaining generator work is tuning toward Nikoli's style (see the table below): the new large
puzzles have more clue cells (15-17% vs 12.5%), fewer boxes (9-12% vs 14-16%), smaller clue numbers (0.9-1.6 vs 1.6-2.4) and more zeros
than the three real puzzles; one-direction at 20x20 is slow (15 minutes for some seeds).

## Tuning the generator toward Nikoli's mix (20x36, 3 seeds per setting, 2026-11-14)

| setting | arrows at nearer edge | mean clue number | zeros (of ~110 clues) | clue cells | boxes |
| --- | --- | --- | --- | --- | --- |
| Nikoli (3 real puzzles) | 66-84% | 1.6-2.4 | 8-21 | 12.4-12.9% | 13.5-15.7% |
| A: `--edge-bias 0.8 --shade 0.7` | 66-67% | 1.1-1.4 | 32-41 | 15-16% | 9-12% |
| B/C: A plus `--numbers big --min-mean 1.6` | 39-47% | 2.2-2.6 | 5-8 | 14-16% | 11-13% |
| D: A with `--accept 60` | 66-67% | 1.1-1.7 | 32-41 | 15-17% | 9-14% |

With the current knobs we can match Nikoli's arrow direction (A) or its clue numbers (B/C), not both: the big-number weighting prefers
long rays (more boxes to count), which fights the edge bias. Nikoli does both, so its clues must sit on rays that happen to hold several
boxes while pointing at a near edge. Ideas: a milder number weighting (exponent 1, not 2) alongside the edge bias; choose the box layout
with the clue rays in mind (more boxes along near-edge rays); and the biggest gap, clue cells (14-16% vs 12.5%): the real puzzles
need less than the generator's clues because they lean on harder reasoning (nk_99 needs parity, nk_102 a trial), while the climb only
accepts puzzles the non-lookahead rules solve. Letting it accept a small lookahead (the `acceptU` path) or adding the rules the stuck
images suggest should lower the clue count.

## Queued for when Josh is away (2026-11-15; start when he asks, any order)

All five done on 2026-11-15:

1. ~~Landscape fit for 20x36 boards.~~ `js/rotate.js` turns a puzzle a quarter turn; the page does it automatically when that gives bigger cells in the window
   (Settings: "Turn tall boards sideways", on by default) and has a Turn button to flip one puzzle by hand. Progress is stored in the original orientation.
2. ~~More puzzles in the intro and bonus books; "Skinny".~~ Intro 32, long way round 25, one direction 23, big numbers 23; "Skinny" (29 puzzles, longer side <= 36).
3. ~~New book ideas.~~ Four new Bonus books: all zeros (`--numbers zeros`: only 6x6 to 9x9 are feasible; 10x10 and up found nothing in 3-5 minutes), twos and up
   (`--numbers twos`: slow, a puzzle in a few minutes at 12x12), few boxes (`--boxes 0,0.3 --shade 0.2 --prune 0`: easy to make, often Beginner/Medium at 8-12),
   packed with boxes (`--boxes 0.55,1 --shade 0.85 --density 0.26`: slow, always Hard). "Few boxes" is the most useful for a gentler feel; the box share is a
   soft penalty in the climb (`styleGap`) and a hard check at the end. Recipes: `tools/make_style_pools.sh`.
4. ~~Dead-end-aware cluePlacements.~~ `placementDeadEnd` (Medium, cost 14). The rating of the old books was refreshed; it moved a few puzzles Hard -> Medium.
5. ~~Line recoloring bug.~~ Fixed (`js/pathcolors.js`: each line has an identity with an immutable color; fuzz test in `tests/pathcolors.test.mjs`).

## Next features (Josh, 2026-11-15)
- **Void cells (null squares), first version done 2026-11-15**: a void is a clue with `n < 0` (file token `r:c:V:-1`); the solver, the rules (guards in `rating.js`), hints, GUI (hatched grey square), print (crossed-out grey square), `audit_books` and the generator (`--voids K`: K of the non-loop cells become voids) all handle it; `tests/void.test.mjs` fuzzes soundness (rules = exhaustive solver = stored answer). **Not done yet**: voids that SHAPE the board (placed before the loop is built, so a board can be a plus sign or have a hole in the middle; today a void is a non-loop cell that is neither a box nor an arrow, chosen after the loop), a voids bonus book, deciding how to weave voids into the regular books, rules/hints specific to voids (a void next to the loop just removes exits, which the existing dead-end rules already use), and the semantic choice that arrows count THROUGH voids (Josh to confirm).
- ~~**Print view**~~ done 2026-11-15 (Settings → Print puzzles; see README). Ideas for later: a rules paragraph on the first page of a booklet, a title page, a page range per tier. **Hex grids**, **phone/touch testing after the first push**, further rule tuning.
- **Bonus book sizes (done 2026-11-15)**: standard sizes per book (`tools/make_bonus_standard.sh`, `--sizes` in the builders); Big numbers absorbed Twos and up (twos-and-up puzzles count as big numbers).
- **All zeros at bigger sizes (done 2026-11-15)**: it was never infeasible. The generator's prune step turned arrows into boxes, which landed inside other arrows' lines and broke their zeros, so every pruned puzzle was thrown away at the very end (9x9 was the limit, then). `pruneClues` now skips a prune that would spoil a hard number style ('zeros', 'twos'). All-zero puzzles now take seconds at 10x10 to 16x16 and minutes at 20x20; the book is 10x10, 12x12, 14x14. Zeros puzzles are box-poor by nature (about 6 boxes, a third of the board as arrows). Twos are still slow (minutes per puzzle), so their slowness has another cause.
- **GUI idea: mark "finished" arrows (Josh, 2026-11-15). Automatic part done 2026-11-15** (setting "Mark finished arrows", on by default: a K-arrow turns green when X boxes stand between it and a same-way (K-X)-arrow further on; `clueStates` in `js/clues.js`). Not done: a click to mark an arrow done by hand; extending automatic dots to the cells between a covered arrow and its partner. Original note: When an arrow can tell the player nothing more, show it: for example a 3 pointing along a line that passes a 1 (same direction) with two boxes already placed between the 3 and the 1 (so the 3 has nothing left to say, the 1 is its own clue). Options: (a) colour such an arrow green automatically; (b) let the player click an arrow to mark it done by hand (probably saved with the marks, and undoable); (c) both: green when the board proves it, a manual tick otherwise. Questions to settle first: what exactly counts as "finished" (box count on its line already equals the number and the rest of the line is settled? or only the stricter case above?), whether the automatic version may use only what the player has drawn (not the solution), and whether to offer it as a setting like "Color separate lines".
- **Hint skips silent steps (done 2026-11-15)**: a step whose only effect is "no segment here" (noEarlyClose and friends) cannot be marked, so the hint showed it forever and following the hints stalled in 21 of 55 sample puzzles. `js/hintstep.js` applies such steps silently and shows the next step that gives something to mark, with a "Relies on: ..." line. If we ever add an X mark for "no segment", the hint can show these steps again. Tested end to end in `tests/hintstep.test.mjs`.

## Optimization hunt (2026-11-15; details and numbers in `experiments/optimization/REPORT.md`)
Done: the tightLoop iteration cap (14x14 generation 30x faster), faster rating and exhaustive-solver internals, one-rect board background. Open: the
`--cross-check-nodes` policy for generate.mjs, pruning `placementDeadEnd` (changes ratings), path-based segment drawing and lazy book compile in the GUI,
an incremental `followLines`. Also built: the "Voids" bonus book (36 puzzles; `tools/make_voids_pools.sh`).

## Variants (researched 2026-11-16; Josh's picks)

Survey of Yajilin variants is in the conversation of 2026-11-16 (puzzles.wiki, the WPC wiki, Cross+A, GM Puzzles' Yajilin archive).
Josh is excited by these four; **Regional** is in progress on the branch `experiment/regional` (see its notes below).

- **Regional**: done so far: format (`regions` column, `r:c:G:n`), compile, solver, rules (`regionDeduce`, the placement
  rules work on regions), generator (`generateRegional`, regions grown at random), board/print/hint text, rotation. **Layout-first books
  (2026-11-22)**: the Regional group in the picker (Pentominoes 12x5, Dominoes, Rooms, Symmetric; `tools/build_regional_books.mjs`), made by
  drawing the layout first and letting OR-tools find the solution (`experiments/regional/LAYOUTS.md`). The old 54-puzzle test corpus of grown
  regions was deleted the same day. Next: a Beginner pass (`--tier Beginner` on dominoes or pentominoes: no Regional book has Beginner
  puzzles), tetrominoes (built but only about half Medium), 6x10 pentominoes, 12x12, a lower box density closer to a setter's 16%,
  region-specific rules a person would use (two regions that differ by one cell; a region that must hold a box in each of two disjoint
  groups), pre-placed boxes.
- **Diagonal arrows** (experiment branch `experiment/diagonal`: format `E C Z Q`, rays, pair rules, generator `--diagonal`, board/print/hints, rotation, a 40-puzzle corpus in `experiments/diagonal/CORPUS.md` are done; next: play the corpus, find diagonal-specific techniques, a `bignum` recipe that works, the notes below on a faster `rangeDeduce`): arrows along diagonals. A ray is a diagonal line; boxes on a diagonal may touch at corners (allowed). `compile`
  rays, `posAlong`/`sameLine` and the pair rules (`rangeSame`, `rangeFacing`) need diagonal versions (the DP in `rangeDeduce` already
  works on any ordered list of cells where only consecutive cells can touch: along a diagonal NO two cells touch, so the DP becomes
  "choose any n of the open cells", which is simpler); eight arrow glyphs and a direction set of eight in the generator
  (`pickDirection`, `rayOf`, `plantTightArrows`), rotation turns arrows by 2 of 8 steps, CSV `dir` letters need diagonals (`UR`? `Q E Z C`?).
  Strict Transparent Yajilin (diagonal arrows, transparent clue cells) is a later extension.
- **Double Yajilin**: shade 1x2 dominoes instead of single cells; clues count dominoes in the arrow's direction (a domino counts when
  it lies in the line; check the exact rule on GM Puzzles' posts before building). A box becomes two cells, so adjacency (dominoes may not
  touch each other), the loop's free cells, the solver (domino placement is a new decision variable), rules, generator and drawing all change:
  the biggest of the four.
- **Two loops**: draw exactly two disjoint loops instead of one (every free cell is on one of them). Solver: the "one loop only" rule
  becomes "exactly two cycles" (a cycle may close while ANOTHER loop cell is outside it, but only once, and a final check for two); the
  loop generator builds a 2-factor with exactly two cycles (the merge step stops one cycle early); rules `noEarlyClose`, `closingCell`,
  `sameSegmentExits`, `pairedEnds`, `parityForces`, `crossingParity` all assume one loop and need a "how many loops remain" parameter;
  GUI colours the two loops differently (path colours already exist); uniqueness is harder to make (two cycles can swap parts).
