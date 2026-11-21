#!/bin/sh
# Pools for the split bonus books (2026-11-20): the long way round, one direction, all zeros and no zeros, each at 8x8 and 12x12.
# Run from the project root (WORKERS=9 by default), then:  node tools/build_bonus_split.mjs
# Output: tools/library/bs_<recipe>_<size>_s<seed>.csv. A job line never ends in a blank (xargs -L would join it to the next).
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED:-9100}
emit() {   # recipe size total per-job budget flags...
  r=$1; size=$2; total=$3; per=$4; budget=$5; shift 5
  while [ "$total" -gt 0 ]; do
    n=$per; [ "$total" -lt "$n" ] && n=$total
    seed=$((seed + 1))
    echo "tools/library/bs_${r}_${size}_s${seed}.csv $size $n $seed $budget${*:+ $*}"
    total=$((total - n))
  done
}
{
  for s in "8x8 400" "12x12 400"; do set -- $s
    [ -n "$ONLYSIZE" ] && [ "$ONLYSIZE" != "$1" ] && continue     # ONLYSIZE=12x12 SEED=9300 sh tools/make_bonus_split.sh: just that size
    emit longway $1 $2 20 300 --edge-bias 0.1
    emit onedir  $1 $2 20 300 --one-dir
    emit zeros   $1 $2 20 300 --numbers zeros
    # no zeros: four recipes, mixed in the book. "nz" leans big with the classic big-numbers knobs, "nzd" with the defaults, and the two "t"
    # ones ask for every arrow to say 2 or more. (Not at 8x8: there are very few such puzzles and each job just burns its whole budget.)
    emit nz   $1 $2 20 300 --numbers nozeros --density 0.36 --shade 0.6
    emit nzd  $1 $2 20 300 --numbers nozeros
    [ "$1" = 8x8 ] && continue
    emit t2   $1 $2 20 300 --numbers twos
    emit t2d  $1 $2 20 300 --numbers twos --density 0.36 --shade 0.6
  done
} > "$JOBS"
wc -l < "$JOBS"
xargs -P "${WORKERS:-9}" -L 1 sh -c 'node tools/generate.mjs --size $1 --count $2 --seed $3 --budget $4 --out $0 $5 $6 $7 $8 $9 > /dev/null 2>&1; echo done $0' < "$JOBS"
rm -f "$JOBS"
