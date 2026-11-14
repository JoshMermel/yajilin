# Difficulty range

Pools: `experiments/range/pools` (Nikoli-style settings: --edge-bias 0.8 --shade 0.7). Difficulty = the human-style solver's score; every puzzle is rule-solved, hence unique.

## 16x16 (60 puzzles)

score: min 82, 10% 107, 25% 115, median 163, 75% 185, 90% 216, max 275 (mean 157, sd 45, max/min 3.35)  
score per cell: mean 0.61, sd 0.18  
clue cells 16.0%, boxes 11.3%  
tiers: Medium 9, Hard 51  
hardest rule needed: shadeForcesLines 42, crossingParity 9, rangeFacing 8, parityForces 1

```
  82-101  #### 4
 101-121  ############## 14
 121-140  #### 4
 140-159  ##### 5
 159-179  ################ 16
 179-198  ######## 8
 198-217  #### 4
 217-237  ## 2
 237-256   0
 256-275  ### 3
```

Steps by rule, easiest quarter vs hardest quarter (mean uses per puzzle):

| rule | easiest quarter | hardest quarter |
| --- | --- | --- |
| shadeForcesLines | 0.8 | 10.8 |
| tightCell | 18.8 | 22.6 |
| noEarlyClose | 10.3 | 14.1 |
| forcedExits | 123.3 | 126.8 |
| crossingParity | 2.6 | 4.9 |
| rangeSame | 0.2 | 1.1 |
| cluePlacements | 1.8 | 2.4 |
| sameSegmentExits | 3.0 | 3.4 |
| closingCell | 0.6 | 0.5 |
| deadEndNeighbor | 4.7 | 4.3 |
| clueFull | 14.4 | 13.9 |
| clueDone | 23.7 | 22.6 |
| deadEnd | 8.7 | 6.5 |
| shadedNeighbor | 9.7 | 7.3 |

Samples (in `samples.csv`):

| name | score | tier | hardest rule | clue cells | boxes |
| --- | --- | --- | --- | --- | --- |
| 16x16 d5 (score 275) | 275 | Hard | parityForces | 15.6% | 10.2% |
| 16x16 d4 (score 181) | 181 | Hard | shadeForcesLines | 14.8% | 12.5% |
| 16x16 d3 (score 163) | 163 | Hard | shadeForcesLines | 14.5% | 12.1% |
| 16x16 d2 (score 115) | 115 | Hard | shadeForcesLines | 16.0% | 9.8% |
| 16x16 d1 (score 82) | 82 | Medium | crossingParity | 18.8% | 10.2% |

## 20x32 (41 puzzles)

score: min 323, 10% 354, 25% 415, median 464, 75% 520, 90% 562, max 621 (mean 465, sd 76, max/min 1.92)  
score per cell: mean 0.73, sd 0.12  
clue cells 15.8%, boxes 11.4%  
tiers: Hard 41  
hardest rule needed: rangeFacing 21, shadeForcesLines 14, parityForces 6

```
 323-353  #### 4
 353-383  ### 3
 383-412  ### 3
 412-442  ###### 6
 442-472  ##### 5
 472-502  ###### 6
 502-531  ##### 5
 531-561  #### 4
 561-591  ### 3
 591-621  ## 2
```

Steps by rule, easiest quarter vs hardest quarter (mean uses per puzzle):

| rule | easiest quarter | hardest quarter |
| --- | --- | --- |
| shadeForcesLines | 8.6 | 26.6 |
| tightCell | 45.7 | 56.5 |
| cluePlacements | 5.5 | 8.7 |
| noEarlyClose | 24.7 | 27.7 |
| sameSegmentExits | 9.0 | 11.5 |
| rangeFacing | 0.2 | 2.2 |
| clueFull | 31.9 | 32.9 |
| crossingParity | 8.3 | 9.0 |
| rangeSame | 6.5 | 7.1 |
| parityForces | 0.6 | 0.9 |
| forcedExits | 303.3 | 303.5 |
| shadedNeighbor | 18.4 | 18.2 |
| closingCell | 1.1 | 0.9 |
| deadEnd | 18.4 | 17.6 |
| deadEndNeighbor | 14.0 | 12.7 |
| clueDone | 53.5 | 49.0 |

Samples (in `samples.csv`):

| name | score | tier | hardest rule | clue cells | boxes |
| --- | --- | --- | --- | --- | --- |
| 20x32 d5 (score 621) | 621 | Hard | rangeFacing | 15.2% | 12.7% |
| 20x32 d4 (score 520) | 520 | Hard | shadeForcesLines | 16.4% | 12.0% |
| 20x32 d3 (score 464) | 464 | Hard | parityForces | 15.8% | 12.0% |
| 20x32 d2 (score 415) | 415 | Hard | shadeForcesLines | 15.2% | 12.7% |
| 20x32 d1 (score 323) | 323 | Hard | shadeForcesLines | 15.0% | 12.5% |
