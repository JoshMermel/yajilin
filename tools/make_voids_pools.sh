#!/bin/sh
# Pools for the "Voids" bonus book (2026-11-15): puzzles with void cells at 8x8, 10x10 and 12x12, in three difficulty recipes
# (Beginner rules only; Beginner + Medium; and the full rule set, which gives Medium and Hard) and three void counts per size.
# Run from the project root; nine jobs per size, five puzzles each; output tools/library/voids_<size>_<recipe>_k<voids>_s<seed>.csv.
# Then:  node tools/build_book.mjs --id bonus-voids --name "Bonus: voids" --glob voids_ --sizes 8x8,10x10,12x12 --limit 36
# (job lines never end in a blank: xargs -L would join such a line to the next one)
mkdir -p tools/library
JOBS=$(mktemp)
seed=8000
for size in 8x8 10x10 12x12; do
  case $size in 8x8) KS="3 4 5"; B=60;; 10x10) KS="4 6 8"; B=90;; 12x12) KS="6 8 10"; B=150;; esac
  for k in $KS; do
    for rec in hard medium beginner; do
      case $rec in beginner) F="--max-tier beginner --accept 0";; medium) F="--max-tier medium --accept 0";; hard) F="--accept 30";; esac
      seed=$((seed + 1))
      echo "$size 5 $seed $B $k $rec $F" >> "$JOBS"
    done
  done
done
wc -l < "$JOBS"
xargs -P "${WORKERS:-6}" -L 1 sh -c 'node tools/generate.mjs --size $0 --count $1 --seed $2 --budget $3 --voids $4 --out tools/library/voids_$0_$5_k$4_s$2.csv $6 $7 $8 $9 > /dev/null 2>&1; echo done $0 $5 k$4' < "$JOBS"
rm -f "$JOBS"
