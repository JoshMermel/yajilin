#!/bin/sh
# Pools for the "number and box style" bonus books (run from the project root), eight generator runs at a time:
#   zeros   every arrow says 0 (--numbers zeros); small boards only: on 12x12 and up the generator finds none
#   twos    every arrow says 2 or more (--numbers twos): slow, one puzzle in a few minutes at 12x12
#   few     the solution has few boxes: at most 30% of the non-loop cells (--boxes 0,0.3, starting shade share 0.2, no pruning); easy to make
#   packed  the solution has tons of boxes: at least 55% (--boxes 0.55,1): slow, and rarely easy
# Then: node tools/build_book.mjs --id bonus-zeros --name "Bonus: all zeros" --glob zeros_   (and twos_, few_, packed_)
mkdir -p tools/library
cat <<'JOBS' | xargs -P 8 -L 1 sh -c 'node tools/generate.mjs --size $1 --count $2 --seed $3 --budget $4 --out $0 $5 $6 $7 $8 $9 > /dev/null 2>&1; echo done $0'
tools/library/zeros_6x6_s901.csv 6x6 2 901 60 --numbers zeros
tools/library/zeros_7x7_s902.csv 7x7 2 902 60 --numbers zeros
tools/library/zeros_8x8_s903.csv 8x8 3 903 90 --numbers zeros
tools/library/zeros_9x9_s904.csv 9x9 2 904 120 --numbers zeros
tools/library/zeros_10x10_s905.csv 10x10 3 905 180 --numbers zeros
tools/library/twos_10x10_s911.csv 10x10 3 911 300 --numbers twos --density 0.36 --shade 0.65
tools/library/twos_12x12_s912.csv 12x12 3 912 300 --numbers twos --density 0.36 --shade 0.65
tools/library/twos_14x14_s913.csv 14x14 2 913 400 --numbers twos --density 0.36 --shade 0.65
tools/library/few_8x8_s921.csv 8x8 2 921 60 --shade 0.2 --prune 0 --boxes 0,0.3
tools/library/few_10x10_s922.csv 10x10 3 922 90 --shade 0.2 --prune 0 --boxes 0,0.3
tools/library/few_12x12_s923.csv 12x12 3 923 120 --shade 0.2 --prune 0 --boxes 0,0.3
tools/library/few_14x14_s924.csv 14x14 2 924 180 --shade 0.2 --prune 0 --boxes 0,0.3
tools/library/few_16x16_s925.csv 16x16 2 925 240 --shade 0.2 --prune 0 --boxes 0,0.3
tools/library/packed_10x10_s931.csv 10x10 3 931 300 --shade 0.85 --boxes 0.55,1 --density 0.26
tools/library/packed_12x12_s932.csv 12x12 3 932 300 --shade 0.85 --boxes 0.55,1 --density 0.26
tools/library/packed_14x14_s933.csv 14x14 2 933 400 --shade 0.85 --boxes 0.55,1 --density 0.26
JOBS
