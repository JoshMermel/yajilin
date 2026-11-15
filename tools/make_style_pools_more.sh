#!/bin/sh
# A second round for the style books (run after make_style_pools.sh; different seeds, so the pools only grow).
cat <<'JOBS' | xargs -P 8 -L 1 sh -c 'node tools/generate.mjs --size $1 --count $2 --seed $3 --budget $4 --out $0 $5 $6 $7 $8 $9 > /dev/null 2>&1; echo done $0'
tools/library/zeros_6x6_s941.csv 6x6 2 941 60 --numbers zeros
tools/library/zeros_7x7_s942.csv 7x7 3 942 90 --numbers zeros
tools/library/zeros_8x8_s943.csv 8x8 4 943 120 --numbers zeros
tools/library/zeros_9x9_s944.csv 9x9 3 944 240 --numbers zeros
tools/library/zeros_10x10_s945.csv 10x10 2 945 300 --numbers zeros
tools/library/twos_10x10_s951.csv 10x10 2 951 300 --numbers twos --density 0.36 --shade 0.65
tools/library/twos_12x12_s952.csv 12x12 3 952 300 --numbers twos --density 0.36 --shade 0.65
tools/library/twos_12x12_s953.csv 12x12 3 953 300 --numbers twos --density 0.3 --shade 0.7
tools/library/packed_10x10_s961.csv 10x10 3 961 300 --shade 0.85 --boxes 0.55,1 --density 0.26
tools/library/packed_12x12_s962.csv 12x12 3 962 300 --shade 0.85 --boxes 0.55,1 --density 0.26
tools/library/packed_12x12_s963.csv 12x12 3 963 300 --shade 0.8 --boxes 0.5,1 --density 0.28
tools/library/few_8x8_s971.csv 8x8 2 971 60 --shade 0.2 --prune 0 --boxes 0,0.3
tools/library/few_10x10_s972.csv 10x10 2 972 90 --shade 0.2 --prune 0 --boxes 0,0.3
tools/library/few_12x12_s973.csv 12x12 2 973 120 --shade 0.2 --prune 0 --boxes 0,0.3
JOBS
