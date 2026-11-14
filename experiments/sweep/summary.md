# Parameter sweep

30 puzzles per setting, 14x14 unless the setting changes the size; one factor changed per row against the baseline ({"density":0.24,"shadeShare":0.55,"prune":true,"acceptU":20,"clump":0.5}).
Difficulty is the human-style solver's: score = weighted sum of the steps it needed; tier = hardest rule used; lookahead = trial-and-error steps per puzzle.

| setting | what changed | size | made | gen time | clue cells | boxes | mean n | zeros | arrows at nearer edge | score (mean ± sd) | score per cell | tiers B/M/H/E | trials | hardest rule (top 2) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | baseline | 14x14 | 29/30 | 1.6 s | 15.5% | 12.1% | 1.06 | 32.2% | 31.3% | 188 ± 37 | 0.96 | 0/5/24/0 | 0.0 | shadeForcesLines 20, crossingParity 4 |
| boxes-35 | box/clue split (shadeShare) | 14x14 | 29/30 | 2.4 s | 15.7% | 11.8% | 1.06 | 32.2% | 30.5% | 183 ± 35 | 0.93 | 0/9/20/0 | 0.0 | shadeForcesLines 15, crossingParity 8 |
| boxes-75 | box/clue split (shadeShare) | 14x14 | 29/30 | 2.5 s | 15.7% | 11.5% | 1.02 | 35.1% | 35.6% | 182 ± 47 | 0.93 | 0/5/24/0 | 0.0 | shadeForcesLines 19, rangeFacing 4 |
| edge-25 | edge bias | 14x14 | 30/30 | 2.4 s | 15.4% | 11.7% | 1.15 | 29.7% | 24.1% | 189 ± 32 | 0.97 | 0/0/30/0 | 0.0 | shadeForcesLines 20, rangeFacing 10 |
| edge-50 | edge bias | 14x14 | 30/30 | 2.5 s | 15.8% | 11.8% | 1.00 | 37.2% | 41.0% | 183 ± 41 | 0.93 | 0/6/24/0 | 0.0 | shadeForcesLines 22, crossingParity 6 |
| edge-75 | edge bias | 14x14 | 30/30 | 2.5 s | 16.0% | 11.4% | 0.89 | 43.0% | 58.8% | 177 ± 28 | 0.90 | 0/3/27/0 | 0.0 | shadeForcesLines 25, crossingParity 3 |
| numbers-big | clue numbers | 14x14 | 28/30 | 13.4 s | 14.7% | 12.9% | 1.80 | 6.1% | 13.9% | 186 ± 32 | 0.95 | 0/8/20/0 | 0.0 | shadeForcesLines 15, crossingParity 6 |
| numbers-small | clue numbers | 14x14 | 7/30 | 4.9 s | 16.4% | 10.0% | 0.70 | 46.4% | 24.1% | 175 ± 27 | 0.89 | 0/0/7/0 | 0.0 | shadeForcesLines 7 |
| rules-medium | rules allowed | 14x14 | 28/30 | 1.4 s | 15.9% | 11.3% | 0.97 | 37.2% | 31.5% | 144 ± 18 | 0.73 | 0/28/0/0 | 0.0 | crossingParity 24, cluePlacements 2 |
| rules-beginner | rules allowed | 14x14 | 0/30 | NaN s | NaN% | NaN% | NaN | NaN% | NaN% | NaN ± 0 | NaN | 0/0/0/0 | NaN |  |
| no-prune | clue pruning | 14x14 | 30/30 | 2.4 s | 19.9% | 7.7% | 0.62 | 53.3% | 33.1% | 119 ± 15 | 0.61 | 0/25/5/0 | 0.0 | crossingParity 16, noEarlyClose 6 |
| holes-16 | starting holes | 14x14 | 30/30 | 0.4 s | 15.1% | 8.9% | 0.81 | 45.1% | 32.7% | 177 ± 45 | 0.90 | 0/6/24/0 | 0.0 | shadeForcesLines 24, crossingParity 5 |
| holes-20 | starting holes | 14x14 | 30/30 | 0.4 s | 15.1% | 10.6% | 0.97 | 40.5% | 31.5% | 173 ± 36 | 0.89 | 0/5/25/0 | 0.0 | shadeForcesLines 24, crossingParity 4 |
| accept-0 | lookahead allowed | 14x14 | 30/30 | 3.9 s | 15.4% | 11.9% | 1.05 | 33.0% | 33.7% | 183 ± 36 | 0.93 | 0/6/24/0 | 0.0 | shadeForcesLines 19, crossingParity 5 |
| accept-60 | lookahead allowed | 14x14 | 30/30 | 2.7 s | 15.2% | 12.3% | 1.09 | 32.5% | 31.6% | 191 ± 34 | 0.97 | 0/4/26/0 | 0.0 | shadeForcesLines 23, crossingParity 3 |
| one-direction | arrow directions | 14x14 | 11/30 | 4.4 s | 17.9% | 9.4% | 0.85 | 45.9% | 42.1% | 203 ± 37 | 1.04 | 0/2/9/0 | 0.0 | shadeForcesLines 9, crossingParity 2 |
| clump-0 | clustering of non-loop cells | 14x14 | 30/30 | 2.3 s | 15.8% | 12.4% | 1.13 | 33.6% | 31.7% | 184 ± 40 | 0.94 | 0/6/24/0 | 0.0 | shadeForcesLines 22, crossingParity 4 |
| clump-90 | clustering of non-loop cells | 14x14 | 30/30 | 4.4 s | 14.8% | 9.0% | 0.79 | 48.1% | 31.3% | 177 ± 30 | 0.90 | 0/2/28/0 | 0.0 | shadeForcesLines 25, crossingParity 2 |
| size-8 | size | 8x8 | 30/30 | 0.0 s | 15.5% | 11.1% | 0.61 | 52.1% | 31.2% | 47 ± 8 | 0.74 | 1/22/7/0 | 0.0 | noEarlyClose 11, crossingParity 9 |
| size-10 | size | 10x10 | 30/30 | 3.1 s | 15.6% | 11.3% | 0.76 | 46.6% | 29.7% | 84 ± 20 | 0.84 | 0/12/18/0 | 0.0 | shadeForcesLines 18, crossingParity 7 |
| size-12 | size | 12x12 | 30/30 | 4.3 s | 15.5% | 11.3% | 0.90 | 39.2% | 30.9% | 137 ± 32 | 0.95 | 0/3/27/0 | 0.0 | shadeForcesLines 23, rangeFacing 4 |
| size-16 | size | 16x16 | 29/30 | 1.8 s | 15.3% | 11.9% | 1.19 | 32.2% | 34.9% | 261 ± 51 | 1.02 | 0/0/29/0 | 0.0 | shadeForcesLines 18, rangeFacing 10 |
| size-20 | size | 20x20 | 27/30 | 9.3 s | 15.3% | 11.8% | 1.41 | 27.4% | 35.8% | 433 ± 61 | 1.08 | 0/0/27/0 | 0.0 | shadeForcesLines 14, rangeFacing 11 |
