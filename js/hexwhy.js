// Why does an imagined mark break a hex position? The propagation in logic.js finds the contradiction but cannot say how; this redoes the same easy
// reasoning one fact at a time, remembering what each fact was concluded from, and then tells the story of only the facts the contradiction needs:
//
//   Imagine a box at E1: the clue at D1 would have all its boxes, so ... would be dots; then ... would be left with fewer than two ways out; and then
//   B3 would have only one line to go on. So E1 is a dot.
//
// The rules are the ones propagate() uses: a box's neighbours are on the loop; an undecided cell with fewer than two neighbours it could join is a box;
// a loop cell with exactly two such neighbours joins both, with two lines it takes no more; an arrow with all its boxes leaves the rest of its line to the
// loop, one with exactly as many open cells as it needs makes them all boxes; and a line that would close a loop that leaves out other loop cells is no line.
// The contradictions: too many or too few boxes on a line, a loop cell with fewer than two ways out or with three lines, two touching boxes, and a loop
// that closes early. Pure (no DOM).
import { UNKNOWN, SHADED, LOOP, E_UNKNOWN, E_ON, E_OFF } from './logic.js';

const list = (xs) => (xs.length > 2 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(' and '));
const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * Explain why imagining `assume` on top of `base` (a solver state: the player's marks, with every cell a segment touches on the loop) cannot be right.
 * assume: { kind: 'cell', i, v: SHADED | LOOP } or { kind: 'edge', x, v: E_ON | E_OFF }.  name(i): a cell's name ("C4").
 * Returns { text, roles: { clue, range, problem, focus }, imagined: { shaded, loop } (the boxes and dots the move would force), chain: [segments], steps: n } or null if this reasoning finds no contradiction
 * (the caller then falls back to a plainer sentence).
 */
export function explainImagine(P, base, assume, name) {
  const { N, K, nb, ed, edgeA, edgeB, clueAt } = P;
  const cell = Int8Array.from(base.cell), e = Int8Array.from(base.e);
  const facts = [], fc = new Int32Array(N).fill(-1), fe = new Int32Array(P.numEdges).fill(-1);
  let contra = null, changed = true;
  const add = (kind, idx, val, rule, ref, deps, hidden = false, extra = null) => {
    const id = facts.length;
    facts.push({ id, kind, idx, val, rule, ref, deps: deps.filter((d) => d >= 0), hidden, extra });
    if (kind === 'c') { cell[idx] = val; fc[idx] = id; } else { e[idx] = val; fe[idx] = id; }
    changed = true;
    return id;
  };
  const fail = (rule, ref, deps, cells = [], arrows = [], count = 0, ways = []) => { if (!contra) contra = { rule, ref, deps: deps.filter((d) => d >= 0), cells, arrows, count, ways }; };

  // the neighbours of i the loop could still use (a direction each), and what rules the others out
  const exits = (i) => { const out = []; for (let d = 0; d < K; d++) { const j = nb[i * K + d]; if (j >= 0 && cell[j] !== SHADED && e[ed[i * K + d]] !== E_OFF) out.push(d); } return out; };
  const blockers = (i) => { const out = []; for (let d = 0; d < K; d++) { const j = nb[i * K + d]; if (j < 0) continue; if (cell[j] === SHADED) out.push(fc[j]); else if (e[ed[i * K + d]] === E_OFF) out.push(fe[ed[i * K + d]]); } return out; };
  const onLines = (i) => { const out = []; for (let d = 0; d < K; d++) { const x = ed[i * K + d]; if (x >= 0 && e[x] === E_ON) out.push(x); } return out; };

  if (assume.kind === 'cell') add('c', assume.i, assume.v, 'imagine', -1, []); else add('e', assume.x, assume.v, 'imagine', -1, []);

  for (let pass = 0; changed && !contra && pass < 4 * N; pass++) {
    changed = false;
    for (let i = 0; i < N && !contra; i++) {
      if (clueAt[i] >= 0) continue;
      if (cell[i] === SHADED) {
        for (let d = 0; d < K && !contra; d++) {
          const j = nb[i * K + d];
          if (j < 0) continue;
          if (cell[j] === SHADED) fail('box-touch', i, [fc[i], fc[j]], [i, j]);
          else if (cell[j] === UNKNOWN) add('c', j, LOOP, 'box-neighbor', i, [fc[i]]);
        }
      } else if (cell[i] === UNKNOWN) {
        const lines = onLines(i);
        if (lines.length) add('c', i, LOOP, 'edge-loop', -1, lines.map((x) => fe[x]), true);
        else if (exits(i).length < 2) add('c', i, SHADED, 'no-room', i, blockers(i), false, [...Array(K).keys()].map((d) => nb[i * K + d]).filter((j) => j >= 0 && cell[j] === SHADED));
      } else {                                                           // a loop cell
        const ex = exits(i), lines = onLines(i), own = fc[i];
        if (ex.length < 2) fail('loop-few', i, [own, ...blockers(i)], [i], [], 0, ex.map((d) => nb[i * K + d]));
        else if (lines.length > 2) fail('loop-many', i, [own, ...lines.map((x) => fe[x])], [i]);
        else if (lines.length === 2) { for (const d of ex) { const x = ed[i * K + d]; if (e[x] === E_UNKNOWN) add('e', x, E_OFF, 'full', i, [own, ...lines.map((y) => fe[y])], true); } }
        else if (ex.length === 2) { for (const d of ex) { const x = ed[i * K + d]; if (e[x] === E_UNKNOWN) add('e', x, E_ON, 'two-exits', i, [own, ...blockers(i)], false, ex.map((q) => nb[i * K + q])); } }
      }
    }
    for (let k = 0; k < P.clues.length && !contra; k++) {
      const cl = P.clues[k];
      if (cl.n < 0) continue;
      const ray = P.rays[k], shaded = ray.filter((i) => cell[i] === SHADED), open = ray.filter((i) => cell[i] === UNKNOWN), loop = ray.filter((i) => cell[i] === LOOP);
      if (shaded.length > cl.n) fail('arrow-over', k, shaded.map((i) => fc[i]), shaded, [k], shaded.length);
      else if (shaded.length + open.length < cl.n) fail('arrow-short', k, loop.map((i) => fc[i]), loop, [k], shaded.length + open.length);
      else if (open.length && shaded.length === cl.n) for (const i of open) add('c', i, LOOP, 'arrow-done', k, shaded.map((j) => fc[j]));
      else if (open.length && shaded.length + open.length === cl.n) for (const i of open) add('c', i, SHADED, 'arrow-full', k, loop.map((j) => fc[j]));
    }
    if (contra) break;
    // a loop that closes early, and the lines that would close one
    const parent = Array.from({ length: N }, (_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    let cycleAt = -1;
    for (let x = 0; x < P.numEdges; x++) {
      if (e[x] !== E_ON) continue;
      const ra = find(edgeA[x]), rb = find(edgeB[x]);
      if (ra === rb) cycleAt = edgeA[x]; else parent[ra] = rb;
    }
    const loopCells = []; for (let i = 0; i < N; i++) if (cell[i] === LOOP) loopCells.push(i);
    const lines = (root) => { const out = []; for (let x = 0; x < P.numEdges; x++) if (e[x] === E_ON && find(edgeA[x]) === root) out.push(fe[x]); return out; };
    if (cycleAt >= 0) {
      const root = find(cycleAt), other = loopCells.find((i) => find(i) !== root);
      if (other !== undefined) fail('early-close', cycleAt, [...lines(root), fc[other]], loopCells.filter((i) => find(i) === root).slice(0, 6));
    } else {
      const size = new Map();
      for (const i of loopCells) size.set(find(i), (size.get(find(i)) || 0) + 1);
      for (let x = 0; x < P.numEdges; x++) {
        const a = edgeA[x];
        if (a < 0 || e[x] !== E_UNKNOWN || clueAt[a] >= 0 || clueAt[edgeB[x]] >= 0 || cell[a] === SHADED || cell[edgeB[x]] === SHADED) continue;
        const r = find(a);
        if (r === find(edgeB[x]) && size.get(r) > 0 && size.get(r) < loopCells.length) add('e', x, E_OFF, 'close-off', x, lines(r));
      }
    }
  }
  if (!contra) return null;

  // the facts the contradiction needs, in the order they were concluded
  const needed = new Set(), stack = [...contra.deps];
  while (stack.length) { const id = stack.pop(); if (needed.has(id)) continue; needed.add(id); stack.push(...facts[id].deps); }
  const shown = facts.filter((f) => needed.has(f.id) && !f.hidden && f.rule !== 'imagine' && f.rule !== 'full');
  const groups = [];
  for (const f of shown) {
    const key = f.rule === 'no-room' ? 'no-room' : f.rule === 'close-off' ? `close-off${f.idx}` : `${f.rule}:${f.ref}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.facts.push(f); else groups.push({ key, rule: f.rule, ref: f.ref, facts: [f] });
  }

  const roles = { clue: [], range: [], problem: [], focus: [] }, chain = [], imagined = { shaded: [], loop: [] };   // imagined: the boxes and dots the move forces (drawn as a what-if)
  const arrowCell = (k) => P.clues[k].r * P.cols + P.clues[k].c;
  const cellsOf = (g) => g.facts.filter((f) => f.kind === 'c').map((f) => f.idx);
  const pieces = groups.map((g) => {
    const cs = cellsOf(g).map(name);
    switch (g.rule) {
      case 'box-neighbor': imagined.loop.push(...cellsOf(g)); return `${list(cs)} would be ${plural(cs.length, 'a dot', 'dots')}, since boxes never touch`;
      case 'arrow-done': {
        const n = P.clues[g.ref].n; roles.clue.push(arrowCell(g.ref)); roles.range.push(...P.rays[g.ref]); imagined.loop.push(...cellsOf(g));
        return n === 0 ? `the clue at ${name(arrowCell(g.ref))} says 0, so ${list(cs)} on its line would ${plural(cs.length, 'be a dot', 'be dots')}`
          : `the clue at ${name(arrowCell(g.ref))} would have all its ${n} ${plural(n, 'box', 'boxes')}, so ${list(cs)} on its line would ${plural(cs.length, 'be a dot', 'be dots')}`;
      }
      case 'arrow-full': {
        const n = P.clues[g.ref].n; roles.clue.push(arrowCell(g.ref)); roles.range.push(...P.rays[g.ref]); imagined.shaded.push(...cellsOf(g));
        return `the clue at ${name(arrowCell(g.ref))} could only get its ${n} ${plural(n, 'box', 'boxes')} by using ${list(cs)}, so ${cs.length === 1 ? `${cs[0]} would be a box` : 'they would all be boxes'}`;
      }
      case 'no-room': {
        imagined.shaded.push(...cellsOf(g));
        const beside = [...new Set(g.facts.flatMap((f) => f.extra || []))].map(name);
        return `${list(cs)} would be left with fewer than two ways out${cs.length === 1 && beside.length ? ` (the ${plural(beside.length, 'box', 'boxes')} at ${list(beside)} ${plural(beside.length, 'is', 'are')} next to it)` : ''}, so ${plural(cs.length, 'a box', 'boxes')}`;
      }
      case 'two-exits': {
        const i = g.ref, ways = g.facts[0].extra.map(name);
        for (const f of g.facts) chain.push(f.idx);
        roles.range.push(i);
        return `${name(i)} would have only two ways on (${list(ways)}), so the loop would run through both (dashed)`;
      }
      default: return `a line between ${name(edgeA[g.facts[0].idx])} and ${name(edgeB[g.facts[0].idx])} would close a loop that leaves out other loop cells, so there would be no line there`;
    }
  });

  const c = contra, cs = c.cells.map(name);
  roles.problem.push(...c.cells); for (const k of c.arrows) roles.clue.push(arrowCell(k));
  const broken = {
    'box-touch': () => `the boxes at ${list(cs)} would touch`,
    'loop-few': () => `${cs[0]} would be on the loop with ${c.ways.length ? `only one way out (${c.ways.map(name)[0]})` : 'no way out'}, and a loop cell needs two`,
    'loop-many': () => `${cs[0]} would have more than two lines`,
    'arrow-over': () => `the clue at ${name(arrowCell(c.arrows[0]))} would have ${c.count} ${plural(c.count, 'box', 'boxes')} on its line, more than the ${P.clues[c.arrows[0]].n} it asks for`,
    'arrow-short': () => `the clue at ${name(arrowCell(c.arrows[0]))} asks for ${P.clues[c.arrows[0]].n} ${plural(P.clues[c.arrows[0]].n, 'box', 'boxes')} but its line would have room for only ${c.count}`,
    'early-close': () => `the lines would close a loop (${list(cs)}) that leaves out other loop cells`,
  }[c.rule]();

  let what, verdict;
  if (assume.kind === 'cell') {
    roles.focus.push(assume.i);
    const box = assume.v === SHADED;
    what = `${box ? 'a box' : 'a dot'} at ${name(assume.i)}`;
    verdict = `So ${name(assume.i)} is ${box ? 'a dot' : 'a box'}.`;
  } else {
    const a = edgeA[assume.x], b = edgeB[assume.x];
    roles.focus.push(a, b);
    what = assume.v === E_OFF ? `no line between ${name(a)} and ${name(b)}` : `a line between ${name(a)} and ${name(b)}`;
    verdict = assume.v === E_OFF ? 'So the loop runs between them.' : 'So there is no line between them.';
  }
  const uniq = (xs) => [...new Set(xs)];
  for (const k of Object.keys(roles)) roles[k] = uniq(roles[k]);
  for (const k of Object.keys(imagined)) imagined[k] = uniq(imagined[k]).filter((i) => !(assume.kind === 'cell' && i === assume.i));
  const told = pieces.length > 8 ? [...pieces.slice(0, 4), `${pieces.length - 7} more steps of the same kind follow`, ...pieces.slice(-3)] : pieces;       // a very long chain: its start and its end
  const text = `Imagine ${what}: ${told.length ? `${told.join('; then ')}; and then ` : 'then '}${broken}. ${verdict}`;
  return { text, roles, imagined, chain: uniq(chain), steps: pieces.length };
}
