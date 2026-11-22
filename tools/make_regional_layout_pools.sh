#!/bin/sh
# Layout-first regional pools (an experiment): for each kind and size, draw layouts (tools/regional_layouts.mjs), let OR-tools find a
# unique solution (tools/cpsat_regional.py), drop numbers and rate (tools/regional_json_to_pool.mjs) into tools/library/regl_<kind>_<size>.csv.
#   SEEDS=10 JOBS=3 KINDS="rooms symmetric dominoes tetrominoes" SIZES="8x8 10x10" TIER=Medium TIME=150 COUNT=4 sh tools/make_regional_layout_pools.sh
#   KINDS=pentominoes SIZES=12x5 sh tools/make_regional_layout_pools.sh        (one of each pentomino: 60 cells)
# START: the first seed (default 1), so a later run adds new layouts instead of repeating old ones.
# COUNT: unique solutions OR-tools looks for per layout within TIME seconds; the pool step keeps the one the rules handle best.
# Needs OR-tools (the star battle venv: PY=~/projects/entangled_star_battle/jbum/venv/bin/python3).
cd "$(dirname "$0")/.." || exit 1
export PY=${PY:-$HOME/projects/entangled_star_battle/jbum/venv/bin/python3}
export TIER=${TIER:-Medium} TIME=${TIME:-150} COUNT=${COUNT:-4}
if [ "$1" = "--one" ]; then                       # one job: kind size seed
  k=$2; s=$3; n=$4; f="$WORK/$k-$s-$n"
  case "$k-$s" in
    rooms-8x8) o="--min 2 --max 7";; rooms-*) o="--min 2 --max 6";;
    symmetric-8x8) o="--avg 4 --max 7";; symmetric-*) o="--avg 3 --max 6";;
    *) o="";;
  esac
  node tools/regional_layouts.mjs --kind "$k" --size "$s" --seed "$n" $o --out "$f.json" > /dev/null || exit 0
  if "$PY" tools/cpsat_regional.py --layout "$f.json" --density 0.2,0.28 --seed "$n" --time "$TIME" --count "$COUNT" --workers 3 --out "$f.sol.json" 2> "$f.log"; then
    node tools/regional_json_to_pool.mjs "$f.sol.json" --name "REGL-$(echo "$k" | tr a-z A-Z)-$s-$n" --tier "$TIER" --seed "$n" --out "tools/library/regl_${k}_${s}.csv"
  else echo "$k $s $n: $(tail -1 "$f.log")"; fi
  exit 0
fi
START=${START:-1}; SEEDS=${SEEDS:-10}; JOBS=${JOBS:-3}; KINDS=${KINDS:-"rooms symmetric dominoes"}; SIZES=${SIZES:-"8x8 10x10"}
export WORK=${WORK:-${TMPDIR:-/tmp}/regl.$$}; mkdir -p "$WORK"
for k in $KINDS; do for s in $SIZES; do n=$START; while [ $n -lt $((START + SEEDS)) ]; do echo "$k $s $n"; n=$((n+1)); done; done; done |
  xargs -P "$JOBS" -L 1 sh "$0" --one
