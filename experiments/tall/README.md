# Tall and skinny boards

An experiment: how does the generator cope with boards much taller than wide? Default style (no edge bias), seeds 301/302.
`data/experiment-tall.csv` is the book "Experiment: tall and skinny" (26 puzzles, 4x20 up to 8x100), built from `pools/` by `node tools/build_tall.mjs`.

- Generation is easy: 4x20 to 6x50 in about a second, 12x48 in about 10 s, 6x80 in 14 s, 8x100 (800 cells) in 48 s. Narrow boards are cheap to make unique.
- Difficulty: the narrowest (4 wide) are Medium, everything 5+ wide and 30+ tall is Hard. Scores (within-size reading only): 4x20 12-40, 6x30 90-170,
  6x50 220-295, 8x40 280-350, 10x50 495-590, 12x48 370-640, 8x100 680-970. The hardest rule is usually `rangeFacing`: long vertical rays and
  few columns make clues point at each other along the length.
- The app copes: an 8x100 board renders at full cell size and the page scrolls (4600 px).
