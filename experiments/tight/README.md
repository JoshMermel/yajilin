# Planting tight arrows

Josh's observation (2026-11-14): hand-made Nikoli puzzles are full of "tight" arrows (k boxes, exactly 2k-1 cells to the wall, so every box
is forced from the start); ours rarely have them. Measured on the three Nikoli puzzles (36x20): about 5.1 tight arrows per 100 clues and
about 14 boxes forced by the clues alone at the start; ours without planting: 0.4-1.1 per 100 clues and about 2 forced boxes.

`js/generator.js` now has the option `tightArrows` (a count; `tools/generate.mjs --tight-rate R` = planted arrows per 100 cells): before
the loop is built, it plants that many tight arrows (n = 2 or 3 mostly, as in Nikoli's), keeps their cells as holes, forces the cells between
the boxes to stay on the loop, and protects them from the climb and the pruning. `node tools/tight_experiment.mjs` measures the effect
(table in `summary.md`).

Result (Nikoli-style settings, 12 puzzles per row): planting works and costs nothing. Generation time and clue density (about 15%) are
unchanged, every row made 11-12 of 12 puzzles, and the share of tight arrows and of boxes forced at the start grow with the rate:

| size | rate 0 | rate 0.3 | rate 0.65 | rate 1.0 |
| --- | --- | --- | --- | --- |
| 20x20: tight per 100 clues / boxes forced at the start | 0.3 / 1.8 | 2.4 / 6.1 | 6.3 / 17.8 | 8.0 / 21.6 |
| 16x16 | 1.7 / 2.4 | 3.4 / 7.7 | 6.0 / 11.8 | 8.7 / 16.6 |

Nikoli's 5.1 per 100 clues and about 2 forced boxes per 100 cells point to a rate of about 0.4-0.5 planted arrows per 100 cells.
Planting makes small puzzles a little easier (10x10 score 791 -> 546) and leaves large ones about as hard.
