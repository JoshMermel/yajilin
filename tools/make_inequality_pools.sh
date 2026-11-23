#!/bin/sh
# Pools for the Inequality books (clues that say "at least", "at most" or "not" n boxes), 2026-11-23. Run from the project root, then  node tools/build_inequality_books.mjs
# Output: tools/library/ineq/ineq_<size>_s<seed>.csv. Each puzzle has at least MINOPS inequality clues (--min-ops) out of a mix of 25% at least, 25% at most and 15% not.
mkdir -p tools/library/ineq
JOBS=$(mktemp)
seed=${SEED:-51000}
emit() {   # size jobs per-job minops
  size=$1; jobs=$2; per=$3; minops=$4
  k=0
  while [ $k -lt $jobs ]; do
    k=$((k + 1)); seed=$((seed + 1))
    echo "tools/library/ineq/ineq_${size}_s${seed}.csv $size $per $seed 90 $minops"
  done
}
{
  emit 8x8 4 40 3
  emit 10x10 4 25 4
  emit 12x12 6 20 5
} > "$JOBS"
xargs -P "${WORKERS:-8}" -L 1 sh -c 'perl -e "alarm ${CAP:-1800}; exec @ARGV" node tools/generate.mjs --size $1 --count $2 --seed $3 --budget $4 --ops mixed --min-ops $5 --out $0 > /dev/null 2>&1; echo done $0' < "$JOBS"
rm -f "$JOBS"
