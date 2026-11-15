# Generating puzzles for a given set of rules

20 attempts per row; acceptance only by the rule set itself (no lookahead), 20 s budget per puzzle.

| rule set | size | pruned | made | gen time | clue cells | redundant clues | score | tiers B/M/H | hardest rule (top) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| beginner without noEarlyClose | 6x6 | yes | 11/20 | 0.3 s | 19.4% | 1.27 | 114 | 11/0/0 | forcedExits 11 |
| beginner without noEarlyClose | 6x6 | no | 11/20 | 0.3 s | 20.7% | 1.82 | 113 | 11/0/0 | forcedExits 11 |
| beginner without noEarlyClose | 7x7 | yes | 3/20 | 0.2 s | 18.4% | 1.67 | 157 | 3/0/0 | forcedExits 3 |
| beginner without noEarlyClose | 7x7 | no | 3/20 | 0.2 s | 19.7% | 3.00 | 156 | 3/0/0 | forcedExits 3 |
| beginner without noEarlyClose | 8x8 | yes | 6/20 | 0.8 s | 18.5% | 2.67 | 194 | 6/0/0 | forcedExits 6 |
| beginner without noEarlyClose | 8x8 | no | 6/20 | 0.7 s | 21.9% | 3.50 | 191 | 6/0/0 | forcedExits 6 |
| beginner without noEarlyClose | 9x9 | yes | 4/20 | 1.4 s | 17.9% | 2.50 | 242 | 4/0/0 | forcedExits 4 |
| beginner without noEarlyClose | 9x9 | no | 4/20 | 1.4 s | 21.9% | 3.25 | 235 | 4/0/0 | forcedExits 4 |
| beginner | 6x6 | yes | 19/20 | 0.0 s | 18.0% | 1.21 | 129 | 19/0/0 | noEarlyClose 16 |
| beginner | 6x6 | no | 19/20 | 0.0 s | 19.4% | 1.68 | 126 | 19/0/0 | noEarlyClose 15 |
| beginner | 7x7 | yes | 19/20 | 0.0 s | 18.2% | 1.53 | 171 | 19/0/0 | noEarlyClose 17 |
| beginner | 7x7 | no | 19/20 | 0.0 s | 20.4% | 2.37 | 166 | 19/0/0 | noEarlyClose 17 |
| beginner | 8x8 | yes | 19/20 | 0.1 s | 17.7% | 2.32 | 228 | 19/0/0 | noEarlyClose 17 |
| beginner | 8x8 | no | 19/20 | 0.1 s | 20.8% | 3.47 | 218 | 19/0/0 | noEarlyClose 17 |
| beginner | 9x9 | yes | 20/20 | 0.1 s | 18.1% | 2.85 | 278 | 20/0/0 | noEarlyClose 20 |
| beginner | 9x9 | no | 20/20 | 0.1 s | 21.4% | 4.25 | 267 | 20/0/0 | noEarlyClose 19 |
| beginner+tightCell+deadEndNeighbor | 6x6 | yes | 19/20 | 0.0 s | 14.3% | 0.47 | 163 | 0/19/0 | tightCell 18 |
| beginner+tightCell+deadEndNeighbor | 6x6 | no | 19/20 | 0.0 s | 16.8% | 1.05 | 152 | 1/18/0 | tightCell 17 |
| beginner+tightCell+deadEndNeighbor | 7x7 | yes | 19/20 | 0.0 s | 16.4% | 0.74 | 196 | 1/18/0 | tightCell 16 |
| beginner+tightCell+deadEndNeighbor | 7x7 | no | 19/20 | 0.0 s | 18.9% | 2.00 | 186 | 2/17/0 | tightCell 16 |
| beginner+tightCell+deadEndNeighbor | 8x8 | yes | 19/20 | 0.2 s | 15.9% | 0.95 | 265 | 1/18/0 | tightCell 17 |
| beginner+tightCell+deadEndNeighbor | 8x8 | no | 19/20 | 0.1 s | 18.2% | 2.37 | 251 | 1/18/0 | tightCell 17 |
| beginner+tightCell+deadEndNeighbor | 9x9 | yes | 20/20 | 0.2 s | 16.4% | 2.00 | 334 | 1/19/0 | tightCell 12 |
| beginner+tightCell+deadEndNeighbor | 9x9 | no | 20/20 | 0.2 s | 20.1% | 4.15 | 300 | 4/16/0 | tightCell 11 |
| all Medium | 6x6 | yes | 19/20 | 0.0 s | 14.3% | 0.58 | 164 | 0/19/0 | tightCell 17 |
| all Medium | 6x6 | no | 19/20 | 0.0 s | 16.5% | 1.11 | 154 | 1/18/0 | tightCell 16 |
| all Medium | 7x7 | yes | 19/20 | 0.0 s | 15.9% | 0.68 | 208 | 1/18/0 | tightCell 12 |
| all Medium | 7x7 | no | 19/20 | 0.0 s | 18.7% | 2.05 | 188 | 3/16/0 | tightCell 13 |
| all Medium | 8x8 | yes | 19/20 | 0.1 s | 15.8% | 1.16 | 276 | 0/19/0 | tightCell 11 |
| all Medium | 8x8 | no | 19/20 | 0.0 s | 18.3% | 1.84 | 258 | 0/19/0 | tightCell 12 |
| all Medium | 9x9 | yes | 20/20 | 0.2 s | 15.6% | 1.50 | 376 | 0/20/0 | sameSegmentExits 4 |
| all Medium | 9x9 | no | 20/20 | 0.1 s | 19.1% | 3.25 | 323 | 1/19/0 | tightCell 9 |
