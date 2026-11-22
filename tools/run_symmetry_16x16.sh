#!/bin/sh
# Wait until HH:MM (default 22:00; if that time has passed, start at once), then make the 16x16 pools of the exact-symmetry bonus book (mirror, diagonal
# mirror, quarter turn, half turn) and of the symmetric-layout bonus book (half turn, quarter turn, mirror, diagonal mirror), build the two 16x16 books, and run the sort
# check, the audit and the tests.
#   nohup sh tools/run_symmetry_16x16.sh [HH:MM] > /dev/null 2>&1 &
# The log is tools/library/symmetry16.log and the pid tools/library/symmetry16.pid (kill it to cancel; the run holds the Mac awake with caffeinate, which does
# not help with a closed lid). Nothing is committed or pushed. Measured 2026-11-22 at 16x16, per puzzle on a loaded core: exact 1-17 s (mirror and
# transpose the slowest), layout 10-55 s.
cd "$(dirname "$0")/.." || exit 1
mkdir -p tools/library
echo $$ > tools/library/symmetry16.pid
LOG=tools/library/symmetry16.log
exec >> "$LOG" 2>&1
caffeinate -ims -w $$ &
at=${1:-22:00}
target=$(date -j -f "%Y-%m-%d %H:%M" "$(date +%F) $at" +%s)
echo "== waiting until $at ($(date))"
while [ "$(date +%s)" -lt "$target" ]; do sleep 30; done
echo "== start $(date)"
export SIZES=16x16 BUDGET=90 CAP=5400 JOBS_PER=6 PER=10
SEED=30000 sh tools/make_symmetry_exact.sh
echo "== exact pools done $(date)"
SEED=40000 sh tools/make_symmetric_layout.sh
echo "== layout pools done $(date)"
node tools/build_symmetry_exact.mjs --sizes 16x16
node tools/build_symmetric_layout.mjs --sizes 16x16
echo "== sort check"; node tools/sort_books.mjs --check
echo "== audit"; node tools/audit_books.mjs 2>&1 | tail -3
echo "== tests"; npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)|^not ok"
echo "== finished $(date)"
rm -f tools/library/symmetry16.pid
