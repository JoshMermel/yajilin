# Solving regional Yajilin: research and what the solver can learn (2026-11-16)

## What the web has

Nothing regional-specific. Every page I could find for Regional Yajilin gives the rules and nothing else: Para's Puzzle Site (2012),
Puzzle Duel, Cross+A, Carrick22's Puzzle Laboratory, and Murat Can Tonta's puzzles on Grandmaster Puzzles. The only solving remarks are reader comments
on those posts: "the start was easy and the middle heavy", progress "from miniscule contradictions along the path", an unnamed "fairly simple
observation" that opens up the grid, and the author's note that some solvers had to guess about 60% of the way in. That last one is useful:
**real regional puzzles are not fully solvable by region counting**, which matches what we see (the loop does most of the work).

General Yajilin guides (puzzles.wiki, puzzle-magazine.com, playloopr.com) list the loop techniques that do not depend on arrows: the two-neighbour
(corner and corridor) rule, a box forces dots around it, a dead cell with no entry and exit must be a box, no premature closed loop, region
parity (the loop crosses any region's border an even number of times), and a claim that a 2x3 block holds at most two boxes (false as a bare
count: a chessboard pattern puts three in). Our solver already has all of these. Nothing I found mentions the chessboard colouring below.

## Candidates, and what the solver does with them

Measured on 40 regional puzzles that every older rule (everything but trial and error) fails to finish: 24 at 6x6, 16 at 8x8, both blob regions
and a spread of sizes (`ablation.mjs`; the puzzles were generated "stuck" without the two new rules).

| Technique | In the solver? | Result |
|---|---|---|
| a 0 region is all dots; a region that needs every open cell is all boxes | yes (`clueDone`, `clueFull`) | |
| count a region's placements, no two boxes touching (`regionDeduce`) | **new**, Medium tier | brute-force tested; lists independent sets, gives up above 30 open cells in one group |
| the same, dropping placements that strand a dot (`placementDeadEnd`) | yes, works on regions too | |
| **chessboard balance** (`colorBalance`) | **new**, Hard tier, weight 50 | finishes 6 of 24 (6x6) and 3 of 16 (8x8): 22% of the stuck puzzles; used in 18 of 88 puzzles I tried |
| two neighbouring numbered regions together (`regionPairs`) | **new**, Hard tier, weight 45 | finishes none of the 40 on its own or with the other; fires in 3 of 88 puzzles. Left in, but a candidate to remove |
| loop rules: dead ends, closing cells, parity of open ends, trial | yes, unchanged | see below |
| loop crosses a region border an even number of times | partly (`crossingParity` for rectangles, `parityForces`) | the general form is just "degrees add up", so there is nothing new to add |

**Chessboard balance** is the one that matters. Colour the cells like a chessboard: a loop alternates colours, so it visits as many light as
dark cells, so the boxes (the only cells off the loop) must leave the two colours level: light boxes minus dark boxes = light cells minus dark
cells (0 on an even board). Combined with the numbers it gives a range for the total number of boxes (the numbers, plus whatever the
unnumbered regions hold), hence how many boxes each colour holds; when that count reaches its minimum or maximum, every open cell of that colour is
a dot or a box. It also feeds the contradiction check, so trial and error knows it. It is cheap (one pass over the board) and sound (checked
against the stored solution on 48 corpus puzzles x 40 random partly filled boards, and on the 40 stuck puzzles). It is **not on by default for
arrow puzzles**: the same loop-only form would apply (clue cells are off the loop too) but it would change the ratings of the shipped books.

## Why the other puzzles stay stuck

At the stalled position of each of the 40 puzzles there are 403 undecided cells. Assuming the wrong value at each and following the older rules, I
classified what finally contradicts (first match in this order, so the shares are rough):

| What contradicts the wrong guess | cells |
|---|---|
| the chessboard cannot be balanced | 124 (31%) |
| the loop's shape (a closed loop, a cell with too few ways out) | 73 (18%) |
| an odd number of open ends in a sealed-off area | 59 (15%) |
| a region's count is broken | 43 (11%) |
| no contradiction within the depth tried | 104 (26%) |

(The chessboard check was not part of the contradiction test in this tally, so the 31% are guesses that also leave it unbalanced.)

Reading: most of regional solving is the arrow ladder's loop reasoning; the region-specific part is counting placements inside a region
(done) plus the global chessboard argument (done). I could not find a third family of region techniques in the stalled positions.

## Not tried, with a rough cost

- **Capacity of a region from its shape** (a region is a 1-wide strip, or a 2xk block, so it holds at most so many boxes): already implied by the
  placement counting; a person would say it faster than the enumeration does, which matters for the *hint text*, not for solving.
- **Colour balance inside a sub-area the loop encloses**: needs the loop's inside/outside, which the solver does not track. A day, uncertain.
- **Colour balance per region** (a region with n boxes splits them between colours): extends the range reasoning above with one more
  variable per region, so an integer-programming flavour; I would try it only if play shows people using it.
- **Hint wording**: the regional ladder needs plain sentences for region counting and for the chessboard argument (the Hint button already has
  first versions; they read stiffly).
- **Letting the generator use the new rules**: done for new puzzles (`classical` and later recipes); the 48 puzzles already in the corpus were
  generated with the older rules (rescored, two changed rating).
