# Layout-first regional puzzles (prototype, 2026-11-22)

The regional generator in `js/generator.js` grows random blob regions and then moves border cells until the rules solve the puzzle, so it
cannot keep a designed layout. This prototype fixes the layout first and searches for the solution:

1. `tools/regional_layouts.mjs` draws a layout: **rooms** (rectangles only, by repeated splitting: the Heyawake look), **symmetric**
   (regions in half-turn pairs, maybe one middle region that is its own twin), **dominoes** (a random domino tiling; every number is 0 or 1),
   **tetrominoes** (a random tiling by pieces of four cells, any shapes), **pentominoes** (one of each of the twelve pentominoes on a board of
   60 cells, 12x5 so far; backtracking from the first empty cell, each shape once).
2. `tools/cpsat_regional.py` (OR-tools, the same counterexample loop as `tools/cpsat_frame2.py`) chooses boxes that never touch and one loop
   through every other cell, with every region numbered. A second solve looks for another solution with the same numbers; the cells where the
   two differ become a clause that forbids that neighbourhood looking like either, and it goes round again until no second solution exists.
   A second solution that only reroutes the loop through the same boxes (most of them) has nothing to do with the regions, so that
   neighbourhood is forbidden at every position on the board at once. With `--count K` it keeps going after a unique solution (forbidding
   those boxes, with a new random preference) and writes up to K of them.
3. `tools/regional_json_to_pool.mjs` checks the solution and its uniqueness (the rules without trial and error, then the exhaustive solver),
   drops numbers in a random order while the rules up to `--tier` still solve it, rates it and appends it to a pool. Regions keep their
   borders even when unnumbered (the layout is the design), so nothing is merged. Of several solutions it keeps the best: one the `--tier`
   rules can solve with every number (the highest score among those), else one the Hard rules without trial and error can solve (pruned
   with those), else the lowest score with every number kept.

`sh tools/make_regional_layout_pools.sh` runs the lot (`SEEDS`, `JOBS`, `KINDS`, `SIZES`, `TIER`, `TIME`); pools land in
`tools/library/regl_<kind>_<size>.csv`.

## Results (2026-11-22)

`--tier Medium`, 20-28% boxes. "Hard" mostly means the Medium rules cannot finish even with every number; the worst need trial and error.

| | runs | Medium | Hard | settings |
|---|---|---|---|---|
| dominoes 8x8 | 8 | 8 | 0 | one solution per layout |
| dominoes 10x10 | 8 | 6 | 2 | one solution |
| rooms 8x8 | 8 | 3 | 5 | one solution, rooms of 2-7 cells |
| rooms 10x10, first try | 8 | 0 | 5 (+3 failed) | one solution, rooms of 2-9 |
| rooms 10x10 | 8 | 5 | 3 | best of 4, rooms of 2-6 (about 35 rooms) |
| symmetric 8x8 | 8 | 5 | 3 | one solution, regions around 4 |
| symmetric 10x10, first tries | 8 + 8 | 0, then 1 | 6 + 7 | regions around 5, then best of 4 around 4 |
| symmetric 10x10 | 8 | 5 | 3 (none need trial and error) | best of 4, regions around 3 (34 regions) |
| tetrominoes 8x8 | 6 | 2 | 4 | best of 4 |
| tetrominoes 10x10 | 6 + 6 | 2, then 4 | 4, then 2 | best of 4, then best of 6 |
| pentominoes 12x5 | 8 | 6 | 2 | best of 4 |

Findings:
- **More, smaller regions is the main lever.** Rooms and symmetric layouts at 10x10 went from almost all Hard to 5 of 8 Medium once they had
  about 35 regions. Each region's number is information; big regions with 1 or 2 boxes say little. Tetrominoes are stuck at 25 regions on
  10x10, so they need more tries per layout instead.
- **Several solutions per layout** help: among 4 unique solutions of one layout, often only one suits the Medium rules. Each extra solution
  costs about 30 s of OR-tools at 10x10.
- **Dominoes and pentominoes are the strongest so far.** Dominoes keep mostly 1s (the loop rules work out the 0s). Pentominoes: 5x12 has
  about a thousand tilings, so a book would not repeat itself, and a puzzle takes 10-60 s.
- **Loop reroutes dominate the search**: at 16% boxes OR-tools spends hundreds of rounds ruling out other routings of the loop; at 20-28%
  it is tens. Forbidding a reroute everywhere at once was the big speed-up. Symmetric boxes as well as a symmetric layout did not converge
  (the loop would have to be symmetric too); only the layout is symmetric.
- Not tried yet: 6x10 pentominoes, trominoes or L-tetrominoes only, concentric or themed layouts, 12x12, a lower box density (closer to
  a setter's 16%) now that the search is faster.

The playable sample is `tools/library/regl_all.csv` (load it from the app's Settings: Load puzzles from a file). The books in the app's
Regional group are built from the pools by `node tools/build_regional_books.mjs` (trial-and-error puzzles left out, up to 100 per book).

## The first books (2026-11-22)

One batch (`START=101`, about 450 layouts, 2h20 on 9 cores) on top of the samples above; `node tools/build_regional_books.mjs` left out
puzzles that need trial and error:

| book | pool | left out | puzzles | Medium / Hard |
|---|---|---|---|---|
| Pentominoes 12x5 | 118 | 10 (and capped at 100) | 100 | 93 / 7 |
| Dominoes 8x8 | 53 | 0 | 53 | 53 / 0 |
| Dominoes 10x10 | 62 | 1 | 61 | 59 / 2 |
| Rooms 8x8 | 68 | 5 | 63 | 49 / 14 |
| Rooms 10x10 | 68 | 10 | 58 | 35 / 23 |
| Symmetric 8x8 | 65 | 12 | 53 | 48 / 5 |
| Symmetric 10x10 | 68 | 3 | 65 | 54 / 11 |

5 of the 450 layouts gave nothing (no unique solution in time, or the exhaustive check did not finish).

Pentominoes 10x6 (2026-11-22): 120 layouts (`START=101`, best of 4, 15 minutes), all unique; 23 needed trial and error, so the book has
97 (76 Medium, 21 Hard). Harder than 12x5 (93 of 100 Medium): the 6-row board gives the loop more room. The tilings take 1-2 s each.

Jigsaw (`--kind jigsaw`): irregular pieces of 3 to 6 cells (`--min`, `--max`), never a rectangle or a straight bar; a first sample is running.

