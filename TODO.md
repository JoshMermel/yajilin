# TODO

Order follows the pattern in the sibling projects (see README).

1. **Scorer** (`js/rating.js`): a rule table (rule, tier, weight) and a human-style solver that always applies the
   easiest applicable rule. Seed it with the techniques from PuzzleMadness's tutorial (0-clues make loop cells, a loop
   cell with two exits, dead ends become shaded, shaded neighbours become loop, forced clue shading, a closing loop can't
   skip cells) and then add rules by playing puzzles with Josh and writing down the inferences he makes. Compare the
   tiers it gives the 12 borrowed puzzles with the site's own Easy/Medium/Hard labels.
2. **Hint button** driven by the same rule table (two-press step-by-step hints like polyomino-panel).
3. **Generator**: random loop, shade cells off it, add clues, strip clues while the solution stays unique. Verify with
   the exact solver. Then pools in `tools/library/`, `tools/build_books.mjs`, recipes, `rescore`/`rerate`.
4. **Books**: manifest, book picker, Browse grid by tier, print booklet, offline play (as in polyomino-panel).
5. GUI polish: edge crosses ("no line here"), clue-satisfied colouring options, touch testing.
6. Solver speed for bigger boards (the generator will call it a lot): consider a WASM or tighter implementation only if
   measured to matter.
