#!/bin/sh
# Pools for the regional TEST CORPUS (branch experiment/regional): a spread of recipes at 6x6, 8x8 and 10x10 for Josh to play, so the
# techniques regional puzzles need can be found and named. Run from the project root (WORKERS=6 by default); two puzzles per job, output
# tools/library/regc_<recipe>_<size>_s<seed>.csv. Then:  node tools/build_regional_corpus.mjs
# Recipes (what each is for is in experiments/regional/CORPUS.md):
#   gentle      small regions (2-4 cells), EVERY region numbered, Beginner rules only
#   beginner    small regions, numbers pruned, Beginner rules only
#   medium      regions of about 4, numbers pruned, up to Medium rules
#   hard        regions of about 5, numbers pruned, all rules
#   big         big regions (about 8, up to 14), numbers pruned, all rules
#   rows, cols  every region a straight bar along a row / a column (2-5 cells), numbers pruned, all rules
#   stuck       the rules do not finish it but it is unique (found by search): positions that need a technique we do not have yet
# (ONLY=stuck runs just that recipe; the seeds stay the same)
# (a job line never ends in a blank: xargs -L would join it to the next line; zsh does not split $vars, so this is a /bin/sh script)
mkdir -p tools/library
JOBS=$(mktemp)
seed=7000
for size in 6x6 8x8 10x10; do
  case $size in 6x6) B=40;; 8x8) B=80;; 10x10) B=160;; esac
  for rec in gentle beginner medium hard big rows cols stuck; do
    case $rec in
      gentle) F="--max-tier beginner --accept 0 --avg-size 3 --max-size 4 --prune 0";;
      beginner) F="--max-tier beginner --accept 0 --avg-size 3 --max-size 5";;
      medium) F="--max-tier medium --accept 0 --avg-size 4 --max-size 7";;
      hard) F="--accept 12 --avg-size 5 --max-size 9";;
      big) F="--accept 12 --avg-size 8 --max-size 14";;
      rows) F="--accept 12 --shape rows --max-size 5";;
      cols) F="--accept 12 --shape cols --max-size 5";;
      stuck) F="--stuck --accept 25 --avg-size 5 --max-size 9";;
    esac
    seed=$((seed + 1))
    if [ -n "$ONLY" ] && [ "$ONLY" != "$rec" ]; then continue; fi
    echo "$size 2 $seed $B $rec $F" >> "$JOBS"
  done
done
wc -l < "$JOBS"
xargs -P "${WORKERS:-6}" -L 1 sh -c 'size=$0; n=$1; seed=$2; budget=$3; rec=$4; shift 4; node tools/generate.mjs --regional --size $size --count $n --seed $seed --budget $budget --out tools/library/regc_${rec}_${size}_s${seed}.csv "$@" > /dev/null 2>&1; echo done $size $rec' < "$JOBS"
rm -f "$JOBS"
