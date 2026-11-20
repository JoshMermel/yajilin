#!/bin/sh
# Pools for the SPARSE books: for one board size, puzzles of every tier in each of three direction sets, as few arrows as the generator finds.
# Run from the project root:   SIZE=8x8 WORKERS=9 sh tools/make_sparse_tier_books.sh        (then tools/build_sparse_books.mjs)
#   SIZE      8x8 or 12x12 (16x16 and 20x36 are for tries: their budgets are guesses)
#   SEEDS     seeds per (tier, directions), default 3 for 8x8 and 8 for 12x12;   SEED0 shifts every seed;   WORKERS parallel jobs
# Tiers: "beginner" and "medium" cap the rules the search may use (a puzzle counts as unique only if rules up to that tier solve it, which
# also caps its difficulty); "hard" has no cap, so the exhaustive solver decides and trial and error is allowed. The tier of a puzzle in the
# pool is its rated tier, not the cap it was made under: a Medium-capped search that finds a Beginner puzzle gives a Beginner puzzle.
# Output: tools/library/spt_<size>_<cap>_<dirs>_s<seed>.csv (the pool; untracked). A job line never ends in a blank; zsh does not split $vars.
mkdir -p tools/library
SIZE=${SIZE:-8x8}
JOBS=$(mktemp)
case $SIZE in
  8x8)   SEEDS=${SEEDS:-3}; COUNT=5; BUDGET=60; BESTOF=20; XC=5000000;;
  12x12) SEEDS=${SEEDS:-8}; COUNT=1; BUDGET=900; BESTOF=100000; XC=0;;
  16x16) SEEDS=${SEEDS:-4}; COUNT=1; BUDGET=1500; BESTOF=100000; XC=0;;
  20x36) SEEDS=${SEEDS:-2}; COUNT=1; BUDGET=3000; BESTOF=100000; XC=0;;
esac
seed=${SEED0:-50000}
# target arrows (the search stops early on a puzzle this sparse, else keeps the sparsest in BESTOF tries or the budget): size cap dirs-name
target() {
  case "$1 $2 $3" in
    8x8\ beginner\ orth) echo 6;;   8x8\ medium\ orth) echo 5;;   8x8\ hard\ orth) echo 6;;
    8x8\ beginner\ diag) echo 5;;   8x8\ medium\ diag) echo 4;;   8x8\ hard\ diag) echo 5;;
    8x8\ *\ mix) echo 4;;
    12x12\ beginner\ orth) echo 17;; 12x12\ medium\ orth) echo 16;; 12x12\ hard\ orth) echo 17;;
    12x12\ beginner\ diag) echo 14;; 12x12\ medium\ diag) echo 14;; 12x12\ hard\ diag) echo 14;;
    12x12\ beginner\ mix) echo 12;;  12x12\ medium\ mix) echo 11;;  12x12\ hard\ mix) echo 11;;
    *) echo 100000;;                                         # no target (larger boards): no early stop, and the greedy bound is loose
  esac
}
for cap in hard medium beginner; do
  for dn in orth diag mix; do
    case $dn in orth) D=URDL;; diag) D=ECZQ;; mix) D=URDLECZQ;; esac
    MC=$(target $SIZE $cap $dn)
    k=0
    while [ $k -lt $SEEDS ]; do
      seed=$((seed + 1)); k=$((k + 1))
      echo "$SIZE $cap $dn $D $BUDGET $MC $seed $COUNT $BESTOF $XC" >> "$JOBS"
    done
  done
done
wc -l < "$JOBS"
xargs -P "${WORKERS:-9}" -L 1 sh -c 'T=""; [ $1 != hard ] && T="--max-tier $1"; node tools/generate.mjs --sparse --size $0 --count $7 --seed $6 --budget $4 --best-of $8 --max-clues $5 $T --dirs $3 --cross-check-nodes $9 --polish-ms 15 --polish-within 1 --out tools/library/spt_$0_$1_$2_s$6.csv > /dev/null 2>&1; echo done $0 $1 $2 s$6' < "$JOBS"
rm -f "$JOBS"
