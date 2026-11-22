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
