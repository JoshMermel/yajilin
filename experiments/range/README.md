# Difficulty range at 16x16 and 20x32

**Scores in the table and in `report.md` use the integer costs of 2026-11-14 (every rule costs something, Hard rules several times Medium); the notes below were written with earlier, smaller costs, so only compare numbers within one scale.** Every puzzle here now rates Hard because `shadeForcesLines` costs more than any Medium rule.

**Scores here use the re-weighted rules** (Beginner weights x0.25, 2026-11-14). Under the first weights the same puzzles scored
166 / 251 / 364 (16x16) and 536 / 661 / 838 (20x32); the within-size order barely changed (Spearman 0.98) but the spread within a size
widened (max/min 2.2 -> 3.4 and 1.6 -> 1.9) but the gap between sizes did not shrink as I had predicted: the 20x32 / 16x16 median ratio went 2.74 -> 2.96 (area ratio 2.5), because a bigger board also needs proportionally more medium and hard steps, not just more mechanical ones.
Later rule additions (closingNeighbor, pairedEnds, segmentForcesLines, the rangeFacing split, crossingParity moved to Hard) change some scores a little, so `report.md` and `range.json` are a snapshot from before them: rerun `node tools/range_report.mjs` to refresh (it re-picks the samples). The sweep in `../sweep/` was run with the old weights; its conclusions are about relative effects and still hold.

101 Nikoli-style puzzles (`--edge-bias 0.8 --shade 0.7`, the settings of the "Large (Nikoli-style)" book): 60 at 16x16, 41 at 20x32.
Reproduce: `bash experiments/range/run.sh` (it fills `pools/`), then `node tools/range_report.mjs`.
Full numbers, histograms and the sample table are in `report.md`; per-puzzle stats in `range.json`.
`samples.csv` holds five puzzles per size at evenly spaced difficulty quantiles; the same file is the book "Difficulty samples" in the app
(`data/range-samples.csv`). Names say `d5` (hardest) to `d1` (easiest) within their size.

| size | puzzles | score min / median / max | max/min | sd | per cell |
| --- | --- | --- | --- | --- | --- |
| 16x16 | 60 | 1287 / 2225 / 3946 | 3.1x | 579 | 8.9 |
| 20x32 | 41 | 4359 / 5969 / 7977 | 1.8x | 753 | 9.3 |

- The two sizes do not overlap: the easiest 20x32 (323) is harder than the hardest 16x16 (275). Within a size the hardest puzzle is 1.9-3.4x the easiest.
- Within 16x16 the easy end is Medium-tier (15%: nothing needs more than `crossingParity`), the rest Hard. Every 20x32 puzzle is Hard.
- What makes a puzzle harder within a size is more uses of `shadeForcesLines` (16x16: 0.9 per puzzle in the easiest quarter vs 10 in the hardest;
  20x32: 9 vs 26) and, on the big board, `rangeFacing` (0.3 vs 2.1) and `cluePlacements`. The cheap rules (`forcedExits`, `clueFull`, `clueDone`...)
  are used the same amount by easy and hard puzzles, so they carry size, not difficulty.
- Generation cost: 16x16 about 2 s per puzzle; 20x32 10-60 s, the whole 41 took about 8 minutes on 9 cores.
- Score is a count of the solver's steps, so a human may find some "hard" puzzles easier or harder than the score says; solve the
  `d1`..`d5` samples and tell me where the ordering feels wrong. That is the data for recalibrating the weights.
