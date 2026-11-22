#!/bin/sh
# Pools for the exact-symmetry bonus books (2026-11-22): the whole puzzle (boxes, arrows, voids, numbers, and so the loop) is the same after a mirror,
# a transposition or a quarter turn (js/generator_symmetry.js), at 8x8 and 12x12, in three rule caps (Beginner rules only, up to Medium, everything).
# Run from the project root (WORKERS=9), then
#   node tools/build_symmetry_exact.mjs
# Output: tools/library/xsym_<mode>_<cap>_<size>_s<seed>.csv
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED:-9900}
for mode in mirror transpose rot90; do
  for size in 8x8 12x12; do
    for cap in beginner medium hard; do
      k=0
      while [ $k -lt ${JOBS_PER:-6} ]; do
        k=$((k + 1)); seed=$((seed + 1))
        flag="--prune 1"; [ $cap != hard ] && flag="--max-tier $cap"        # (a job line never ends in a blank: xargs -L would join it to the next)
        echo "tools/library/xsym_${mode}_${cap}_${size}_s${seed}.csv $size $seed $mode $flag"
      done
    done
  done
done > "$JOBS"
wc -l < "$JOBS"
xargs -P "${WORKERS:-9}" -L 1 sh -c 'perl -e "alarm 1800; exec @ARGV" node tools/generate.mjs --layout $3 --size $1 --count ${PER:-15} --seed $2 --budget 20 --out $0 $4 $5 > /dev/null 2>&1; echo done $0' < "$JOBS"
rm -f "$JOBS"
