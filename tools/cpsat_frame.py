#!/usr/bin/env python3
"""
Frame puzzles by constraint solving (needs OR-tools: the star battle venv has it).

The arrows are chosen first: an N x N inside, a ring of void cells, and an arrow on every `spacing`-th row and column (spacing 4: the 2nd, 6th, 10th ...; spacing 2: the 2nd, 4th ...)
from both ends, each saying a number from a pattern you give. The solver then looks for the voids inside: a loop through every inside cell
that is neither a box nor a void, boxes that never touch, and exactly the numbers on the arrows; and then, by local search, for a set of voids
that leaves exactly ONE solution (the idea is from stefliew's 20x20 on logic-masters.de, puzzle 0006NR: every third line, every arrow 6; the Frame book deliberately
avoids that layout: no spacing 3, no even lattice with one number everywhere; see tools/cpsat_frame2.py, which also takes irregular line sets).

  python3 tools/cpsat_frame.py --inside 14 --spacing 4 --rows 2,4,5,3 --cols 4,2,3,5 --seed 1 --time 600 --out frame.json
  --rows 2,4,5,3 --cols 4,2,3,5   one number per arrow line (both ends alike); --numbers N would put N on every arrow (not for the book unless the lines are irregular)

Output: JSON {rows, cols, clues, boxes, edges} (board coordinates: the ring included), or exit status 1 if no unique puzzle was found.
"""
import argparse, json, random, sys, time
from ortools.sat.python import cp_model

ap = argparse.ArgumentParser()
ap.add_argument('--inside', type=int, default=12)
ap.add_argument('--spacing', type=int, default=3)
ap.add_argument('--numbers', type=int, default=None)
ap.add_argument('--rows', default=None); ap.add_argument('--cols', default=None)
ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--time', type=float, default=300)
ap.add_argument('--void-share', default='0.10,0.20', help='lo,hi share of the inside cells that are voids')
ap.add_argument('--holes', default=None, help='JSON from tools/frame_holes.mjs: a loop whose cells admit no other loop; the solver only chooses which holes are boxes')
ap.add_argument('--density', type=float, default=0.35, help='share of the inside that the loop leaves out (boxes and voids) before repairs')
ap.add_argument('--out', default='frame.json')
ap.add_argument('--verbose', action='store_true')
a = ap.parse_args()
rnd = random.Random(a.seed)
n = a.inside; R = C = n + 2
lines = [k for k in range(1, n + 1) if (k - 1) % a.spacing == 1 % a.spacing]
num = a.numbers if a.numbers is not None else n // a.spacing
rowN = dict(zip(lines, map(int, a.rows.split(',')))) if a.rows else {k: num for k in lines}
colN = dict(zip(lines, map(int, a.cols.split(',')))) if a.cols else {k: num for k in lines}
lo, hi = map(float, a.void_share.split(','))
DR = [-1, 0, 1, 0]; DC = [0, 1, 0, -1]
inside = [(r, c) for r in range(1, n + 1) for c in range(1, n + 1)]
def log(*x):
    if a.verbose: print(*x, file=sys.stderr, flush=True)

def build(voids=None, forbid_same=None):
    """voids: None (the solver chooses them) or a set of cells; returns (model, vars)."""
    m = cp_model.CpModel()
    box = {u: m.NewBoolVar(f'b{u}') for u in inside}
    loop = {u: m.NewBoolVar(f'l{u}') for u in inside}
    void = {}
    for u in inside:
        if voids is None:
            void[u] = m.NewBoolVar(f'v{u}'); m.AddExactlyOne([box[u], loop[u], void[u]])
        else:
            if u in voids: m.Add(box[u] == 0); m.Add(loop[u] == 0)
            else: m.AddExactlyOne([box[u], loop[u]])
    arcs = []; arcv = {}
    for u in inside:
        arcs.append((inside.index(u), inside.index(u), loop[u].Not()))
    idx = {u: i for i, u in enumerate(inside)}
    for u in inside:
        for d in range(4):
            v = (u[0] + DR[d], u[1] + DC[d])
            if v in idx:
                x = m.NewBoolVar(f'a{u}{v}'); arcv[(u, v)] = x; arcs.append((idx[u], idx[v], x))
    m.AddCircuit(arcs)
    for u in inside:                                         # a cell not on the loop has no arc
        pass
    edge = {}
    for (u, v), x in arcv.items():
        if (v, u) in arcv and u < v:
            e = m.NewBoolVar(f'e{u}{v}'); m.Add(e == x + arcv[(v, u)]); edge[(u, v)] = e
    for u in inside:
        for v in ((u[0], u[1] + 1), (u[0] + 1, u[1])):
            if v in box: m.Add(box[u] + box[v] <= 1)
    for k in lines:
        m.Add(sum(box[(k, c)] for c in range(1, n + 1)) == rowN[k])
        m.Add(sum(box[(r, k)] for r in range(1, n + 1)) == colN[k])
    return m, box, loop, void, edge

def solve(m, secs, obj=None, workers=8, seed=0):
    if obj is not None: m.Minimize(obj)
    s = cp_model.CpSolver(); s.parameters.max_time_in_seconds = secs; s.parameters.num_workers = workers; s.parameters.random_seed = seed
    st = s.Solve(m)
    return s, st

t0 = time.time()
if not a.holes:
    # plant: boxes that already give every arrow line its number, then a loop that is unique for holes that include them (tools/frame_holes.mjs)
    import subprocess, tempfile, os
    pm = cp_model.CpModel(); pb = {u: pm.NewBoolVar(f'p{u}') for u in inside}
    for u in inside:
        for v in ((u[0], u[1] + 1), (u[0] + 1, u[1])):
            if v in pb: pm.Add(pb[u] + pb[v] <= 1)
    for k in lines:
        pm.Add(sum(pb[(k, c)] for c in range(1, n + 1)) == rowN[k]); pm.Add(sum(pb[(r, k)] for r in range(1, n + 1)) == colN[k])
    pnoise = {u: rnd.randint(0, 9) for u in inside}
    pm.Minimize(sum(pnoise[u] * pb[u] for u in inside) + 8 * sum(pb[u] for u in inside if u[0] not in lines and u[1] not in lines))
    ps = cp_model.CpSolver(); ps.parameters.max_time_in_seconds = 30; ps.parameters.random_seed = a.seed
    if ps.Solve(pm) not in (cp_model.OPTIMAL, cp_model.FEASIBLE): print('these numbers cannot be placed', file=sys.stderr); sys.exit(1)
    plant = [list(u) for u in inside if ps.Value(pb[u])]
    tmp = tempfile.mkdtemp(); pf = os.path.join(tmp, 'plant.json'); json.dump(plant, open(pf, 'w'))
    here = os.path.dirname(os.path.abspath(__file__))
    out = subprocess.run(['node', os.path.join(here, 'frame_holes.mjs'), '--inside', str(n), '--seed', str(a.seed), '--density', str(a.density), '--plant', pf], capture_output=True, text=True)
    if out.returncode: print('no loop for the planted holes', out.stderr.strip()[:200], file=sys.stderr); sys.exit(1)
    a.holes = os.path.join(tmp, 'holes.json'); open(a.holes, 'w').write(out.stdout)
    log('planted', len(plant), 'boxes;', f'{time.time()-t0:.1f}s')
def read(s, box, loop, void, edge):
    return {'box': {u for u in inside if s.Value(box[u])}, 'void': {u for u in inside if void and s.Value(void[u])} if void else set(),
            'edge': {k for k, e in edge.items() if s.Value(e)}}
# 1. a first solution: loop, boxes and voids
if a.holes:
    H = json.load(open(a.holes)); assert H['n'] == n
    holes = {tuple(h) for h in H['holes']}
    m = cp_model.CpModel()
    hb = {u: m.NewBoolVar(f'b{u}') for u in holes}
    for u in holes:
        for v in ((u[0], u[1] + 1), (u[0] + 1, u[1])):
            if v in hb: m.Add(hb[u] + hb[v] <= 1)
    for k in lines:
        m.Add(sum(hb[(k, c)] for c in range(1, n + 1) if (k, c) in hb) == rowN[k])
        m.Add(sum(hb[(r, k)] for r in range(1, n + 1) if (r, k) in hb) == colN[k])
    freeb = [hb[u] for u in holes if u[0] not in lines and u[1] not in lines]
    noise = {u: rnd.randint(0, 5) for u in holes}
    m.Minimize(10 * sum(freeb) + sum(noise[u] * hb[u] for u in holes))
    s_ = cp_model.CpSolver(); s_.parameters.max_time_in_seconds = 60; s_.parameters.random_seed = a.seed
    st = s_.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print('the holes cannot give these numbers', file=sys.stderr); sys.exit(1)
    boxes = {u for u in holes if s_.Value(hb[u])}
    A = {'box': boxes, 'void': holes - boxes,
         'edge': {tuple(sorted((tuple(e[0]), tuple(e[1])))) for e in H['edges']}}
else:
    m, box, loop, void, edge = build(None)
    m.Add(sum(void.values()) >= int(lo * n * n)); m.Add(sum(void.values()) <= int(hi * n * n))
    noise = {u: rnd.randint(0, 20) for u in inside}
    s, st = solve(m, 60, obj=sum(noise[u] * box[u] for u in inside), seed=a.seed)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        print('no solution with these numbers', file=sys.stderr); sys.exit(1)
    A = read(s, box, loop, void, edge)
log('first solution: boxes', len(A['box']), 'voids', len(A['void']), f'{time.time()-t0:.1f}s')

def nearest_alt(V, A):
    """Another solution of the puzzle with voids V (the nearest to A in loop edges), or None if A is the only one."""
    m, box, loop, void, edge = build(V)
    diffs = []
    for u in inside:
        if u in V: continue
        diffs.append(box[u].Not() if u in A['box'] else box[u])
    ed = []
    for k, e in edge.items():
        ed.append(e.Not() if k in A['edge'] else e)
    m.AddBoolOr(diffs + ed)
    s, st = solve(m, 20, obj=sum(ed) + sum(diffs), seed=rnd.randint(0, 10**6))
    if st == cp_model.INFEASIBLE: return None, 0
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        B = {'box': {u for u in inside if u not in V and s.Value(box[u])}, 'edge': {k for k, e in edge.items() if s.Value(e)}}
        return B, int(s.ObjectiveValue())
    return None, -1        # unknown (time out)

lattice_rows = set(lines); lattice_cols = set(lines)
def moves(A):
    """Changes that keep A a solution: free boxes <-> voids, and a box <-> void swap along an arrow line through free columns/rows."""
    V = A['void']; Bx = A['box']; out = []
    free = lambda u: u[0] not in lattice_rows and u[1] not in lattice_cols
    nb = lambda u: [(u[0] + DR[d], u[1] + DC[d]) for d in range(4)]
    holes = V | Bx
    for u in holes:
        if free(u):
            if u in Bx: out.append(('v', u))
            elif not any(x in Bx for x in nb(u)): out.append(('b', u))
    for k in lines:
        rb = [u for u in Bx if u[0] == k and u[1] not in lattice_cols]; rv = [u for u in V if u[0] == k and u[1] not in lattice_cols]
        for b in rb:
            for v in rv:
                if not any(x in Bx and x != b for x in nb(v)): out.append(('sw', b, v))
        cb = [u for u in Bx if u[1] == k and u[0] not in lattice_rows]; cv = [u for u in V if u[1] == k and u[0] not in lattice_rows]
        for b in cb:
            for v in cv:
                if not any(x in Bx and x != b for x in nb(v)): out.append(('sw', b, v))
    return out

def apply(A, mv):
    B = {'box': set(A['box']), 'void': set(A['void']), 'edge': A['edge']}
    if mv[0] == 'v': B['box'].discard(mv[1]); B['void'].add(mv[1])
    elif mv[0] == 'b': B['void'].discard(mv[1]); B['box'].add(mv[1])
    else: B['box'].discard(mv[1]); B['void'].add(mv[1]); B['void'].discard(mv[2]); B['box'].add(mv[2])
    return B

# 2. local search over the voids
alt, dist = nearest_alt(A['void'], A)
best = dist if alt else 10**9
log('start: nearest other solution at distance', dist if alt else 'none')
it = 0
while alt is not None and time.time() - t0 < a.time:
    it += 1
    mv_list = moves(A)
    if not mv_list: log('no moves'); break
    mv = rnd.choice(mv_list); A2 = apply(A, mv)
    alt2, d2 = nearest_alt(A2['void'], A2)
    ok = alt2 is None or d2 < 0 or d2 >= dist
    log(f'iter {it}: {mv[0]} -> distance {"unique" if alt2 is None else d2} (was {dist}) {"accept" if ok else "reject"}  {time.time()-t0:.0f}s')
    if ok and d2 >= 0:
        A, alt, dist = A2, alt2, (d2 if alt2 is not None else 0)
if alt is not None:
    print(f'no unique puzzle in {a.time:.0f}s (nearest other solution {dist} edges away)', file=sys.stderr); sys.exit(1)
clues = []
for r in range(R):
    for c in range(C):
        ring = r in (0, R - 1) or c in (0, C - 1)
        if ring:
            corner = r in (0, R - 1) and c in (0, C - 1); d = -1
            if not corner:
                if r == 0 and c in lines: d = 2; k = c
                elif r == R - 1 and c in lines: d = 0; k = c
                elif c == 0 and r in lines: d = 1; k = r
                elif c == C - 1 and r in lines: d = 3; k = r
            if d < 0: clues.append({'r': r, 'c': c, 'd': 0, 'n': -1})
            else: clues.append({'r': r, 'c': c, 'd': d, 'n': (colN if d in (0, 2) else rowN)[k]})
        elif (r, c) in A['void']: clues.append({'r': r, 'c': c, 'd': 0, 'n': -1})
json.dump({'rows': R, 'cols': C, 'clues': clues, 'boxes': sorted(A['box']), 'edges': sorted([list(map(list, e)) for e in A['edge']])}, open(a.out, 'w'))
print(f'unique puzzle after {it} iterations, {time.time()-t0:.0f}s: {len(A["void"])} voids, {len(A["box"])} boxes -> {a.out}', file=sys.stderr)
