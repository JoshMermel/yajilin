#!/bin/sh
# Pools for the Skyscraper books (4x36, 6x36, 8x36), 2026-11-22. Run from the project root (WORKERS=9), then  node tools/build_skyscraper.mjs
# Beginner and Medium puzzles come from runs capped to those rules, Hard from uncapped runs (a quarter of the 4x36 puzzles are Hard, two thirds of the 6x36).
# Output: tools/library/sky_<cap>_<size>_s<seed>.csv. Measured per puzzle on one core: capped Beginner 0.3 / 0.8 / 1.8 s, capped Medium 0.9 / 2.7 / 8.3 s,
# uncapped 3 / 5 / 9 s (4x36 / 6x36 / 8x36).
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED:-41000}
emit() {   # size cap jobs per-job [flags]
  size=$1; cap=$2; jobs=$3; per=$4; shift 4
  k=0
  while [ $k -lt $jobs ]; do
    k=$((k + 1)); seed=$((seed + 1))
    echo "tools/library/sky_${cap}_${size}_s${seed}.csv $size $per $seed 90 $*"
  done
}
{
  for size in 8x36 6x36 4x36; do
    case $size in 4x36) h="10 50"; m="5 25";; 6x36) h="10 20"; m="5 25";; 8x36) h="10 25"; m="5 25";; esac
    emit $size hard $h --prune 1
    emit $size medium $m --max-tier medium
    emit $size beginner 2 63 --max-tier beginner
  done
} > "$JOBS"
wc -l < "$JOBS"
xargs -P "${WORKERS:-9}" -L 1 sh -c 'perl -e "alarm ${CAP:-1800}; exec @ARGV" node tools/generate.mjs --size $1 --count $2 --seed $3 --budget $4 --out $0 $5 $6 > /dev/null 2>&1; echo done $0' < "$JOBS"
rm -f "$JOBS"
