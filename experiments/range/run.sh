#!/bin/bash
# Fill experiments/range/pools with Nikoli-style puzzles (settings A) at 16x16 and 20x32, then summarise with tools/range_report.mjs.
# usage: bash experiments/range/run.sh [count16 per worker] [count20x32 per worker]
cd "$(dirname "$0")/../.."
C16=${1:-12}; C32=${2:-7}
for s in 1 2 3 4 5; do node tools/generate.mjs --size 16x16 --count $C16 --seed $((100+s)) --budget 120 --edge-bias 0.8 --shade 0.7 --out experiments/range/pools/y16x16_s$s.csv > experiments/range/pools/log16_$s.txt 2>&1 & done
for s in 1 2 3 4 5; do node tools/generate.mjs --size 20x32 --count $C32 --seed $((200+s)) --budget 240 --edge-bias 0.8 --shade 0.7 --out experiments/range/pools/y20x32_s$s.csv > experiments/range/pools/log32_$s.txt 2>&1 & done
wait
