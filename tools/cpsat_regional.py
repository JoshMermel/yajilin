#!/usr/bin/env python3
"""
Layout-first regional puzzles (an experiment): the regions are fixed first (tools/regional_layouts.mjs), then OR-tools chooses the whole
solution at once (boxes that never touch, one loop through every other cell) and every region's number is its box count. If the puzzle
with all numbers shown has another solution (a second solve, same numbers, nearest to the first), the two differ by a small local change;
a clause forbids that neighbourhood from looking as it does in either solution, and the first model is solved again, until no second
solution exists. Numbers are then dropped by tools/regional_json_to_pool.mjs while the rules still solve the puzzle.

  python3 tools/cpsat_regional.py --layout layout.json --density 0.14,0.24 --seed 1 --time 120 --out sol.json [--sym-boxes]

--sym-boxes: the boxes also map onto themselves under a half turn (for symmetric layouts).
Needs OR-tools (the star battle venv has it).
"""
import argparse, json, random, sys, time
from ortools.sat.python import cp_model

ap = argparse.ArgumentParser()
ap.add_argument('--layout', required=True)
ap.add_argument('--density', default='0.16,0.26')
ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--time', type=float, default=120)
ap.add_argument('--workers', type=int, default=8)
ap.add_argument('--sym-boxes', action='store_true')
ap.add_argument('--count', type=int, default=1, help='keep looking for this many different unique solutions (the pool step keeps the best)')
ap.add_argument('--out', default='sol.json')
ap.add_argument('--verbose', action='store_true')
a = ap.parse_args()
L = json.load(open(a.layout)); R, C, owner = L['rows'], L['cols'], L['owner']
N = R * C; rnd = random.Random(a.seed)
regions = {}
for i, g in enumerate(owner): regions.setdefault(g, []).append(i)
nb = lambda i: [j for j in ((i - C) if i >= C else -1, (i + C) if i + C < N else -1, (i - 1) if i % C else -1, (i + 1) if (i + 1) % C else -1) if j >= 0]
ekey = lambda i, j: (min(i, j), max(i, j))
lo, hi = map(float, a.density.split(','))
def log(*x):
    if a.verbose: print(*x, file=sys.stderr, flush=True)

def build(counts=None):
    m = cp_model.CpModel()
    box = [m.NewBoolVar(f'b{i}') for i in range(N)]
    arcs = [(i, i, box[i]) for i in range(N)]; arc = {}
    for i in range(N):
        for j in nb(i):
            x = m.NewBoolVar(f'a{i}_{j}'); arc[(i, j)] = x; arcs.append((i, j, x))
    m.AddCircuit(arcs)
    edge = {}
    for (i, j), x in arc.items():
        if i < j: e = m.NewBoolVar(f'e{i}_{j}'); m.Add(e == x + arc[(j, i)]); edge[(i, j)] = e
    for i in range(N):
        for j in nb(i):
            if i < j: m.Add(box[i] + box[j] <= 1)
    if counts is not None:
        for g, cells in regions.items(): m.Add(sum(box[i] for i in cells) == counts[g])
    else:
        nb_ = sum(box); m.Add(nb_ >= int(lo * N)); m.Add(nb_ <= int(hi * N))
    if a.sym_boxes:
        for i in range(N): m.Add(box[i] == box[N - 1 - i])
    return m, box, edge

def solution(s, box, edge):
    return {'box': {i for i in range(N) if s.Value(box[i])}, 'edge': {k for k, e in edge.items() if s.Value(e)}}

def counts_of(A): return {g: sum(1 for i in cells if i in A['box']) for g, cells in regions.items()}

def nearest_alt(A):
    m, box, edge = build(counts_of(A))
    diffs = [box[i].Not() if i in A['box'] else box[i] for i in range(N)] + [e.Not() if k in A['edge'] else e for k, e in edge.items()]
    m.AddBoolOr(diffs); m.Minimize(sum(diffs))
    s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = 30; s.parameters.num_workers = a.workers; s.parameters.random_seed = rnd.randint(0, 10**6)
    st = s.Solve(m)
    if st == cp_model.INFEASIBLE: return None
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE): return 'unknown'
    return solution(s, box, edge)

M, box, edge = build(None)
noise = [rnd.randint(-6, 6) for _ in range(N)]
M.Minimize(sum(noise[i] * box[i] for i in range(N)))                     # a random preference (for and against boxes) so that runs differ
def pattern_clause(S, K2):
    """Literals that are all false exactly when the cells K2 (and their loop segments) look as they do in S."""
    lits = [box[i].Not() if i in S['box'] else box[i] for i in K2]
    ks = {ekey(i, j) for i in K2 for j in nb(i)}
    lits += [edge[k].Not() if k in S['edge'] else edge[k] for k in ks]
    return lits
t0 = time.time(); hint = None; it = 0; clauses = 0
found = []
while time.time() - t0 < a.time and len(found) < a.count:
    it += 1
    if hint:
        M.Minimize(sum((1 - box[i]) if i in hint['box'] else box[i] for i in range(N)) + sum((1 - e) if k in hint['edge'] else e for k, e in edge.items()))
        M.ClearHints()
        for i in range(N): M.AddHint(box[i], 1 if i in hint['box'] else 0)
        for k, e in edge.items(): M.AddHint(e, 1 if k in hint['edge'] else 0)
    s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = max(5, min(60, a.time - (time.time() - t0))); s.parameters.num_workers = a.workers; s.parameters.random_seed = a.seed + it
    st = s.Solve(M)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        log(f'no candidate left after {clauses} clauses ({"time out" if st == cp_model.UNKNOWN else "infeasible"})'); break
    A = solution(s, box, edge); hint = A
    B = nearest_alt(A)
    if B is None:
        found.append(A)
        log(f'unique solution {len(found)} after {it} rounds, {time.time()-t0:.0f}s')
        # look for another: never these boxes again, and start afresh from a new random preference
        M.AddBoolOr([box[i].Not() if i in A['box'] else box[i] for i in range(N)])
        noise = [rnd.randint(-6, 6) for _ in range(N)]
        M.Minimize(sum(noise[i] * box[i] for i in range(N))); M.ClearHints(); hint = None
        continue
    if B == 'unknown': log('inner solve timed out'); continue
    K = {i for i in range(N) if (i in A['box']) != (i in B['box'])}
    for k in A['edge'] ^ B['edge']: K.update(k)
    K2 = set(K)
    for i in K: K2.update(nb(i))
    loop_only = all((i in A['box']) == (i in B['box']) for i in K)
    if loop_only:
        # the same boxes, two routings: the counts play no part, so the same neighbourhood is forbidden wherever it fits on the board
        rs = [i // C for i in K2]; cs = [i % C for i in K2]
        for dr in range(-min(rs), R - max(rs)):
            for dc in range(-min(cs), C - max(cs)):
                sh = lambda i: (i // C + dr) * C + (i % C + dc)
                for S in (A, B):
                    S2 = {'box': {sh(i) for i in K2 if i in S['box']}, 'edge': {ekey(sh(i), sh(j)) for (i, j) in S['edge'] if i in K2 or j in K2}}
                    M.AddBoolOr(pattern_clause(S2, {sh(i) for i in K2})); clauses += 1
    else:
        M.AddBoolOr(pattern_clause(A, K2)); M.AddBoolOr(pattern_clause(B, K2)); clauses += 2
    log(f'round {it}: {len(K)} cells differ ({"loop only" if loop_only else "boxes move"}), boxes {len(A["box"])}, {time.time()-t0:.0f}s')
if not found:
    print(f'no unique puzzle within {a.time:.0f}s ({clauses} clauses)', file=sys.stderr); sys.exit(1)
# the edges in the app's numbering: 2*i = the segment to the right of cell i, 2*i+1 = the one below it
enc = lambda A: {'boxes': sorted(A['box']), 'edges': sorted(2 * i + (0 if j == i + 1 else 1) for (i, j) in A['edge'])}
json.dump({'rows': R, 'cols': C, 'owner': owner, 'kind': L.get('kind'), **enc(found[0]), 'solutions': [enc(A) for A in found]}, open(a.out, 'w'))
print(f'{len(found)} unique solution(s) with every number after {it} rounds, {clauses} clauses, {time.time()-t0:.0f}s -> {a.out}', file=sys.stderr)
