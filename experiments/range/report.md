# Difficulty range

Pools: `experiments/range/pools` (Nikoli-style settings: --edge-bias 0.8 --shade 0.7). Difficulty = the human-style solver's score; every puzzle is rule-solved, hence unique.

## 16x16 (60 puzzles)

score: min 1287, 10% 1575, 25% 1906, median 2225, 75% 2739, 90% 3160, max 3946 (mean 2295, sd 579, max/min 3.07)  
score per cell: mean 8.97, sd 2.26  
clue cells 16.0%, boxes 11.3%  
tiers: Hard 60  
hardest rule needed: segmentForcesLines 26, parityForces 24, shadeForcesLines 10

```
1287-1553 ###### 6
1553-1819 ######## 8
1819-2085 ######## 8
2085-2351 ################ 16
2351-2617 ##### 5
2617-2882 ######### 9
2882-3148 ## 2
3148-3414 ### 3
3414-3680 ## 2
3680-3946 # 1
```

Steps by rule, easiest quarter vs hardest quarter (mean uses per puzzle):

| rule | easiest quarter | hardest quarter |
| --- | --- | --- |
| shadeForcesLines | 4.3 | 15.5 |
| tightCell | 18.4 | 23.6 |
| segmentForcesLines | 1.0 | 5.3 |
| noEarlyClose | 10.5 | 12.8 |
| parityForces | 0.1 | 1.5 |
| sameSegmentExits | 2.9 | 4.0 |
| segmentClosesLoop | 0.1 | 1.0 |
| fullCells | 50.6 | 51.5 |
| clueFull | 13.6 | 14.4 |
| rangeSame | 0.3 | 0.8 |
| closingCell | 0.3 | 0.8 |
| rangeSameOne | 0.3 | 0.7 |
| cluePlacements | 2.3 | 2.6 |
| closingNeighbor | 0.9 | 1.1 |
| edgesOffShaded | 24.6 | 24.9 |
| rangeFacingKnown | 0.4 | 0.2 |
| deadEndNeighbor | 4.4 | 3.9 |
| forcedExits | 126.1 | 125.4 |
| clueDone | 23.5 | 22.1 |
| shadedNeighbor | 11.8 | 10.1 |
| deadEnd | 8.9 | 6.9 |
| edgeEnds | 52.6 | 45.0 |

Samples (in `samples.csv`):

| name | score | tier | hardest rule | clue cells | boxes |
| --- | --- | --- | --- | --- | --- |
| 16x16 d5 (score 3946) | 3946 | Hard | parityForces | 15.6% | 10.2% |
| 16x16 d4 (score 2731) | 2731 | Hard | parityForces | 16.0% | 10.5% |
| 16x16 d3 (score 2225) | 2225 | Hard | segmentForcesLines | 17.6% | 9.8% |
| 16x16 d2 (score 1906) | 1906 | Hard | segmentForcesLines | 15.2% | 13.7% |
| 16x16 d1 (score 1287) | 1287 | Hard | shadeForcesLines | 16.4% | 13.3% |

## 20x32 (41 puzzles)

score: min 4359, 10% 5105, 25% 5490, median 5969, 75% 6429, 90% 6913, max 7977 (mean 5981, sd 753, max/min 1.83)  
score per cell: mean 9.34, sd 1.18  
clue cells 15.8%, boxes 11.4%  
tiers: Hard 41  
hardest rule needed: parityForces 25, segmentForcesLines 9, rangeFacing 3, shadeForcesLines 2, segmentClosesLoop 2

```
4359-4721 ### 3
4721-5083 # 1
5083-5444 ###### 6
5444-5806 ##### 5
5806-6168 ########### 11
6168-6530 ##### 5
6530-6892 ##### 5
6892-7253 ### 3
7253-7615 # 1
7615-7977 # 1
```

Steps by rule, easiest quarter vs hardest quarter (mean uses per puzzle):

| rule | easiest quarter | hardest quarter |
| --- | --- | --- |
| segmentForcesLines | 4.9 | 15.6 |
| shadeForcesLines | 17.7 | 27.2 |
| fullCells | 134.7 | 140.6 |
| sameSegmentExits | 8.8 | 11.7 |
| segmentClosesLoop | 0.3 | 3.1 |
| parityForces | 0.8 | 2.9 |
| rangeFacingKnown | 1.1 | 2.5 |
| closingNeighbor | 2.3 | 3.2 |
| clueDone | 49.0 | 49.5 |
| shadeClosesLoop | 0.8 | 0.9 |
| pairedEnds | 0.4 | 0.4 |
| rangeSameOne | 1.7 | 1.6 |
| deadEnd | 17.5 | 17.3 |
| closingCell | 1.5 | 1.3 |
| rangeSame | 7.0 | 6.7 |
| cluePlacements | 7.8 | 7.3 |
| forcedExits | 302.8 | 301.4 |
| tightCell | 54.1 | 52.1 |
| shadedNeighbor | 26.1 | 23.5 |
| clueFull | 33.8 | 30.8 |
| noEarlyClose | 24.8 | 21.6 |
| edgesOffShaded | 63.7 | 60.0 |
| deadEndNeighbor | 14.4 | 10.0 |
| edgeEnds | 100.8 | 91.9 |

Samples (in `samples.csv`):

| name | score | tier | hardest rule | clue cells | boxes |
| --- | --- | --- | --- | --- | --- |
| 20x32 d5 (score 7977) | 7977 | Hard | rangeFacing | 16.3% | 11.9% |
| 20x32 d4 (score 6429) | 6429 | Hard | parityForces | 14.7% | 10.6% |
| 20x32 d3 (score 5969) | 5969 | Hard | parityForces | 15.6% | 10.0% |
| 20x32 d2 (score 5490) | 5490 | Hard | parityForces | 15.0% | 11.3% |
| 20x32 d1 (score 4359) | 4359 | Hard | shadeForcesLines | 15.2% | 12.7% |
