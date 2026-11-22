#!/usr/bin/env python3
"""
Frame puzzles by counterexample-guided search with OR-tools (a second approach to tools/cpsat_frame.py).

The numbers on the arrows are fixed first: arrow lines (inside rows and columns) and one number per line. The idea comes from stefliew's 20x20 Yajilin on
Logic Masters (logic-masters.de, puzzle 0006NR: arrows on every third row and column, every arrow 6), but the Frame book deliberately avoids that layout, because its
break-in is a whole-board count that works only for that tuned layout: use irregular line sets (--row-lines, --col-lines) or an even spacing (--spacing 2 or 4) with
clearly varied numbers (--rows, --cols), never every arrow the same on an even lattice and never spacing 3.
The solver then chooses the
whole solution at once: for every inside cell loop / box / void, a single loop through the loop cells, boxes that never touch, and the arrows' counts.
The voids it chooses are the puzzle. If the puzzle has another solution (found by a second solve that minimises how far it is from the first),
the pair of solutions shows a small local change (a few cells and loop edges) that the puzzle cannot tell apart; a clause is added to the first
model that forbids that whole neighbourhood from looking the same again (same labels, same loop edges), the model is solved again, and so on until
the second solve finds nothing: the puzzle is then unique.

  python3 tools/cpsat_frame2.py --inside 12 --row-lines 2,4,5,9,12 --rows 3,5,2,4,1 --col-lines 1,3,7,8,11 --cols 4,2,5,1,3 --seed 1 --time 600 --out frame.json
  python3 tools/cpsat_frame2.py --inside 12 --spacing 4 --rows 2,4,3 --cols 4,2,5 --out frame.json     (spacing 4: inside lines 2, 6, 10 ...; spacing 2: 2, 4, 6 ...)
  --row-lines / --col-lines  comma lists of inside line indexes (1-based) that carry arrows, overriding --spacing; --rows / --cols give one number per listed line
Needs OR-tools (the star battle venv has it); then  node tools/frame_json_to_pool.mjs frame.json --name N --out tools/library/frame_irr_mix_12_a.csv  checks, rates and stores it.
"""
import argparse, json, random, sys, time
from ortools.sat.python import cp_model

ap = argparse.ArgumentParser()
ap.add_argument('--inside', type=int, default=10)
ap.add_argument('--spacing', type=int, default=3)
ap.add_argument('--numbers', type=int, default=None)
ap.add_argument('--rows', default=None, help='one number per row arrow line'); ap.add_argument('--cols', default=None, help='one number per column arrow line')
ap.add_argument('--row-lines', default=None, help='comma list of inside row indexes (1-based) that carry arrows; overrides --spacing for rows')
ap.add_argument('--col-lines', default=None, help='comma list of inside column indexes that carry arrows; overrides --spacing for columns')
ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--time', type=float, default=600)
ap.add_argument('--void-share', default='0.10,0.22')
ap.add_argument('--workers', type=int, default=8)
ap.add_argument('--out', default='frame.json')
ap.add_argument('--verbose', action='store_true')
a = ap.parse_args()
rnd = random.Random(a.seed)
n = a.inside; R = C = n + 2
lines = [k for k in range(1, n + 1) if (k - 1) % a.spacing == 1 % a.spacing]
rowLines = sorted(map(int, a.row_lines.split(','))) if a.row_lines else lines
colLines = sorted(map(int, a.col_lines.split(','))) if a.col_lines else lines
num = a.numbers if a.numbers is not None else n // a.spacing
rowN = dict(zip(rowLines, map(int, a.rows.split(',')))) if a.rows else {k: num for k in rowLines}
colN = dict(zip(colLines, map(int, a.cols.split(',')))) if a.cols else {k: num for k in colLines}
assert len(rowN) == len(rowLines) and len(colN) == len(colLines), 'one number per arrow line'
lo, hi = map(float, a.void_share.split(','))
DR = [-1, 0, 1, 0]; DC = [0, 1, 0, -1]
inside = [(r, c) for r in range(1, n + 1) for c in range(1, n + 1)]
idx = {u: i for i, u in enumerate(inside)}
nbrs = lambda u: [(u[0] + DR[d], u[1] + DC[d]) for d in range(4) if (u[0] + DR[d], u[1] + DC[d]) in idx]
def log(*x):
    if a.verbose: print(*x, file=sys.stderr, flush=True)

def build(voids=None):
    m = cp_model.CpModel()
    box = {u: m.NewBoolVar(f'b{u}') for u in inside}; loop = {u: m.NewBoolVar(f'l{u}') for u in inside}; void = {}
    for u in inside:
        if voids is None: void[u] = m.NewBoolVar(f'v{u}'); m.AddExactlyOne([box[u], loop[u], void[u]])
        elif u in voids: m.Add(box[u] == 0); m.Add(loop[u] == 0)
        else: m.AddExactlyOne([box[u], loop[u]])
    arcs = [(idx[u], idx[u], loop[u].Not()) for u in inside]; arcv = {}
    for u in inside:
        for v in nbrs(u):
            x = m.NewBoolVar(f'a{u}{v}'); arcv[(u, v)] = x; arcs.append((idx[u], idx[v], x))
    m.AddCircuit(arcs)
    edge = {}
    for (u, v), x in arcv.items():
        if u < v: e = m.NewBoolVar(f'e{u}{v}'); m.Add(e == x + arcv[(v, u)]); edge[(u, v)] = e
    for u in inside:
        for v in ((u[0], u[1] + 1), (u[0] + 1, u[1])):
            if v in idx: m.Add(box[u] + box[v] <= 1)
    for k in rowLines: m.Add(sum(box[(k, c)] for c in range(1, n + 1)) == rowN[k])
    for k in colLines: m.Add(sum(box[(r, k)] for r in range(1, n + 1)) == colN[k])
    return m, box, loop, void, edge

def label(u, A): return 'b' if u in A['box'] else 'v' if u in A['void'] else 'l'

def nearest_alt(A, avoid=()):
    """The solution of the puzzle (voids of A) nearest to A that is not A; `avoid`: neighbourhoods (cell sets) it must differ from A outside of."""
    V = A['void']; m, box, loop, void, edge = build(V)
    diffs = [box[u].Not() if u in A['box'] else box[u] for u in inside if u not in V]
    ed = [e.Not() if k in A['edge'] else e for k, e in edge.items()]
    m.AddBoolOr(diffs + ed); m.Minimize(sum(diffs) + sum(ed))
    for area in avoid:                                       # a different change than the ones already learned from: something outside each of them differs
        outside = [box[u].Not() if u in A['box'] else box[u] for u in inside if u not in V and u not in area]
        outside += [e.Not() if k in A['edge'] else e for k, e in edge.items() if k[0] not in area and k[1] not in area]
        m.AddBoolOr(outside)
    s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = 30; s.parameters.num_workers = a.workers; s.parameters.random_seed = rnd.randint(0, 10**6)
    st = s.Solve(m)
    if st == cp_model.INFEASIBLE: return None
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE): return 'unknown'
    return {'box': {u for u in inside if u not in V and s.Value(box[u])}, 'void': set(V), 'edge': {k for k, e in edge.items() if s.Value(e)}}


PER_ROUND = 3
def learn(A, B, K, K2):
    """Forbid, anywhere on the board where it still works, the neighbourhood K2 looking as it does in A (same labels, same loop edges)."""
    def box_delta(shift):
        dr, dc = shift; d = {}
        for u in K:
            was, now = label(u, A) == 'b', label(u, B) == 'b'
            if was != now:
                v = (u[0] + dr, u[1] + dc); d[('r', v[0])] = d.get(('r', v[0]), 0) + (1 if now else -1); d[('c', v[1])] = d.get(('c', v[1]), 0) + (1 if now else -1)
        return d
    def clause_at(shift):
        dr, dc = shift; lits = []
        for u in K2:
            v = (u[0] + dr, u[1] + dc)
            if v not in idx: return None
            lb = label(u, A); lits.append({'b': box, 'v': void, 'l': loop}[lb][v].Not())
            for w in nbrs(u):
                w2 = (w[0] + dr, w[1] + dc)
                if w2 not in idx: return None
                k = (u, w) if u < w else (w, u); k2 = (v, w2) if v < w2 else (w2, v)
                lits.append(edge[k2].Not() if k in A['edge'] else edge[k2])
        return lits
    added = 0; rs = [u[0] for u in K2]; cs = [u[1] for u in K2]
    for dr in range(1 - min(rs), n - max(rs) + 1):
        for dc in range(1 - min(cs), n - max(cs) + 1):
            if any(v != 0 and line in (rowLines if kind == 'r' else colLines) for (kind, line), v in box_delta((dr, dc)).items()): continue
            lits = clause_at((dr, dc))
            if lits: M.AddBoolOr(lits); added += 1
    return added

M, box, loop, void, edge = build(None)
nv = sum(void.values()); M.Add(nv >= int(lo * n * n)); M.Add(nv <= int(hi * n * n))
noise = {u: rnd.randint(0, 9) for u in inside}
M.Minimize(sum(noise[u] * void[u] for u in inside))                      # a random preference so that runs differ
t0 = time.time(); hint = None; it = 0; clauses = 0
while time.time() - t0 < a.time:
    it += 1
    if hint:
        # stay near the last candidate: the objective is the number of cells whose label changed
        M.Minimize(sum((1 - {'b': box, 'v': void, 'l': loop}[label(u, hint)][u]) for u in inside) + sum((1 - e) if k in hint['edge'] else e for k, e in edge.items()))
        M.ClearHints()
        for u in inside:
            M.AddHint(box[u], 1 if u in hint['box'] else 0); M.AddHint(void[u], 1 if u in hint['void'] else 0); M.AddHint(loop[u], 1 if label(u, hint) == 'l' else 0)
        for k, e in edge.items(): M.AddHint(e, 1 if k in hint['edge'] else 0)
    s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = max(10, min(120, a.time - (time.time() - t0))); s.parameters.num_workers = a.workers; s.parameters.random_seed = a.seed + it
    st = s.Solve(M)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print(f'the model became infeasible after {clauses} clauses ({"time out" if st == cp_model.UNKNOWN else "no more candidates"})', file=sys.stderr); sys.exit(1)
    A = {'box': {u for u in inside if s.Value(box[u])}, 'void': {u for u in inside if s.Value(void[u])}, 'edge': {k for k, e in edge.items() if s.Value(e)}}
    hint = A
    avoid = []; found = 0; cleared = False
    for rep_ in range(PER_ROUND):
        B = nearest_alt(A, avoid)
        if B is None:
            if rep_ == 0: cleared = True
            break
        if B == 'unknown': log('inner solve timed out'); break
        found += 1
        K = {u for u in inside if label(u, A) != label(u, B)}
        for k in A['edge'] ^ B['edge']: K.add(k[0]); K.add(k[1])
        K2 = set(K)
        for u in K: K2.update(nbrs(u))
        avoid.append(K2)
        added = learn(A, B, K, K2)
        clauses += added
        log(f'round {it}.{rep_}: {len(K)} cells differ, {added} clauses over {len(K2)} cells, voids {len(A["void"])}, {time.time()-t0:.0f}s')
    if cleared: break
else:
    print(f'no unique puzzle within {a.time:.0f}s ({clauses} clauses)', file=sys.stderr); sys.exit(1)
clues = []
for r in range(R):
    for c in range(C):
        if r in (0, R - 1) or c in (0, C - 1):
            corner = r in (0, R - 1) and c in (0, C - 1); d = -1
            if not corner:
                if r == 0 and c in colLines: d = 2; k = c
                elif r == R - 1 and c in colLines: d = 0; k = c
                elif c == 0 and r in rowLines: d = 1; k = r
                elif c == C - 1 and r in rowLines: d = 3; k = r
            clues.append({'r': r, 'c': c, 'd': 0, 'n': -1} if d < 0 else {'r': r, 'c': c, 'd': d, 'n': (colN if d in (0, 2) else rowN)[k]})
        elif (r, c) in A['void']: clues.append({'r': r, 'c': c, 'd': 0, 'n': -1})
json.dump({'rows': R, 'cols': C, 'clues': clues, 'boxes': sorted(A['box']), 'edges': sorted([list(map(list, e)) for e in A['edge']])}, open(a.out, 'w'))
print(f'unique puzzle after {it} rounds, {clauses} clauses, {time.time()-t0:.0f}s: {len(A["void"])} voids, {len(A["box"])} boxes -> {a.out}', file=sys.stderr)
