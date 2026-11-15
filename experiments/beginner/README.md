# Generating beginner-tier puzzles: what limits us?

`node tools/beginner_experiment.mjs --n 20` (table in `summary.md`). Puzzles are accepted only if a chosen set of rules solves them
(no lookahead), at the site's sizes 6x6, 7x7, 8x8 and 9x9 (odd boards work since 2026-11-14).

Site puzzles for comparison (24 borrowed, private): all levels have about 15% clue cells, 8-9% boxes, mean clue number 0.6-0.9.
With `noEarlyClose` as the last Beginner rule (moved from Medium 2026-11-14), our tiers line up with the site's: site Hard 8/8 rate Hard,
site Medium 8/8 rate Medium, site Easy 4 Beginner / 4 Medium; scores separate the three levels (Easy 153-238, Medium 255-351, Hard 403+).

| rule set | made (of 20) | clue cells |
| --- | --- | --- |
| Beginner without noEarlyClose | 11 at 6x6, 3 at 7x7, 6 at 8x8, 4 at 9x9 | 18-22% |
| Beginner (with noEarlyClose) | 19-20 at every size, instant | 18-21% |
| Beginner + tightCell, deadEndNeighbor | 19-20, instant | 14-20% (the site's Easy/Medium: about 15%) |
| all Medium | 19-20, instant | 14-19% |

Pruning removes clues the rule set does not need: unpruned puzzles have 2-3 points more clue cells, up to 1.5x the clues that are
redundant for uniqueness, and score 3-8% lower. A small lever next to the rule set.
