# Classical regional puzzles: what real ones look like, and the `classical` recipe

Looked at two published 10x10 and 12x12 Regional Yajilin puzzles by Murat Can Tonta (Grandmaster Puzzles, 2018-04-21 and 2019-06-13), reading the
puzzle images by eye. Two samples, so treat these as impressions, not statistics.

| | 12x12 ("concentric") | 10x10 ("Big+Small+") |
|---|---|---|
| regions | about 16 | about 17 |
| average region size | about 9 cells | about 6 cells |
| sizes | 3 to about 40 (an outer ring), a few 1-wide strips | 2 to about 25, several thin snaking regions |
| numbered regions | 14 of about 16 | 13 of about 17 |
| numbers | 0, 1, 2, 2, 1, 3, 4: mostly 1 and 2, one 4 | 0, 1, 2, a single 5 |
| boxes (sum of the numbers) | about 23 (16% of the cells) | about 17 (about 17%) |
| number position | the first cell of the region in reading order | same |

So a classical puzzle has fewer, bigger, very uneven regions than my first corpus recipes (2-4 cells each, or 5-9), small numbers, and a low
box density (about 16%, where my generator used 20%). Big regions hold only 1 or 2 boxes, so the numbers say little by themselves: the
loop carries most of the solving, and the numbers prune. The author of one of them says in a comment that he wanted fewer small regions.
Not every region is numbered, but most are.

## The `classical` recipe

`--density 0.16 --avg-size 7 --spread 0.6 --max-size 30 --min-numbered 0.7`

- `--density 0.16`: 16% of the cells are boxes (independent, so no two touch).
- `--avg-size 7 --spread 0.6`: region sizes are drawn log-normally around 7 (so a few are 2-3 cells and a few are 20+), then regions grow
  toward their sizes from random seeds.
- `--max-size 30`: allows the big ones. (`regionDeduce` lists the placements of one group of open cells up to 30 cells and gives up above
  that or above 400,000 placements; the loop rules carry on without it.)
- `--min-numbered 0.7`: pruning stops when 70% of the regions are still numbered.

What the generator does not copy: the regions are random growths, so they look more like blobs than a setter's designs (concentric rings,
thin snakes, regions that follow a theme). Generation is slow at this size and density (90-120 s for a 10x10), because only about 1 in 100
random boxes-plus-loop layouts at 16% has a unique loop.
