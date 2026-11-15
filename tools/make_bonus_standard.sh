#!/bin/sh
# Top up the bonus books at their STANDARD sizes (2026-11-15; replaces make_bonus_100.sh's many-sizes plan). Run from the project root.
#   10x10 / 12x12 / 14x14 for longway, onedir, few, packed, big numbers (the twos-and-up puzzles already in the pool count as big numbers);  10x10 / 12x12 / 14x14 for zeros too;  5x5 .. 8x8 for the intro;
#   4x36 / 6x36 / 8x36 for skinny.  (Counts below are what was missing at the time, plus a margin for duplicates.)
# Each job line: book out-file size count seed budget-seconds generator-flags... ; nine run at a time, slowest books first.
# Then rebuild with  build_book.mjs --sizes ... --limit 100  (see the "Rebuild" list in README / TODO).
mkdir -p tools/library experiments/tall/pools
JOBS=$(mktemp)
seed=${SEED:-3009}        # (3001-3009 were twos jobs that were dropped when twos merged into big numbers; the seeds stay skipped)
emit() {   # book dir prefix size total per-job budget flags...
  book=$1; dir=$2; prefix=$3; size=$4; total=$5; per=$6; budget=$7; shift 7
  while [ "$total" -gt 0 ]; do
    n=$per; [ "$total" -lt "$n" ] && n=$total
    seed=$((seed + 1))
    echo "$book $dir/${prefix}_${size}_s${seed}.csv $size $n $seed $budget${*:+ $*}"   # no trailing blank: xargs -L would join such a line to the next
    total=$((total - n))
  done
}
L=tools/library; T=experiments/tall/pools
{
  for s in "10x10 20" "12x12 20" "14x14 24"; do set -- $s; emit bignum $L bignum $1 $2 6 300 --numbers big --density 0.36 --shade 0.6; done
  for s in "10x10 20 6" "12x12 14 7" "14x14 12 4"; do set -- $s; emit packed $L packed $1 $2 $3 400 --shade 0.85 --boxes 0.55,1 --density 0.26; done
  for s in 4x36:30 6x36:32 8x36:32; do emit skinny $T tall ${s%%:*} ${s##*:} 4 300; done
  for s in "10x10 28" "12x12 24" "14x14 24"; do set -- $s; emit longway $L longway $1 $2 6 240 --edge-bias 0.1; done
  for s in "10x10 26" "12x12 26" "14x14 28"; do set -- $s; emit onedir $L onedir $1 $2 6 240 --one-dir; done
  for s in "10x10 26" "12x12 24" "14x14 26"; do set -- $s; emit few $L few $1 $2 6 240 --shade 0.2 --prune 0 --boxes 0,0.3; done
  # all zeros at 10x10 / 12x12 / 14x14 (2026-11-15): feasible all along; the old recipe lost every puzzle to the prune step, which turned
  # arrows into boxes inside other arrows' lines (see pruneClues). Three recipes for variety, 12 puzzles each per size, seconds apiece.
  for s in 10x10 12x12 14x14; do
    emit zeros $L zeros $s 12 6 120 --numbers zeros --shade 0.30 --density 0.30
    emit zeros $L zeros $s 12 6 120 --numbers zeros --shade 0.15 --density 0.40
    emit zeros $L zeros $s 12 6 120 --numbers zeros
  done
  for s in "5x5 20" "6x6 16" "7x7 16" "8x8 16"; do set -- $s; emit intro $L intro3 $1 $2 8 30 --max-tier beginner --accept 0; done
} > "$JOBS"
[ -n "$ONLY" ] && { grep -E "^($ONLY) " "$JOBS" > "$JOBS.only"; mv "$JOBS.only" "$JOBS"; }   # ONLY="skinny|longway" SEED=5000 sh tools/make_bonus_standard.sh: just those books
wc -l < "$JOBS"
xargs -P 9 -L 1 sh -c 'node tools/generate.mjs --size $2 --count $3 --seed $4 --budget $5 --out $1 $6 $7 $8 $9 ${10} ${11} ${12} ${13} > /dev/null 2>&1; echo done $1' < "$JOBS"
rm -f "$JOBS"
