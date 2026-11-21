#!/bin/sh
# Pools for the symmetric bonus books (2026-11-21): arrows and boxes the same after a half turn of the board, at 8x8 and 12x12, in three
# rule caps (Beginner rules only, up to Medium, everything) so that all the tiers are covered. Run from the project root (WORKERS=9), then
#   node tools/build_symmetric.mjs
# Output: tools/library/sym_<cap>_<size>_s<seed>.csv
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED:-9800}
for size in 8x8 12x12; do
  for cap in beginner medium hard; do
    k=0
    while [ $k -lt ${JOBS_PER:-10} ]; do
      k=$((k + 1)); seed=$((seed + 1))
      flag="--prune 1"; [ $cap != hard ] && flag="--max-tier $cap"        # (a job line never ends in a blank: xargs -L would join it to the next)
      echo "tools/library/sym_${cap}_${size}_s${seed}.csv $size $seed $flag"
    done
  done
done > "$JOBS"
wc -l < "$JOBS"
xargs -P "${WORKERS:-9}" -L 1 sh -c 'perl -e "alarm 1800; exec @ARGV" node tools/generate.mjs --layout symmetric --size $1 --count ${PER:-15} --seed $2 --budget 20 --out $0 $3 $4 > /dev/null 2>&1; echo done $0' < "$JOBS"
rm -f "$JOBS"
