#!/bin/sh
# Pools for the diagonal TEST CORPUS (branch experiment/diagonal): arrows that point along diagonals, at 6x6 to 12x12, in a spread of recipes
# for Josh to play so the techniques diagonal puzzles need can be named. Run from the project root (WORKERS=6 by default); two puzzles per
# job, output tools/library/diag_<recipe>_<size>_s<seed>.csv. Then:  node tools/build_diagonal_corpus.mjs
# Recipes (what each is for is in experiments/diagonal/CORPUS.md):
#   beginner, medium, hard   every arrow diagonal; Beginner rules only / up to Medium / all rules
# (a `bignum` recipe -- every arrow diagonal, numbers big -- produced nothing at 6x6 to 12x12 in the time given: diagonals are short and
#  mostly hold few boxes, so the style gap never closes)
#   half, quarter            half / a quarter of the arrows diagonal, the rest orthogonal (all rules)
# (a job line never ends in a blank: xargs -L would join it to the next line; zsh does not split $vars, so this is a /bin/sh script)
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED0:-6000}
for size in ${SIZES:-6x6 8x8 10x10 12x12}; do
  case $size in 6x6) B=30;; 8x8) B=60;; 10x10) B=120;; 12x12) B=240;; esac
  for rec in beginner medium hard half quarter; do
    case $rec in
      beginner) F="--diagonal 1 --max-tier beginner --accept 0";;
      medium) F="--diagonal 1 --max-tier medium --accept 0";;
      hard) F="--diagonal 1 --accept 30";;
      half) F="--diagonal 0.5 --accept 30";;
      quarter) F="--diagonal 0.25 --accept 30";;
    esac
    seed=$((seed + 1))
    if [ -n "$ONLY" ] && [ "$ONLY" != "$rec" ]; then continue; fi
    echo "$size ${COUNT:-2} $seed $B $rec $F" >> "$JOBS"
  done
done
wc -l < "$JOBS"
xargs -P "${WORKERS:-6}" -L 1 sh -c 'size=$0; n=$1; seed=$2; budget=$3; rec=$4; shift 4; node tools/generate.mjs --size $size --count $n --seed $seed --budget $budget --out tools/library/diag_${rec}_${size}_s${seed}.csv "$@" > /dev/null 2>&1; echo done $size $rec' < "$JOBS"
rm -f "$JOBS"
