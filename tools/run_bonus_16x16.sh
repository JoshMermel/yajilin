#!/bin/sh
# Wait until HH:MM (default 22:00; if that time has passed, start at once), then make the 16x16 pools of the bonus books (the long way round,
# one direction, all zeros, no zeros), build the four 16x16 books (250 each), and run the sort check, the audit and the tests.
#   nohup sh tools/run_bonus_16x16.sh [HH:MM] > /dev/null 2>&1 &
# The log is tools/library/bonus16.log and the pid tools/library/bonus16.pid (kill it to cancel; the run holds the Mac awake with caffeinate,
# which does not help with a closed lid). Nothing is committed or pushed. Costs measured 2026-11-21 at 16x16, per puzzle on one core:
# long way round ~4 s, all zeros ~20 s, one direction ~30 s, no zeros ~50 s; the whole plan (300/300/300 + 150/150 puzzles) is about 3 hours on 9 cores.
cd "$(dirname "$0")/.." || exit 1
mkdir -p tools/library
echo $$ > tools/library/bonus16.pid
LOG=tools/library/bonus16.log
exec >> "$LOG" 2>&1
caffeinate -ims -w $$ &
at=${1:-22:00}
target=$(date -j -f "%Y-%m-%d %H:%M" "$(date +%F) $at" +%s)
echo "== waiting until $at ($(date))"
while [ "$(date +%s)" -lt "$target" ]; do sleep 30; done
echo "== start $(date)"
SEED=9600 ONLYSIZE=16x16 sh tools/make_bonus_split.sh
echo "== pools done $(date)"
node tools/build_bonus_split.mjs --sizes 16x16
echo "== sort check"; node tools/sort_books.mjs --check
echo "== audit"; node tools/audit_books.mjs 2>&1 | tail -3
echo "== tests"; npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^not ok"
echo "== finished $(date)"
rm -f tools/library/bonus16.pid
