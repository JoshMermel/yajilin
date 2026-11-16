# Optimization hunt, 2026-11-15 (generation, scoring, interactive GUI)

Method: CPU profiles (`node --cpu-prof`) of real runs, a benchmark with output fingerprints (`node tools/bench.mjs`), and for every change
a proof that the OUTPUT did not change: the benchmark fingerprints match the old code, a "deep" comparison of the complete step list of
`rate()` (every firing's sets and info) over 280 puzzles / 52,524 steps from every book and size matches, and a fixed-seed 20x36 puzzle is
byte-identical before and after. All timings are CPU milliseconds on the same machine, desktop browser pane for the GUI numbers (a phone
is several times slower; not measured).

## Done (speed only, results identical)

| Change | Where | Measured effect |
|---|---|---|
| Give up a loop-construction attempt after 4N+200 iterations (it either succeeds within about 2.5N or never does) | `generator.js` `tightLoop` `maxIters`, used by `attemptPuzzle` | 14x14: two puzzles 31.5 s -> 1.0 s. Head to head, 150 s each: 14x14 46 -> 200+ puzzles, 16x16 20 -> 126, 20x20 11 -> 33. **Big boards now reproduce from a seed** (the old wall-clock cap made 14x14 differ run to run) |
| `placementDeadEnd`: segment counts once per call; leaf check incremental (same search, same leaves, same cap) | `rating.js` | 20x36 generation 70.8 s -> 43.5 s (same puzzle) |
| `followLines`: running segment count per cell instead of recounting | `rating.js` | rating 16x16 -16%, 20x20 -24%; generation 12x12 -26% |
| Same-direction / facing arrow pairs worked out once per puzzle, not on every step | `rating.js` `arrowPairs` | was ~15% of rating a 20x36 board |
| `propagate` (exhaustive solver): reuse scratch arrays, no `edgeCells` arrays, no `Map` per pass | `logic.js` | warm: 21 -> 17 ms on the propagation benchmark; from-scratch solve 12x12 -15% |
| One background rect instead of one per blank cell | `board.js` | 20x36: markup 122 -> 82 KB, browser parse+layout of every redraw 3.8 -> 2.2 ms (-42%); the picture is unchanged |

## Findings that need a decision (not done)

1. **Cross-check in `generate.mjs`** (boards of <= 150 cells): re-proves uniqueness from scratch with the plain solver. 38% of
   generate+check time at 10x10 and 12x12, with a tail: median 50 ms, worst puzzle 1.7 s; it never disagreed with the rules in any run.
   New flag `--cross-check-nodes N` (default 5,000,000, unchanged; 0 skips it). `audit_books.mjs` checks every shipped puzzle again
   independently, so a cap such as 100000 loses little assurance. Your call.
2. **`placementDeadEnd` is still 61% of generating a 20x36 board.** A partial placement that already strands a neighbour can be cut off
   (adding boxes only removes exits), which would cut the search a lot, but it changes the rule's behaviour: the node cap (3000) is reached
   less often, so the rule would fire on long lines where it now gives up, which changes some ratings (books would need rescoring). Worth
   doing; I did not do it unasked.
3. **The exhaustive solver**: 2.6 passes per `propagate` call, so an incremental (worklist) propagation would give perhaps 2x, not
   more; the node count is what costs. A better branching order or a stronger propagation (failed-literal on the tightest cell) could
   cut nodes. Only matters for the cross-check, `loopIsUnique`, and the audit's fallback.
4. **GUI, bigger wins** (20x36 redraw is 3.2 ms here, maybe 20-30 ms on a phone): draw each loop path as one `<path>` (536 `<line>`s at
   20x36 become a handful), keep the static layer (grid, arrows) out of the per-interaction redraw, and skip the whole-board redraw on a
   mouse move that only changes the hover. Opening a big book compiles all 1000 puzzles up front (64 ms for 20x36 here, a few hundred ms on a
   phone): compile lazily.
5. **Hint latency is fine**: under 2 ms even on 20x36 (it stops at the cheapest applicable rule). Rating a board costs 6 ms (8x8) to 370 ms
   (20x36); rescoring a 1000-puzzle 20x36 book is a few minutes. Nothing to do.
6. The remaining scoring cost is the lookahead rules (`shadeForces`, `segmentForces`, built on `followLines`): about 45% of rating time.
   An incremental `followLines` (worklist instead of whole-board passes) is the next lever there.

## Reproduce

```
node tools/bench.mjs                                   # timings + fingerprints of this tree
git archive HEAD js | tar -x -C /tmp/old; node tools/bench.mjs --js /tmp/old/js    # the same for another copy of js/
```
Equal fingerprints = same output. (The 14x14 generation fingerprint was not stable before the iteration cap: it depended on wall-clock.)
