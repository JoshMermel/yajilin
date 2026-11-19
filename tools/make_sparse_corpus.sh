#!/bin/sh
# Pools for the SPARSE experiment book: as few clues as the generator can find, difficulty not controlled (see generateSparse in js/generator.js).
# Run from the project root (WORKERS=6 by default); output tools/library/sp_<size>_s<seed>.csv. Then:
#   node tools/build_book.mjs --id sparse-corpus --name "Experiment: sparse" --glob sp_
# (SIZES="6x6 8x8" runs just those; SEED0 shifts every seed. A job line never ends in a blank, and zsh does not split $vars: /bin/sh script.)
# MODE=diag (every arrow diagonal) or MODE=mix (all eight directions) makes the sparse diagonal books: pools spd_* / spm_*, then
#   node tools/build_book.mjs --id sparse-diagonal-corpus --name "Experiment: sparse diagonal" --glob spd_
#   node tools/build_book.mjs --id sparse-mixed-corpus --name "Experiment: sparse diagonal and orthogonal" --glob spm_
# Each job makes P puzzles, each the first of up to BEST tries with at most MAXC clues (else the sparsest of them), within B seconds.
# Boards of 100 cells and up skip the from-scratch cross-check (it cannot finish there; tools/audit_books.mjs checks uniqueness instead).
mkdir -p tools/library
JOBS=$(mktemp)
MODE=${MODE:-orth}
case $MODE in
  diag) DIRS=ECZQ; PFX=spd; seed=${SEED0:-22000};;
  mix) DIRS=URDLECZQ; PFX=spm; seed=${SEED0:-32000};;
  *) DIRS=""; PFX=sp; seed=${SEED0:-12000};;
esac
for size in ${SIZES:-6x6 7x7 8x8 9x9 10x10 12x12}; do
  case $size in
    6x6) P=8; J=3; BEST=400; B=90; MAXC=3; XC=5000000; PM=30; PW=2; MN=300000;;
    7x7) P=6; J=3; BEST=150; B=150; MAXC=4; XC=5000000; PM=30; PW=2; MN=300000;;
    8x8) P=5; J=3; BEST=60; B=240; MAXC=6; XC=5000000; PM=30; PW=2; MN=300000;;
    9x9) P=3; J=4; BEST=30; B=420; MAXC=8; XC=0; PM=30; PW=2; MN=300000;;
    10x10) P=2; J=4; BEST=15; B=600; MAXC=10; XC=0; PM=30; PW=2; MN=300000;;
    12x12) P=1; J=9; BEST=100000; B=1500; MAXC=13; XC=0; PM=15; PW=1; MN=20000;;
  esac
  if [ "$MODE" = diag ]; then case $size in 7x7) MAXC=4;; 8x8) MAXC=5;; 9x9) MAXC=7;; 10x10) MAXC=9;; 12x12) J=6;; esac; fi
  if [ "$MODE" = mix ]; then case $size in 7x7) MAXC=3;; 8x8) MAXC=5;; 9x9) MAXC=6;; 10x10) MAXC=8;; 12x12) MAXC=11; J=6;; esac; fi
  j=0
  while [ $j -lt $J ]; do
    seed=$((seed + 1)); j=$((j + 1))
    echo "$size $P $seed $B $BEST $MAXC $XC $PM $PW $MN" >> "$JOBS"
  done
done
wc -l < "$JOBS"
export DIRS PFX
xargs -P "${WORKERS:-6}" -L 1 sh -c 'node tools/generate.mjs --sparse ${DIRS:+--dirs $DIRS} --size $0 --count $1 --seed $2 --budget $3 --best-of $4 --max-clues $5 --cross-check-nodes $6 --polish-ms $7 --polish-within $8 --max-nodes $9 --out tools/library/${PFX}_$0_s$2.csv > /dev/null 2>&1; echo done $0 s$2' < "$JOBS"
rm -f "$JOBS"
