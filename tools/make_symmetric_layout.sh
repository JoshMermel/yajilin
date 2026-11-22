#!/bin/sh
# Pools for the symmetric-LAYOUT bonus books (2026-11-22): the clue cells come in symmetric orbits (a mirror, a transposition, a quarter turn or a half turn
# maps every clue cell to a clue cell) but the arrows point any way and the numbers, boxes and loop are free (js/generator_symmetry.js, layoutOnly),
# at 8x8 and 12x12 (SIZES="16x16" for the overnight 16x16 run), in three rule caps (Beginner rules only, up to Medium, everything).
# Run from the project root (WORKERS=9), then
#   node tools/build_symmetric_layout.mjs
# Output: tools/library/lsym_<mode>_<cap>_<size>_s<seed>.csv
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED:-9950}
for mode in rot180 rot90 mirror transpose; do
  for size in ${SIZES:-8x8 12x12}; do
    for cap in beginner medium hard; do
      k=0
      while [ $k -lt ${JOBS_PER:-6} ]; do
        k=$((k + 1)); seed=$((seed + 1))
        flag="--prune 1"; [ $cap != hard ] && flag="--max-tier $cap"        # (a job line never ends in a blank: xargs -L would join it to the next)
        echo "tools/library/lsym_${mode}_${cap}_${size}_s${seed}.csv $size $seed layout-$mode $flag"
      done
    done
  done
done > "$JOBS"
wc -l < "$JOBS"
xargs -P "${WORKERS:-9}" -L 1 sh -c 'perl -e "alarm ${CAP:-1800}; exec @ARGV" node tools/generate.mjs --layout $3 --size $1 --count ${PER:-15} --seed $2 --budget ${BUDGET:-20} --out $0 $4 $5 > /dev/null 2>&1; echo done $0' < "$JOBS"
rm -f "$JOBS"
