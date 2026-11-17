# Voids-only corpus

`data/voidsonly-corpus.csv`: puzzles with **no numbers and no arrows**, only void cells (crossed-out blocks where nothing goes). The
shape of the board is the whole clue. 84 puzzles from 6×6 to 16×16 (12 to 16 per size), Medium and Hard (the rules never reduce one to
Beginner), about a quarter to a third of the cells void (24% at 6×6, 34% at 16×16).

**The rule is the usual one** (a single loop through every cell that is not a box, no two boxes touching), but with no number to count
the solution always has **no boxes at all**: every open cell is on the loop. The generator makes it so (below), and the player is told in
the book's blurb. The loop still has to be found by the solver the usual way: dead ends, the single way out of a cell, shading forced by a
neighbour whose only exit it would take (`tightCell`, `shadeForcesLines` are the rules most of these need), and loops that must not close early.

**Generator** (`generateVoidsOnly` in `js/generator.js`, `node tools/generate.mjs --voids-only --size 8x8`):

1. `tightLoop` builds a loop whose routing is unique for its set of holes; the holes become voids.
2. That is not yet unique, because a box could replace a loop cell somewhere. While the exhaustive solver finds a second solution, that
   solution's boxes are turned into voids as well (the solution stays valid and has no boxes of its own). It ends when the solution is
   unique; about two to five such rounds are typical.
3. The rules must solve the result (no trial and error), and the exhaustive solver must agree it is unique.

Cost: about 0.1 s at 8×8, 1 s at 12×12, 5 to 25 s at 14×14 and 16×16 (the exhaustive solver; only a fraction of the loops survive, so a
job's budget is long). Rebuild with `./tools/make_voidsonly_corpus.sh` (env `SIZES`, `SEED0`, `WORKERS`) and
`node tools/build_book.mjs --id voidsonly-corpus --name "Experiment: voids only" --glob vo_`.

What to look for: whether a board with no numbers is a pleasant puzzle at all (the clue is the board's outline, so it is closer to a
"draw the loop" puzzle than to Yajilin), what you reach for first, and whether the difficulty tiers mean anything here.
