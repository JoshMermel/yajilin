# Parameter sweep: what moves difficulty?

Reproduce: `node tools/param_sweep.mjs --n 30` (about 12 minutes on 9 cores). Raw per-puzzle data is in `sweep/*.json`, the table in `sweep/summary.md`.
23 settings x 30 puzzles; 14x14 unless the setting is a size. Difficulty = the human-style solver's score (weighted sum of the steps it needs).
Noise: score sd within a setting is about 35, so the standard error of a 30-puzzle mean is about 7. Differences smaller than ~15 are not real.

## Findings

1. **Size is the one big lever.** Mean score 47 (8x8), 84 (10), 137 (12), 188 (14), 261 (16), 433 (20): roughly linear in area, 0.75-1.1 per cell and creeping up with size.
2. **Capping the rule set works.** `rules-medium` (no Hard rules) gives 144 vs 188 and every puzzle is Medium tier. A Beginner-only cap is infeasible at 14x14 (0/30): the loop-uniqueness constraint always needs a Medium rule.
3. **Clue pruning matters.** `no-prune` leaves 20% clue cells (vs 15.5%) and scores 119 (vs 188), mostly Medium. It is the cheapest way to make a gentler book.
4. **The style knobs do not change difficulty.** Box/clue split, edge bias (25/50/75%), clue-number style, clumping, starting hole density and the lookahead allowance all land within noise of the baseline (173-191). Pooled over 403 puzzles, score correlates with clue share (-0.14), box share (0.08), mean n (0.13), zeros (-0.10) and nearer-edge share (-0.02) only weakly; the number of steps is the only strong predictor (0.71). An earlier 4-puzzle smoke test suggested "big numbers" and "edge bias" were harder (217, 200); that was noise.
   So Nikoli-style tuning (edge bias, number mix) can be done freely without shifting difficulty.
5. **Some styles are expensive to generate**: one-direction 11/30 made, numbers-small 7/30, numbers-big 13 s per puzzle (vs 1.6 s), 20x20 27/30.
6. **Tier is a blunt instrument.** ~80% of 14x14 puzzles are "Hard" because `shadeForcesLines` (weight 8) is used at least once. Score separates puzzles better, and within a setting it spans about 100-330. Lookahead (trial) steps are never needed: the generator only accepts puzzles the rules solve.

## What to do with it

- Pick difficulty by **size + rule cap + pruning**, then filter by score within the pool; the style knobs are free to spend on looking like Nikoli.
- Within-setting spread (sd ~37) is the lever for fine targeting: put the score (or the count of Hard-rule uses) in the annealing objective, or pick the top/bottom quartile of a pool.
- A finer tier would count how many times Hard rules fire rather than whether any do.
