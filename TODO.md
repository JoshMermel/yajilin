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
5. GUI polish: edge crosses ("no line here"), clue-satisfied colouring options, touch testing.
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

## GUI ideas not done yet

- Parity of open ends: done (`parityForces` rule and part of `contradiction()`; Josh's definition: an open end is a cell that has one segment but still needs its second). It is sound but rarely the easiest rule on the puzzles we have.
- Two-press (step-by-step) hints like polyomino-panel; a "peek" when the solver is stuck.
- Edge crosses ("no segment here") as player marks.
- Three lines into a cell: currently allowed and outlined in red. Alternative: drawing a third line removes the oldest.

## Other grids (hex)

Possible, but not with the current code as it stands: `logic.js` assumes a square grid (four directions, edges named by `2*i` and
`2*i+1`, rays along rows and columns, a bipartite grid for the loop generator). polyomino-panel solved the same problem with a
`topology.js` (neighbours, edge kinds, symmetries, geometry per grid) that every rule loops over. The plan would be the same: a
topology object (six neighbours, six arrow directions, rays along the six lines), rules written once over `dirs`, SVG geometry from the
topology. Differences that matter: on a hex grid the loop uses two of six exits per cell; shaded cells may not touch (six neighbours);
the cell graph is not bipartite, so the 2-factor generator needs another method (cycles in the triangular lattice, or a grow-and-merge
approach); `rangeFacing`/`rangeSame` generalise to the three line directions; "deadEnd" and "tight cell" change meaning since cells
have more neighbours. A day or two of work, best done as its own project phase after the square-grid rules settle.

## Learned from a real Nikoli puzzle (nk_99, 20x36, transcribed from a photo of the answer key)

Compared with our generated puzzles (14x14): clue cells 12% (ours 14%), boxes 16% (ours 10%), **zero-clues only 9% of clues (ours 36%)**,
mean clue number 2.4 (ours 1.1), mean ray length 9 (ours 7), **44 pairs of touching clue cells** in vertical stacks of the same
direction (the `rangeSame` structure), arrows very skewed (24 up, 41 right, 5 down, 19 left). It needs `parityForces` (the open-end
parity rule) and nothing harder, rating in about 0.1 s. Generator ideas from this: bigger numbers and fewer zeros (prefer clues whose
ray holds several boxes), clue stacks (allow clue cells next to each other, same direction), the direction skew, higher box density.
Transcribe more (97, 98, 100-103 were in the same photos; 97 is blurry) to confirm these are the style and not one puzzle's quirk.

## Auto-dots (queued)

- Also dot every cell of a satisfied clue (a clue whose shaded count equals its number).
- Remember WHY each auto-dot exists (a shaded neighbour, a satisfied clue) so it disappears when its reasons go away (star battle does this).
