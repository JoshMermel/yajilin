# Regional test corpus

`data/regional-corpus.csv`, in the app as **Regional corpus (experiment)** in the Bonus group. 54 puzzles named `<recipe>-<size>-<n>`
(so "rows-8x8-2 needed X" is enough to find the puzzle again). Every puzzle is unique (checked by the rules and, on these sizes, by
the exhaustive solver from scratch), and `node tools/audit_books.mjs --book regional-corpus --rate` passes.

The point is to play them and notice which inferences you make. When the Hint button says something clumsy, or you make a deduction it
cannot, write down the puzzle name and the cells: those become the regional rule ladder.

| Recipe | What it is | What to look for |
|---|---|---|
| `gentle` | small regions (2-4 cells), every region numbered, Beginner rules only | the very first moves: a region needs 0 boxes; a 2-cell region needing 1 box |
| `beginner` | small regions, numbers pruned, Beginner rules only | how far loop reasoning alone goes (dead ends, closing cells) when many regions are unnumbered |
| `medium` | regions of about 4, pruned, up to the Medium rules | counting a region against its open cells; two boxes that cannot touch |
| `hard` | regions of about 5, pruned, all rules | where you start guessing: these need the trial rules (`shadeForcesLines` and friends) |
| `big` | regions of about 8 (up to 14 cells) | counting inside a large region; "pairs of regions" arguments |
| `rows`, `cols` | every region a straight bar along a row / column (2-5 cells) | the bars behave like short arrows, with the number in the bar's first cell: does the arrow vocabulary (a k-bar with room for k boxes, two bars side by side) carry over? |
| `classical` | regions like a setter's: sizes spread widely around 7, small numbers, about 16% boxes, most regions numbered (8x8, 10x10 and 12x12; see `CLASSICAL.md`) | how a real puzzle feels: big regions say little, the loop does the work |
| `stuck` | numbers removed until every rule except trial and error (`tryCell`) is stuck, while the puzzle stays unique (at most 25 cells left open at the stall) | positions with a deduction we have no rule for yet: the most useful ones for defining new rules (the rating says `tryCell`; the Hint button runs out of steps) |

Sizes are 6x6, 8x8 and 10x10 (and 12x12 for `classical`), two of each per recipe, easiest first within a size (by rule score).

How to rebuild: `WORKERS=6 ./tools/make_regional_corpus.sh` (pools in `tools/library/regc_*`), then
`node tools/build_regional_corpus.mjs`. `ONLY=stuck` reruns one recipe.

Things the corpus deliberately does not have yet: boards over 10x10 (a 12x12 takes 20-40 s to generate), regions drawn by hand like
a setter's (these are random growths, so they are more jagged), puzzles whose regions are mostly unnumbered, and pre-placed boxes.
