# Diagonal test corpus

Ten books of 250 in the **Diagonal** group of the picker, one sub-category per size (8×8, 12×12, 16×16, 20×20, 20×36: the sizes of the Default books), each with `data/diagonal-all-<size>.csv`
(every arrow diagonal) and `data/diagonal-mixed-<size>.csv` (some arrows diagonal and some orthogonal, in any mix: pools made at 25%, 50% and 75%
diagonal). Each runs from Beginner to Hard as far as the pool allows (see the tier counts `node tools/build_diagonal_corpus.mjs` prints). Every puzzle is unique (rules, plus the exhaustive solver from scratch on
boards of up to 150 cells), and `node tools/audit_books.mjs --rate` passes.

**The rule:** an arrow may point along a diagonal (up-right, down-right, down-left, up-left), and then counts the shaded cells ("boxes") on
that diagonal to the edge of the board, skipping clue cells as usual. Cells on a diagonal never touch orthogonally, so a whole diagonal can be
boxes (a 3-arrow with exactly three cells ahead of it is fully shaded) and neighbouring diagonals constrain each other instead. In files a
diagonal arrow is written `row:col:E|C|Z|Q:n` (up-right, down-right, down-left, up-left: the keyboard's diagonal keys).

| Pool | What it is |
|---|---|
| `dg_all_<tier>` | every arrow diagonal ("Diagonal Yajilin": the UK Puzzles variant) |
| `dg_mix25/50/75_<tier>` | that share of the arrows diagonal, the rest orthogonal (the builder keeps only puzzles with both kinds) |

Each pool comes in three tiers: Beginner rules only, up to Medium, all rules (so the books span the difficulty range).

What to look for: how it feels when the line of sight runs corner to corner (is it harder to see the cells an arrow counts? the board shows no
highlight until you press Hint), what you do with a diagonal arrow near a corner (a corner cell's diagonal is as long as the board), whether two
neighbouring diagonals interact in a way you reach for (two parallel diagonals' boxes sit in a checkerboard-like pattern) and whether the
orthogonal and diagonal arrows in the mixed puzzles help or confuse each other.

Not in the books: a `bignum` recipe (every arrow diagonal and the numbers big) produced nothing at 6x6 to 12x12 within its budget; diagonals are
short and hold few boxes. Rebuild with `./tools/make_diagonal_corpus.sh` (env `SEED0`, `ALL`, `MIX`, `SIZES`, `ONLY`) and `node tools/build_diagonal_corpus.mjs`.
