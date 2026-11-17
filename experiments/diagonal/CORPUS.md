# Diagonal test corpus

Three books in the **Diagonal** group of the picker: `data/diagonal-all.csv` (every arrow diagonal: the `beginner`, `medium` and `hard` recipes, 24 puzzles),
`data/diagonal-half.csv` (half the arrows diagonal, 24) and `data/diagonal-quarter.csv` (a quarter, 24). Puzzles are named `<recipe>-<size>-<n>`, at 6x6,
8x8, 10x10 and 12x12, easiest first within a size. Every puzzle is unique (rules, plus the exhaustive solver from scratch on
boards of up to 150 cells), and `node tools/audit_books.mjs --book diagonal-half --rate` (and the other two) passes.

**The rule:** an arrow may point along a diagonal (up-right, down-right, down-left, up-left), and then counts the shaded cells ("boxes") on
that diagonal to the edge of the board, skipping clue cells as usual. Cells on a diagonal never touch orthogonally, so a whole diagonal can be
boxes (a 3-arrow with exactly three cells ahead of it is fully shaded) and neighbouring diagonals constrain each other instead. In files a
diagonal arrow is written `row:col:E|C|Z|Q:n` (up-right, down-right, down-left, up-left: the keyboard's diagonal keys).

| Recipe | What it is |
|---|---|
| `beginner`, `medium`, `hard` | every arrow diagonal ("Diagonal Yajilin": the UK Puzzles variant); Beginner rules only / up to Medium / all rules |
| `half` | half the arrows diagonal, the rest orthogonal |
| `quarter` | a quarter diagonal |

What to look for: how it feels when the line of sight runs corner to corner (is it harder to see the cells an arrow counts? the board shows no
highlight until you press Hint), what you do with a diagonal arrow near a corner (a corner cell's diagonal is as long as the board), whether two
neighbouring diagonals interact in a way you reach for (two parallel diagonals' boxes sit in a checkerboard-like pattern) and whether the
orthogonal and diagonal arrows in the mixed puzzles help or confuse each other.

Not in the corpus: a `bignum` recipe (every arrow diagonal and the numbers big) produced nothing at 6x6 to 12x12 within its budget; diagonals are
short and hold few boxes. Rebuild with `WORKERS=6 ./tools/make_diagonal_corpus.sh` and `node tools/build_diagonal_corpus.mjs`; `COUNT=4 SEED0=7000 ONLY=half` adds more puzzles of one recipe
(the share of diagonal arrows is the generator's `--diagonal 0..1`, so any other mix is one more recipe line).
