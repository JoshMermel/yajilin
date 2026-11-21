# Tall and skinny boards (the "Skinny" book)

An experiment: how does the generator cope with boards much taller than wide? Default style (no edge bias), seeds 301/302.
`data/bonus-skinny.csv` is the book "Bonus: skinny" (29 puzzles, 3x20 up to 8x36), built from `pools/` (removed 2026-11-20; it is in git history up to commit `cc22aa1`, or regenerate with `tools/make_bonus_pools.sh`) by `node tools/build_skinny.mjs`: only boards whose
longer side is at most 36 (2026-11-15; the first version of the book went up to 8x100 and the longer pools are still here, not in the book). Pools for the
newer sizes come from `tools/make_bonus_pools.sh`. The page shows a skinny board sideways when that gives bigger cells (Settings: "Turn tall boards sideways").

- Generation is easy: 4x20 to 6x50 in about a second, 12x48 in about 10 s, 6x80 in 14 s, 8x100 (800 cells) in 48 s. Narrow boards are cheap to make unique.
- Difficulty: the narrowest (4 wide) are Medium, everything 5+ wide and 30+ tall is Hard. Scores (within-size reading only): 4x20 12-40, 6x30 90-170,
  6x50 220-295, 8x40 280-350, 10x50 495-590, 12x48 370-640, 8x100 680-970. The hardest rule is usually `rangeFacing`: long vertical rays and
  few columns make clues point at each other along the length.
- The app copes: an 8x100 board renders at full cell size and the page scrolls (4600 px).
