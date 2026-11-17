#!/bin/sh
# Pools for the VOIDS-ONLY experiment book: puzzles with no numbers and no arrows, only void cells (see generateVoidsOnly in js/generator.js).
# Run from the project root (WORKERS=6 by default); four puzzles per job, output tools/library/vo_<size>_s<seed>.csv. Then:
#   node tools/build_book.mjs --id voidsonly-corpus --name "Experiment: voids only" --glob vo_
# (SIZES="6x6 8x8" runs just those; SEED0 shifts every seed. A job line never ends in a blank, and zsh does not split $vars: /bin/sh script.)
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED0:-9000}
for size in ${SIZES:-6x6 8x8 10x10 12x12 14x14 16x16}; do
  case $size in 6x6) B=30; J=3;; 8x8) B=60; J=4;; 10x10) B=120; J=4;; 12x12) B=300; J=4;; 14x14) B=600; J=3;; 16x16) B=900; J=3;; esac
  j=0
  while [ $j -lt $J ]; do
    seed=$((seed + 1)); j=$((j + 1))
    echo "$size 4 $seed $B" >> "$JOBS"
  done
done
wc -l < "$JOBS"
xargs -P "${WORKERS:-6}" -L 1 sh -c 'node tools/generate.mjs --voids-only --size $0 --count $1 --seed $2 --budget $3 --out tools/library/vo_$0_s$2.csv > /dev/null 2>&1; echo done $0 s$2' < "$JOBS"
rm -f "$JOBS"
