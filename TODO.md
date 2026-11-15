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
- Nikoli-style books (2026-11-15): 1000 puzzles each at 8x8, 12x12, 16x16, 20x20 and 20x36, from the overnight run (generate settings: edge bias 0.8, shade 0.7, tight arrows 0.5 per 100 cells), easiest first within each book. Everything from 16x16 up is Hard; only 8x8 and 12x12 have easier puzzles. To think about: a real Beginner/Medium Nikoli-style ladder (generate with a rule cap at the larger sizes). The 25-puzzle 'Experiment: Nikoli imitation' book was removed 2026-11-15 as redundant with these (its pools are still in `tools/library/imit_*.csv`).
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
