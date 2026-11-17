#!/bin/sh
# Pools for the DIAGONAL books (data/diagonal-{all,mixed}-<size>.csv), 6x6 to 20x36. Run from the project root; then
#   node tools/build_diagonal_corpus.mjs
# Output tools/library/dg_<kind>_<tier>_<size>_s<seed>.csv. Kinds:
#   all        every arrow diagonal (--diagonal 1)
#   mixNN      NN% of the arrows diagonal, the rest orthogonal (25, 50, 75: the builder keeps only puzzles with both kinds)
# Tiers: beginner / medium (only the rules up to that tier, no lookahead) and hard (all rules).
# Env: WORKERS (9), SEED0 (8000), ALL (puzzles per all-diagonal tier, 60), MIX (per mixed share and tier, 20), CHUNK (puzzles per job, 20),
#      SIZES, KINDS (default "all mix25 mix50 mix75"), TIERS (default "beginner medium hard"), ONLY (one kind).
# (a job line never ends in a blank: xargs -L would join it to the next line; zsh does not split $vars, so this is a /bin/sh script)
mkdir -p tools/library
JOBS=$(mktemp)
seed=${SEED0:-8000}
CH=${CHUNK:-20}
for size in ${SIZES:-6x6 8x8 10x10 12x12 14x14}; do
  case $size in 6x6) B=30;; 8x8) B=60;; 10x10) B=120;; 12x12) B=180;; 14x14|16x16) B=240;; 20x20) B=300;; *) B=400;; esac
  for kind in ${KINDS:-all mix25 mix50 mix75}; do
    case $kind in all) D=1; N=${ALL:-60};; mix25) D=0.25; N=${MIX:-20};; mix50) D=0.5; N=${MIX:-20};; mix75) D=0.75; N=${MIX:-20};; esac
    for tier in ${TIERS:-beginner medium hard}; do
      case $tier in beginner) F="--max-tier beginner --accept 0";; medium) F="--max-tier medium --accept 0";; hard) F="--accept 30";; esac
      if [ -n "$ONLY" ] && [ "$ONLY" != "$kind" ]; then continue; fi
      left=$N
      while [ $left -gt 0 ]; do
        n=$CH; if [ $left -lt $n ]; then n=$left; fi
        left=$((left - n))
        seed=$((seed + 1))
        echo "$size $n $seed $B ${kind}_${tier} --diagonal $D $F" >> "$JOBS"
      done
    done
  done
done
wc -l < "$JOBS"
xargs -P "${WORKERS:-9}" -L 1 sh -c 'size=$0; n=$1; seed=$2; budget=$3; rec=$4; shift 4; node tools/generate.mjs --size $size --count $n --seed $seed --budget $budget --out tools/library/dg_${rec}_${size}_s${seed}.csv "$@" > /dev/null 2>&1; echo done $size $rec' < "$JOBS"
rm -f "$JOBS"
