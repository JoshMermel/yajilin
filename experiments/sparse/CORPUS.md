# Sparse corpus

`data/sparse-corpus.csv`: 92 puzzles from 6×6 to 12×12 with **as few arrows as the generator could find**, about one cell in ten (9.3% to 10.8% at
every size), against 16 to 18% in the ordinary books. Started from an app whose 6×6 puzzles have 3 or 4 arrows.

| Size | Puzzles | Arrows (count of puzzles) | Share of cells |
|---|---|---|---|
| 6×6 | 28 | 3 (8), 4 (20) | 10.3% |
| 7×7 | 16 | 4 (2), 5 (13), 6 (1) | 10.1% |
| 8×8 | 15 | 5 (2), 6 (12), 7 (1) | 9.3% |
| 9×9 | 12 | 8 (8), 9 (4) | 10.3% |
| 10×10 | 8 | 10 (2), 11 (6) | 10.8% |
| 12×12 | 13 | 14 (1), 15 (5), 16 (5), 17 (2) | 10.8% |

**The rule is the usual one.** Only the generator changed, and only one thing is asked of a puzzle: that its solution is unique (the
exhaustive solver says so, and `node tools/audit_books.mjs --rate` passes). **Difficulty is not controlled**: 74 of the 92 are Hard,
because with so few arrows you have to try a cell somewhere, but the rules (with the lookahead ones) solve every one, so Hint always has a step.

**Generator** (`generateSparse` in `js/generator.js`, `node tools/generate.mjs --sparse --size 7x7 [--best-of 100] [--max-clues 4]`):

1. A random loop whose holes (the cells it leaves out) touch nobody, so any hole may be a box or an arrow cell. `tightLoop` only returns
   one whose route is the only loop through those cells, because no arrow can ever fix a second loop.
2. Greedy: add the arrow (a hole and a direction) that leaves the fewest solutions, until one is left. Every candidate is first scored by
   how many cells the solver's propagation leaves open (about a millisecond) and only the best 8 are counted exactly, with the best count
   so far as the limit, so a candidate that cannot win stops after a few solutions. (Counting every candidate exactly was 70 times slower.)
3. Sparsify: take arrows back one at a time while it stays unique, then **exchange**: take two arrows away and look for one that makes it
   unique again (2 for 1), then three for two. Each success saves an arrow. This is what takes 6×6 from 4 or 5 arrows to 3.
4. Try many solutions and keep the first with at most `--max-clues` arrows (else the sparsest in `--best-of` tries). A try that already
   needs more arrows than the best so far plus one is dropped at once.

**Counting solutions** from scratch with the solver's own propagation is weak: on a 12×12 board a unique puzzle can take 8 seconds to
prove, and that blew every search. The rules (sound, polynomial) are run first and the search finishes from their position, which takes
milliseconds and gives the same counts (a test checks it). It is on by default from 64 cells (`--rules-first 0|1` overrides).

**Searching harder at 12×12.** A profile of a 12×12 try showed 98% of the time in the exhaustive counter (the rules were 4%), so:
- While a count reaches the probe cap (40, "very many solutions") every exact count would be the cap and says nothing, so the best
  propagation-scored candidate is taken without counting; the shortlist is only counted exactly once the count is below the cap.
  A try fell from about 70 s to about 8 s.
- Only a try that has come within `--polish-within` (2) clues of the best so far gets the expensive exchanges, and the exchanges are time-boxed (`--polish-ms`).
  More polish per try is not worth it: 30 s of exchanges saved a clue and a quarter on average but cost four times the time, and at 12×12 the
  cheap tries reached a given low count sooner.
- The node cap of a count (`--max-nodes`) hardly matters between 5000 and 100000.
- Tried and dropped: more holes (start density 0.26 was worse, 0.13 and 0.16 no better), and a local search that swaps one arrow for another
  to lower the count (the propagation score does not separate a unique 12×12 puzzle from one with many solutions, so it wandered).
Nine runs of 25 minutes on nine cores (3.75 core hours) found one 14-arrow puzzle, three 15s and five 16s; 14 looks like the floor for this
method, at about one per 3 to 4 core hours. A single try costs about 10 s.

**Cost on one core** (the time to the first puzzle that meets the target): 6×6 4 to 15 s, 7×7 and 8×8 seconds to minutes, 9×9 about 30 s to
several minutes, 10×10 about 35 s per try, 12×12 about 10 s per try and 15 arrows within 10 to 25 minutes.
`--from-rules` (start from an ordinary generatePuzzle puzzle, then sparsify) is very fast at 12×12 (under 2 s to the start) but ends at 20 to 22 arrows, a poor local optimum, so the book
does not use it. Boards below 6×6 yield nothing (`tightLoop` cannot build a loop there). The 6×6 limit looks real: the search keeps finding the
same 3-arrow puzzles (19 found, 7 distinct) and never found 2.

Rebuild with `./tools/make_sparse_corpus.sh` (env `SIZES`, `SEED0`, `WORKERS`; the 12×12 jobs are nine of 25 minutes each) and
`node tools/build_book.mjs --id sparse-corpus --name "Experiment: sparse" --glob sp_`.

## Sparse diagonal and mixed books

The same generator with `--dirs` (`MODE=diag` is `ECZQ`, every arrow diagonal; `MODE=mix` is `URDLECZQ`, all eight directions), the pools
`spd_*` and `spm_*`, books `sparse-diagonal-corpus` (69 puzzles) and `sparse-mixed-corpus` (70). No generator change was needed. Six 12×12
jobs per variant instead of nine; audit passes for all 8,705 puzzles in the data folder.

| Size | Diagonal only: arrows (puzzles) | All eight directions: arrows (puzzles) |
|---|---|---|
| 6×6 | 3 (13) | 3 (19) |
| 7×7 | 4 (2), 5 (15) | 3 (10) |
| 8×8 | 4 (1), 5 (12), 6 (1) | 4 (5), 5 (10) |
| 9×9 | 4 (1), 6 (2), 7 (9) | 5 (2), 6 (10) |
| 10×10 | 8 (2), 9 (6) | 6 (1), 7 (2), 8 (5) |
| 12×12 | 12 (1), 13 (2), 14 (2) | 9 (1), 10 (2), 11 (2), 12 (1) |

More directions mean sparser puzzles: an arrow in any of eight directions rules out more fillings than one in four, so a 12×12 needs 9 to 12
arrows against 14 to 17 for orthogonal. Diagonal only is a little sparser than orthogonal at 12×12 (12 to 14) and equal at 6×6 (3). The 6×6
floor is 3 for all three, as before. Rebuild with `MODE=diag|mix sh tools/make_sparse_corpus.sh` and
`node tools/build_book.mjs --id sparse-diagonal-corpus --name "Experiment: sparse diagonal" --glob spd_` (or `sparse-mixed-corpus`, `spm_`).

What to look for: whether so few arrows is pleasant or just a loop puzzle with hints, how often you have to guess and check (the Hint
tier says Hard for most), and whether 12×12 with 15 arrows feels different from 6×6 with 3. Next: a better score than "cells propagation leaves open" (it cannot tell a unique 12×12 puzzle from one with many solutions, which
blocks any local search), and bigger exchange moves.
