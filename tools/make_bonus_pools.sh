#!/bin/sh
# Pools for the bonus books (run from the project root), eight generator runs at a time:
#   sh tools/make_bonus_pools.sh            # then, for each book, e.g.
#   node tools/build_book.mjs --id bonus-intro --name "Bonus: gentle intro" --glob intro3_
#   node tools/build_book.mjs --id bonus-longway --name "Bonus: the long way round" --glob longway
#   node tools/build_book.mjs --id bonus-onedir --name "Bonus: one direction" --glob onedir
#   node tools/build_book.mjs --id bonus-bignum --name "Bonus: big numbers" --glob bignum
#   node tools/build_skyscraper.mjs
# Each line: pool-file size count seed budget-seconds [generator flags]. A different seed from the first round per size, so the pools only grow.
mkdir -p tools/library experiments/tall/pools
cat <<'JOBS' | xargs -P 8 -L 1 sh -c 'node tools/generate.mjs --size $1 --count $2 --seed $3 --budget $4 --out $0 $5 $6 $7 $8 $9 > /dev/null 2>&1; echo done $0'
tools/library/intro3_5x5_s821.csv 5x5 2 821 30 --max-tier beginner --accept 0
tools/library/intro3_6x6_s821.csv 6x6 3 821 30 --max-tier beginner --accept 0
tools/library/intro3_7x7_s821.csv 7x7 3 821 30 --max-tier beginner --accept 0
tools/library/intro3_8x8_s821.csv 8x8 3 821 30 --max-tier beginner --accept 0
tools/library/intro3_9x9_s821.csv 9x9 3 821 30 --max-tier beginner --accept 0
tools/library/longway3_10x10_s831.csv 10x10 2 831 120 --edge-bias 0.1
tools/library/longway3_12x12_s832.csv 12x12 3 832 120 --edge-bias 0.1
tools/library/longway3_14x14_s833.csv 14x14 3 833 180 --edge-bias 0.1
tools/library/longway3_16x16_s834.csv 16x16 2 834 240 --edge-bias 0.1
tools/library/onedir3_8x8_s841.csv 8x8 3 841 120 --one-dir
tools/library/onedir3_10x10_s842.csv 10x10 3 842 120 --one-dir
tools/library/onedir3_12x12_s843.csv 12x12 2 843 180 --one-dir
tools/library/onedir3_14x14_s844.csv 14x14 2 844 240 --one-dir
tools/library/bignum3_10x10_s851.csv 10x10 3 851 120 --numbers big --density 0.36 --shade 0.6
tools/library/bignum3_12x12_s852.csv 12x12 3 852 180 --numbers big --density 0.36 --shade 0.6
tools/library/bignum3_14x14_s853.csv 14x14 2 853 240 --numbers big --density 0.36 --shade 0.6
tools/library/bignum3_16x16_s854.csv 16x16 2 854 300 --numbers big --density 0.36 --shade 0.6
experiments/tall/pools/tall_4x30.csv 4x30 3 861 120
experiments/tall/pools/tall_5x24.csv 5x24 3 862 120
experiments/tall/pools/tall_5x36.csv 5x36 3 863 150
experiments/tall/pools/tall_6x36.csv 6x36 3 864 180
experiments/tall/pools/tall_7x30.csv 7x30 3 865 180
experiments/tall/pools/tall_8x30.csv 8x30 3 866 240
experiments/tall/pools/tall_8x36.csv 8x36 3 867 300
experiments/tall/pools/tall_3x20.csv 3x20 2 868 60
JOBS
