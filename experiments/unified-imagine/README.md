# Unified "imagine X" rating (prototype, not wired into the game)

Idea: the cell-hypothesis rules (box side: deadEndNeighbor, shadeShortChain, boxStarvesClue, closingNeighbor, shadeFewLines,
boxStarvesClueByLines, shadeForcesLines, shadeClosesLoop; dot side: dotShortChain, dotForcesLines) price a box and a dot hypothesis
differently. Here one search imagines a box or a dot in a candidate cell, follows the easy rules to a contradiction, prunes the chain to
the facts the contradiction really depends on (ablation), and prices both polarities with the same cost. The cheapest chain wins.

- `imagine.mjs`: the hypothesis tracer and the pruning (`easyContradiction`, `run`, `pruned`).
- `model.mjs`: cost models (`MODEL=A` by needed lines, `MODEL=B` by pruned steps), `AREA_PENALTY`, and `rateUnified(P)`.
- `lib.mjs`: corpus loader (every 3rd puzzle of the books plus the regional set) and the helpers.
- `dryrun.mjs`: `MODEL=A node dryrun.mjs <shard> <shards>` writes `dry_<MODEL>_<shard>.json` here (git-ignored); the shards are meant to run in parallel.
- `report.mjs`: tier transitions, score deltas and box/dot/area counts over shards 0-4 of both models.

Dry run on 127 sampled puzzles of at most 256 cells (compared with the rules before commit 341d64f):
no puzzle lost solvability and no old-rule fallback was needed; about 20% changed tier (A: 22 Medium to Hard, 4 Hard to Medium;
B: 16 and 5); box hypotheses won about 97% of the time; rating was about 10x slower (median 0.3 s, p90 6 s, max 27 s).
Caveats: the sample leaves out 20x20, 20x36 and skyscraper boards, the candidate cap is 8, and the cost constants and the area penalty (12)
are hand-fitted. Next: profile and optimize.

The scripts import `../../js`, so "old" ratings are whatever the working tree's `js/rating.js` gives now.

## Profiling and speed (check.mjs, prof.mjs, stats.mjs)

`check.mjs <model module>` prints tier, score and a hash of the step sequence per puzzle, to prove an optimization changes nothing;
`prof.mjs` times old vs unified rating (run it with `node --cpu-prof`); `stats.mjs <names>` counts hypothesis runs.

Where the time went: bestImagine was ~70% of rating time (scan of every cell and polarity ~half, pruning by ablation ~half), and the
search for the cheapest non-family rule ran through all the expensive rules every step.
Exact optimizations done (all give identical tiers, scores and step sequences on a 40-puzzle check set):
1. the non-family search is capped at the imagined chain's cost (and skipped for a rule priced at 12 or less);
2. ablation runs resume from a per-generation snapshot instead of replaying the chain from the start;
3. one scan run serves both the easy and the area contradiction, and the full (area) check runs once on the last short state instead of every step.
4. pruning gives up on a candidate once the facts already known to be needed (a fact whose removal broke the contradiction stays needed) price it above the best so far;
5. the scan clones the state only where its chain crosses the 12-fact limit, not every generation.
Result: on a sample of 8 puzzles (<= 256 cells) the unified rating went from 15.7x the old rules' time to about 5x (4.8 s to about 1.6 s while the old rules took 0.3 s);
on the 40-puzzle check set 10.2 s to about 4.4 s (old 0.8 s). Timings are noisy when the machine is busy: compare the ratio printed by `prof.mjs`.
`check.mjs` needs the same puzzles every run, and the books change while others work: `CORPUS_ROOT=<dir with data/ and tools/library>` points lib.mjs at a frozen copy
(`git archive HEAD data` plus a copy of tools/library).
Approximations measured but NOT adopted: one ablation pass (25% faster, 14 of 40 scores shift slightly, no tier changes) and a lower candidate
cap (`MAXCAND`: 4 gives 7 scores and 1 tier different, 1 gives 20 scores and 3 tiers different).
Ideas left: reuse scan results between steps (a hypothesis that contradicted stays contradicted), incremental propagation instead of full-board rule scans.
