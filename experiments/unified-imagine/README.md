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

Big boards (> 256 cells; `bigprof.mjs <shard> <shards> [perBook]`, 14 puzzles, 4 shards in parallel on a busy machine, frozen corpus): the Beginner ones cost
about the same as before (no imagining needed), the others took 1.8x to 16x the old time (20x20: 1.8x and 4.2x; 20x36: 5x to 16x), worst 35 s against 4.5 s
(a Hard 20x36). Total 103 s against 15 s. The 20x36 boards are where the next optimization has to land.

Round 3 (aimed at the 20x36 boards, where the scan was 75% of the time; `prof1.mjs <book> [i]` times one puzzle with the phase counters), all exact (identical on the 40-puzzle check set):
6. the "easy contradiction" check after a rule fires only looks where the new facts are (their cells and neighbours, the clues counting them, the cycle if a segment
   went on): `easyContradictionAfter`, used by the scan and the ablation runs. `CHECK_EASY=1` verifies it against the full check at every generation (no disagreement on the check set or on a 20x36);
7. the area arguments (cut-off areas, odd open ends) are only looked for when there are fewer easy chains than `maxCand`: candidates are taken easy ones first and only the
   first `maxCand` are priced, so area candidates could not be picked anyway. The scan hands back the state to check and `bestImagine` decides later.
One 20x36 (Medium to Hard): 11.6 s, then 5.2 s (old rules 1.6 s). Big boards again (14 puzzles, 4 shards): total 103 s, then 62 s against 14 s (ratio 6.9 then 4.5); worst case 35 s then 20 s.

Round 4: 8. rules are asked again only when a fact of a kind they read has been added since they last found nothing (`DEP` in imagine.mjs: a new box, a new dot, a segment on, a segment off).
Facts only go from unknown to known, so e.g. "a segment touching a box that is not off yet" can only appear with a new box. Rule calls halved (675k to 362k on the 20x36 above).
`CHECK_GATE=1` also asks the skipped rules and fails if one would have found something (no failure on the check set or on a 20x36); results identical on the check set.
Timed with the machine quiet (load about 2): 12-puzzle small sample 0.37 s old, 1.08 s unified (2.9x); the 14 big boards 7.6 s old, 25 s unified (3.3x), worst 8.2 s against 2.1 s (a Hard 20x36).
