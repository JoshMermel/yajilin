// Turns a step of the human-style solver (see rating.js) into something the Hint button can show:
// a sentence, the cells to look at (each with a role, so the board can color them differently) and the marks the step makes.
import { OP_SIGN, SHADED, LOOP, CLUE, E_ON, E_OFF, E_UNKNOWN, edgeCells, colName, cloneState } from './logic.js';
import { ruleLabel, followLines, boxProof, hypothesisProof, roomGroups, dotTrace, contradiction, oddOpenEnds, chokepointCheck } from './rating.js';
import { replayImagine } from './imagine.js';

const ARROWS = ['↑', '→', '↓', '←', '↗', '↘', '↙', '↖'];
/** A cell's name like a spreadsheet's: column letter, then row number (E3). */
const cellName = (P, i) => `${colName(i % P.cols)}${((i / P.cols) | 0) + 1}`;
const clueName = (P, k) => (P.clues[k].region
  ? `region numbered ${P.clues[k].n} (at ${cellName(P, P.clues[k].r * P.cols + P.clues[k].c)})`            // regional puzzles: the number counts its region
  : `${OP_SIGN[P.clues[k].op || '=']}${P.clues[k].n}${ARROWS[P.clues[k].d]} clue at ${cellName(P, P.clues[k].r * P.cols + P.clues[k].c)}`);
const clueCell = (P, k) => P.clues[k].r * P.cols + P.clues[k].c;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Roles a highlighted cell can have (the board gives each its own color or texture, see style.css). */
export const ROLES = {
  clue: 'the clue',
  range: 'the cells it counts',
  focus: 'the cell being decided',
  problem: 'where it goes wrong',
  path: 'the ends of a path',
};
/** The roles the hint panel's key explains: the others are named by the sentence itself (the clue, the line it counts, the cell it is about). */
export const KEYED_ROLES = ['problem', 'path'];

/** What the hint panel calls a rule (the ids are for us). */
const RULE_NAMES = {
  shadedNeighbor: 'Boxes never touch', clueDone: 'Clue has all its boxes', clueFull: 'Clue needs every open cell', clueNot: 'A "not n" clue', clueTight: 'Clue fits exactly',
  rangeSameOne: 'Two clues, one way', rangeSame: 'Two clues, one way', rangeFacingKnown: 'Two clues facing', rangeFacing: 'Two clues facing',
  deadEnd: 'Dead end', forcedExits: 'Only two ways out', tightCell: 'A box would strand a neighbour', noEarlyClose: 'No early close',
  sameSegmentExits: 'Ends of one path', closingCell: 'Ends of one path', cluePlacements: 'Placing a clue\'s boxes', placementDeadEnd: 'Placing a clue\'s boxes', regionPairs: 'Two regions together',
  twoEndsJoin: 'Open ends of an area', pairedEnds: 'Open ends of an area', parityPocket: 'Odd open ends', parityForces: 'Odd open ends', crossingParity: 'Crossing a border',
  colorBalance: 'Chessboard colours', chokepoint: 'Only one way in', chokepointArea: 'Only one way in',
  segmentShortChain: 'A line would force lines', segmentForcesLines: 'A line would force lines', segmentClosesLoop: 'A line would close the loop', segmentStarvesClue: 'A line would starve a clue',
  boxStarvesClueByPlacements: 'A box would starve a clue', imagine: 'Imagine a move', imagineLong: 'Imagine a move (long)', tryCell: 'Trial and error', tryEdge: 'Trial and error', uniqueRoute: 'Only one solution',
  'arrow-done': 'Clue has all its boxes', 'arrow-full': 'Clue needs every open cell', 'next-to-box': 'Boxes never touch', 'no-room': 'Dead end', 'two-exits': 'Only two ways out', forced: 'Forced together',
};
export const ruleName = (id) => RULE_NAMES[id] || id;

/** The cells a loop cell could still connect to, ignoring `ignore` (treated as shaded). Needs the solver position `st`. */
function waysOut(P, st, i, ignore = -1) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    const x = P.ed[i * 4 + d];
    if (x < 0) continue;
    const j = P.nb[i * 4 + d];
    if (j === ignore || st.e[x] === E_OFF || st.cell[j] === SHADED) continue;
    out.push(j);
  }
  return out;
}

/** What went wrong at `bad` once the forced lines of position `s2` are in: "give E8 three lines" / "leave E8 with just one way out". */
function failureAt(P, s2, bad) {
  if (s2.closedEarly) return 'close the loop early';
  let lines = 0, ways = 0;
  for (let d = 0; d < 4; d++) {
    const x = P.ed[bad * 4 + d]; if (x < 0) continue;
    if (s2.e[x] === E_ON) lines++;
    const j = P.nb[bad * 4 + d];
    if (s2.e[x] !== E_OFF && s2.cell[j] !== SHADED) ways++;
  }
  if (lines > 2) return `give ${cellName(P, bad)} three lines`;
  return `leave ${cellName(P, bad)} with ${ways === 0 ? 'no way out' : 'just one way out'}`;
}

/** What is wrong in a position the solver found contradictory (for the dot rules' hint): { text, cells }. */
function brokenAt(P, s) {
  for (let i = 0; i < P.N; i++) {
    if (s.cell[i] === SHADED) for (let d = 0; d < 4; d++) { const j = P.nb[i * 4 + d]; if (j >= 0 && s.cell[j] === SHADED) return { text: `boxes at ${cellName(P, i)} and ${cellName(P, j)} would touch`, cells: [i, j] }; }
  }
  for (let k = 0; k < P.clues.length; k++) {
    if (P.clues[k].n < 0) continue;
    let sh = 0, open = 0;
    for (const i of P.rays[k]) { if (s.cell[i] === SHADED) sh++; else if (s.cell[i] === 0) open++; }
    if (sh > P.hi[k]) return { text: `the ${clueName(P, k)} would have too many boxes`, cells: [clueCell(P, k)] };
    if (sh + open < P.lo[k]) return { text: `the ${clueName(P, k)} could no longer reach ${P.lo[k]}`, cells: [clueCell(P, k)] };
    if (open === 0 && sh === P.ne[k]) return { text: `the ${clueName(P, k)} would have exactly ${plural(sh, 'box', 'boxes')}, which it rules out`, cells: [clueCell(P, k)] };
  }
  for (let i = 0; i < P.N; i++) {
    if (s.cell[i] === CLUE || s.cell[i] === SHADED) continue;
    const lines = linesAt(P, s, i);
    if (lines > 2) return { text: `${cellName(P, i)} would have three lines`, cells: [i] };
    if (s.cell[i] === LOOP || lines > 0) {
      let ways = 0;
      for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x < 0) continue; const j = P.nb[i * 4 + d]; if (s.e[x] === E_OFF || s.cell[j] === SHADED) continue; if (s.e[x] !== E_ON && linesAt(P, s, j) >= 2) continue; ways++; }
      if (ways < 2) return { text: `${cellName(P, i)} would be left with ${ways === 0 ? 'no way out' : 'just one way out'}`, cells: [i] };
    }
  }
  const ends = oddOpenEnds(P, s);
  if (ends) return { text: `an area would be cut off with ${plural(ends.length, 'open end')} (purple), which can't be paired up`, cells: [], ends };
  return { text: contradiction(P, s) ? 'the loop would close early' : 'something would break', cells: [] };
}

/** Lines at cell `i` in a position. */
function linesAt(P, s, i) {
  let n = 0;
  for (let d = 0; d < 4; d++) { const x = P.ed[i * 4 + d]; if (x >= 0 && s.e[x] === E_ON) n++; }
  return n;
}

/**
 * The neighbours of `bad` that the forced lines of `s2` filled up (two lines, from one or fewer in `st`): `bad` cannot join them, which is
 * what leaves it short of ways out. Empty when `bad` has three lines or the loop closed.
 */
function filledNeighbours(P, st, s2, bad) {
  if (s2.closedEarly || linesAt(P, s2, bad) > 2) return [];
  const out = [];
  for (let d = 0; d < 4; d++) {
    const x = P.ed[bad * 4 + d]; if (x < 0) continue;
    const j = P.nb[bad * 4 + d];
    if (s2.e[x] === E_ON || s2.cell[j] === SHADED || st.e[x] === E_OFF) continue;
    if (linesAt(P, s2, j) >= 2 && linesAt(P, st, j) < 2) out.push(j);
  }
  return out;
}

/** How a box at info.cell ends in a contradiction: "that give E8 three lines" / "that leave E8 with just one way out" (needs `st`). */
function strandedResult(P, st, info, closes = false) {
  if (!st) return closes ? 'that close the loop early' : `that give ${cellName(P, info.stranded)} three lines or too few ways out`;
  const s2 = cloneState(st); s2.cell[info.cell] = SHADED;
  return `that ${failureAt(P, s2, followLines(P, s2))}`;
}

/** Whether the lines a box at `cell` forces close the loop early (as opposed to leaving a cell with three lines or too few ways out). */
function cloneStateClosed(P, st, cell) {
  const s2 = cloneState(st); s2.cell[cell] = SHADED;
  followLines(P, s2);
  return !!s2.closedEarly;
}

/** The segments a box at `cell` would force (their edge indexes), by following the lines from position `st`. */
function forcedLines(P, st, cell) {
  const s2 = cloneState(st); s2.cell[cell] = SHADED;
  followLines(P, s2);
  const out = [];
  for (let x = 0; x < P.numEdges; x++) if (s2.e[x] === E_ON && st.e[x] !== E_ON) out.push(x);
  return out;
}

/** The same for a segment assumed off or on. */
function segmentResult(P, st, info, closes = false) {
  if (!st) return closes ? 'close the loop early' : `give ${cellName(P, info.stranded)} three lines or too few ways out`;
  const s2 = cloneState(st); s2.e[info.edge] = info.assumed === 'off' ? E_OFF : E_ON;
  return failureAt(P, s2, followLines(P, s2));
}

/**
 * Returns { rule, tier, weight, label, text, roles: {role: [cells]}, sourceCells, targets: { shaded, loop, segOn, segOff } }.
 * `st` is the solver position the step was found in (optional; lets some explanations show ways out).
 */
export function explainStep(P, step, st = null) {
  const { rule, info } = step;
  const roles = {};
  const role = (r, ...cells) => { roles[r] = [...new Set([...(roles[r] || []), ...cells.flat().filter((c) => c !== undefined && c >= 0)])]; };
  let text = '', chain = [], imagined = { shaded: [], loop: [] };       // imagined: what an imagined move would turn into boxes and dots (drawn as a what-if)

  const N = (i) => cellName(P, i);
  const join = (xs) => (xs.length > 2 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(' and '));
  // what the step settles, as a clause: "F8 is a box and F5 is a dot" (every text ends in it, so the player is told what to mark)
  const settled = () => {
    const bx = [], dt = [];
    for (const [kind, idx, v] of step.sets) if (kind === 'c') (v === SHADED ? bx : dt).push(idx);
    const part = (xs, one, many) => (xs.length ? `${join(xs.map(N))} ${xs.length === 1 ? one : many}` : '');
    return [part(bx, 'is a box', 'are boxes'), part(dt, 'is a dot', 'are dots')].filter(Boolean).join(' and ');
  };
  const edgeName = (edge) => { const [a, b] = edgeCells(P, edge); return `${N(a)} and ${N(b)}`; };
  switch (rule) {
    case 'clueDone': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', P.rays[k]);
      const line = P.clues[k].region ? 'region' : 'line';
      const most = P.clues[k].op === '<=';
      text = P.clues[k].n === 0 ? `The ${clueName(P, k)} ${most ? 'allows' : 'needs'} no boxes: its whole ${line} gets dots.` : `The ${clueName(P, k)} has all ${most ? 'the ' : ''}${plural(P.clues[k].n, 'box', 'boxes')}${most ? ' it allows' : ''}: the rest of its ${line} gets dots.`;
      break;
    }
    case 'clueNot': {
      const k = info.clue, cell = info.cells[0], box = info.count === P.ne[k];     // (already n boxes: a dot would leave exactly n, so a box; one short: a box would make n, so a dot)
      role('clue', clueCell(P, k)); role('range', P.rays[k]); role('focus', cell);
      text = `The ${clueName(P, k)} may not hold exactly ${plural(P.ne[k], 'box', 'boxes')}. It has ${plural(info.count, 'box', 'boxes')} and one open cell, ${N(cell)}: ${box ? 'a dot there would leave' : 'a box there would make'} exactly ${P.ne[k]}, so it is ${box ? 'a box' : 'a dot'}.`;
      break;
    }
    case 'clueFull': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', P.rays[k]);
      text = `The ${clueName(P, k)} needs ${plural(info.cells.length, 'more box', 'more boxes')} and has ${info.cells.length === 1 ? 'one open cell' : `${info.cells.length} open cells`} left: ${info.cells.length === 1 ? 'it is a box' : 'all are boxes'}.`;
      break;
    }
    case 'shadedNeighbor':
      role('focus', info.cell);
      text = `Boxes never touch: the cells around the box at ${N(info.cell)} get dots.`;
      break;
    case 'deadEnd':
      role('focus', info.cell);
      text = `${N(info.cell)} has fewer than two ways out, so it can't be on the loop: it's a box.`;
      break;
    case 'forcedExits': {
      role('focus', info.cell);
      text = info.on >= 1
        ? `${N(info.cell)} has a line and one way left to go: the line continues there.`
        : `${N(info.cell)} has only two ways out: it uses both.`;
      break;
    }
    case 'tightCell':
      role('focus', info.cell); role('problem', info.neighbor);
      text = `A box at ${N(info.cell)} would leave ${N(info.neighbor)} with just one way out, so ${N(info.cell)} is a dot.`;
      break;
    case 'deadEndNeighbor':
      role('focus', info.cell); role('problem', info.neighbor);
      const left = st ? waysOut(P, st, info.neighbor, info.cell).length : -1;
      text = `A box at ${N(info.cell)} would leave ${N(info.neighbor)} with ${left === 0 ? 'no way out' : left === 1 ? 'just one way out' : 'fewer than two ways out'}.`;
      break;
    case 'boxStarvesClue':
    case 'boxStarvesClueByLines': {
      const k = info.clue; role('focus', info.cell); role('clue', clueCell(P, k)); role('range', P.rays[k]); role('problem', info.dots);
      const names = info.dots.map(N), list = names.length > 2 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join(' and ');
      if (info.chain) {
        // framed like the lines a box forces elsewhere: the box forces segments (dashed), and those leave the clue with no room
        const segs = new Set();
        if (st) for (const j of info.through) for (let e = 0; e < 4; e++) {
          const x = P.ed[j * 4 + e], m = P.nb[j * 4 + e];
          if (x >= 0 && info.chain.includes(m) && st.e[x] === E_UNKNOWN) segs.add(x);       // the new segments that lead to the dots in the clue's line
        }
        chain = [...segs].sort((a, b) => a - b);
        text = `A box at ${N(info.cell)} would force ${chain.length ? 'the dashed lines' : 'lines'}, which violates the ${clueName(P, k)}.`;
        break;
      }
      text = `A box at ${N(info.cell)} would put ${info.dots.length === 1 ? 'a dot' : 'dots'} on ${list}, which violates the ${clueName(P, k)}.`;
      break;
    }
    case 'boxStarvesClueByPlacements': {
      const k = info.clue; role('focus', info.cell); role('clue', clueCell(P, k)); role('range', P.rays[k]);
      const more = plural(info.need, 'more box', 'more boxes');
      if (!st) { text = `A box at ${N(info.cell)} would force lines, and then the ${clueName(P, k)} could not fit its boxes: it would still need ${info.need}, but only ${info.room} fit.`; break; }
      const s2 = cloneState(st); s2.cell[info.cell] = SHADED; followLines(P, s2);
      chain = []; for (let x = 0; x < P.numEdges; x++) if (s2.e[x] === E_ON && st.e[x] !== E_ON) chain.push(x);
      role('problem', ...P.rays[k].filter((j) => st.cell[j] === 0 && s2.cell[j] === LOOP));          // the cells of the line the box takes away
      const groups = roomGroups(P, s2, k);
      const forced = chain.length ? 'the dashed lines' : 'lines';
      if (groups.length === info.room) {
        const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
        const lead = `A box at ${N(info.cell)} would force ${forced}, and then the ${clueName(P, k)} could not fit its boxes: it would still need ${more}, but`;
        if (!groups.length) text = `${lead} no open cell is left on its line.`;
        else if (groups.every((g) => g.length === 1)) text = `${lead} only ${join(groups.map((g) => N(g[0])))} ${groups.length === 1 ? 'is' : 'are'} left open on its line.`;
        else text = `${lead} its open cells fall into only ${plural(groups.length, 'group')}: ${join(groups.map((g) => `{${g.map(N).join(', ')}}`))}. A group holds at most one box (its cells touch, or the cell between two of them would be left with one way out).`;
      } else text = `A box at ${N(info.cell)} would force ${forced}, and then the ${clueName(P, k)} could not fit its boxes: it would still need ${more}, but only ${info.room} fit in what is left of its line.`;
      break;
    }
    case 'closingNeighbor':
      role('focus', info.cell); role('problem', info.neighbor); role('path', info.a, info.b);
      text = `A box at ${N(info.cell)} would leave ${N(info.neighbor)} with only two ways out, ${N(info.a)} and ${N(info.b)}, the ends of one path: using both would close the loop early.`;
      break;
    case 'pairedEnds':
    case 'twoEndsJoin': {
      const [u, v] = info.pair, [fu, fv] = info.far;
      role('range', info.cells); role('focus', ...info.ends); role('path', fu, fv);
      const lead = info.k === 2
        ? `${N(u)} and ${N(v)} are the only open ends in their sealed-off area, so they must join each other, which makes ${N(fu)} and ${N(fv)} the two ends of one path.`
        : `However the ${info.k} open ends of this sealed-off area pair up, ${N(fu)} and ${N(fv)} end up as the two ends of one line.`;
      if (info.kind === 'box') {
        role('focus', info.cell);
        text = `${lead} ${N(info.cell)} has only those two ways out, and using both would close the loop early.`;
      } else if (info.kind === 'third') {
        role('focus', info.cell);
        text = `${lead} ${N(info.cell)} has three ways out; using both of those would close the loop early, so it uses ${N(info.third)}.`;
      } else if (info.kind === 'dot') {
        role('focus', info.cell); role('problem', info.neighbor);
        text = `${lead} A box at ${N(info.cell)} would leave ${N(info.neighbor)} with only those two ways out, closing the loop early.`;
      } else {
        text = `${lead} A line between them would close the loop early.`;
      }
      break;
    }
    case 'sameSegmentExits':
      role('focus', info.cell); role('path', info.a, info.b);
      text = `${N(info.cell)} has three ways out; ${N(info.a)} and ${N(info.b)} lead to the two ends of one path. Using both would close the loop early, so it uses ${N(info.third)}.`;
      break;
    case 'closingCell':
      role('focus', info.cell); role('path', info.a, info.b);
      text = `${N(info.cell)} has only two ways out, ${N(info.a)} and ${N(info.b)}, and both lead to the two ends of one path. Using both would close the loop early, so ${N(info.cell)} is a box.`;
      break;
    case 'noEarlyClose': {
      const [a, b] = edgeCells(P, info.edge); role('path', a, b);
      text = `${N(a)} and ${N(b)} are the two ends of one path. A line between them would close the loop early, so there is none.`;
      break;
    }
    case 'colorBalance': {
      role('range', info.cells);
      const boxes = (a) => (a[0] === a[1] ? `${a[0]}` : `${a[0]} to ${a[1]}`);
      const allBoxes = step.sets.every((x) => x[2] === SHADED), allDots = step.sets.every((x) => x[2] !== SHADED);
      text = `Colour the board like a chessboard: the loop alternates colours, so the boxes leave light and dark cells ${info.diff === 0 ? 'level' : `${Math.abs(info.diff)} apart`}, ${P.regional ? 'and with the numbers that fixes' : 'which fixes'} how many boxes each colour holds (light ${boxes([info.range[0] + info.diff, info.range[1] + info.diff])}, dark ${boxes(info.range)}). That settles the marked cells: ${allBoxes ? (info.cells.length === 1 ? 'it is a box' : 'all are boxes') : allDots ? (info.cells.length === 1 ? 'it is a dot' : 'all are dots') : 'some are boxes, the others dots'}.`;
      break;
    }
    case 'regionPairs': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      text = `In every way to place the boxes of the ${clueName(P, info.clue)} and the ${clueName(P, info.other)} together without touching, ${settled()}.`;
      break;
    }
    case 'cluePlacements': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', info.cells);
      text = `In every way to place the boxes of the ${clueName(P, k)} without touching, ${settled()}.`;
      break;
    }
    case 'placementDeadEnd': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', info.cells);
      text = `In every way to place the boxes of the ${clueName(P, k)} without touching and without leaving a dot just one way out, ${settled()}.`;
      break;
    }
    case 'clueTight': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', P.rays[k]);
      text = info.runs > 1
        ? `The ${clueName(P, k)} needs ${info.need} boxes and has exactly enough room: its open cells form ${info.runs} stretches of odd length, and in each the boxes go on every other cell, starting with the first.`
        : `The ${clueName(P, k)} needs ${info.need} ${info.need === 1 ? 'box' : 'boxes'} and has exactly ${info.cells.length} open cells left in its line, so they go on every other cell, starting at ${N(info.cells[0])}.`;
      break;
    }
    case 'rangeSameOne': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      const cell = N(info.cells[0]);
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} point the same way, so the one cell between them holds ${P.clues[info.clue].n} − ${P.clues[info.other].n} = ${info.count} ${info.count === 1 ? 'box' : 'boxes'}. So ${cell} is ${info.count === 1 ? 'a box' : 'a dot'}.`;
      break;
    }
    case 'rangeSame': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} point the same way, so the cells between them hold ${P.clues[info.clue].n} − ${P.clues[info.other].n} = ${plural(info.count, 'box', 'boxes')}${info.count === 0 ? ': they get dots.' : `. In every way to place them, ${settled()}.`}`;
      break;
    }
    case 'rangeFacingKnown': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      const A = P.clues[info.clue], B = P.clues[info.other];
      const part = { M: 'the cells between them', R: `the cells past ${N(clueCell(P, info.other))}`, L: `the cells past ${N(clueCell(P, info.clue))}` };
      const boxes = (n) => (n === 0 ? 'no boxes' : plural(n, 'box', 'boxes'));
      const rest = ['M', 'R', 'L'].filter((k) => k !== info.known);
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} face each other. ${part[info.known][0].toUpperCase()}${part[info.known].slice(1)} hold ${boxes(info.counts[info.known])}, so ${part[rest[0]]} hold ${boxes(info.counts[rest[0]])} and ${part[rest[1]]} hold ${boxes(info.counts[rest[1]])}. In every way to place those, ${settled()}.`;
      break;
    }
    case 'rangeFacing': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      const [lo, hi] = info.between;
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} point at each other. What fits around them means the cells between hold ${lo === hi ? plural(lo, 'box', 'boxes') : `${lo} to ${hi} boxes`}, so ${settled()}.`;
      break;
    }
    case 'shadeForcesLines':
    case 'shadeClosesLoop':
    case 'shadeShortChain':
    case 'shadeFewLines': {
      role('focus', info.cell); role('problem', info.stranded);
      chain = st ? forcedLines(P, st, info.cell) : [];      // drawn dashed, so the player can follow the box to where it goes wrong
      const closes = rule === 'shadeClosesLoop' || (rule === 'shadeShortChain' && st && cloneStateClosed(P, st, info.cell));
      const proof = st && !closes ? boxProof(P, st, info.cell) : null;
      if (proof && proof.edges.length) {
        chain = proof.edges;                                    // just the lines the contradiction rests on
        const s2 = proof.s2;                                    // (the box and everything it forces)
        const forcedText = `A box at ${N(info.cell)} would force ${plural(chain.length, 'line segment')} (dashed)`;
        if (proof.three) {
          delete roles.problem; role('problem', ...proof.cells);
          text = `${forcedText}, which would give ${proof.cells.map(N).join(' and ')} three lines.`;
        } else {
          const filled = filledNeighbours(P, st, s2, proof.bad);
          if (filled.length) {
            role('problem', ...filled);
            text = `${forcedText}, which would put two lines in ${filled.map(N).join(' and ')}. ${N(proof.bad)} could not join ${filled.length === 1 ? 'it' : 'them'}, so it would ${failureAt(P, s2, proof.bad).replace(/^leave \S+ with /, 'be left with ')}.`;
          } else text = `${forcedText}, and that would ${failureAt(P, s2, proof.bad)}.`;
        }
      } else if (chain.length) {
        const s2 = cloneState(st); s2.cell[info.cell] = SHADED;
        text = `A box at ${N(info.cell)} would force ${plural(chain.length, 'line segment')} (dashed), and that would ${failureAt(P, s2, followLines(P, s2))}.`;
      } else text = `A box at ${N(info.cell)} would force lines ${strandedResult(P, st, info, closes)}.`;
      break;
    }
    case 'uniqueRoute': {
      role('range', info.cells); role('focus', ...info.ends);
      const [a, b] = edgeCells(P, info.edge);
      text = `Some ways to join the open ends here could be drawn two ways over the same cells (two solutions). Without those, ${info.value === E_ON ? 'there is a line' : 'there is no line'} between ${N(a)} and ${N(b)}.`;
      break;
    }
    case 'segmentForcesLines':
    case 'segmentShortChain':
    case 'segmentClosesLoop': {
      const [a, b] = edgeCells(P, info.edge); role('focus', a, b); role('problem', info.stranded);
      if (st) {                                              // the lines the assumption forces that the contradiction needs, drawn dashed so the player can follow them
        const pr = hypothesisProof(P, st, [['e', info.edge, info.assumed === 'off' ? E_OFF : E_ON]]);
        if (pr) chain = pr.edges.filter((x) => x !== info.edge);
        else {
          const s2 = cloneState(st); s2.e[info.edge] = info.assumed === 'off' ? E_OFF : E_ON; followLines(P, s2);
          for (let x = 0; x < P.numEdges; x++) if (s2.e[x] === E_ON && st.e[x] !== E_ON && x !== info.edge) chain.push(x);
        }
      }
      const dashed = chain.length ? ' (dashed)' : '';
      const closes = rule === 'segmentClosesLoop';
      text = info.assumed === 'off'
        ? `If there were no line between ${N(a)} and ${N(b)}, the forced lines${dashed} would ${segmentResult(P, st, info, closes)}. So the loop runs between them.`
        : `A line between ${N(a)} and ${N(b)} would force lines${dashed} that ${segmentResult(P, st, info, closes)}. So there is no line between them.`;
      break;
    }
    case 'parityForces':
    case 'parityPocket': {
      const k = info.ends.length;
      role('path', info.ends); if (info.cells) role('range', info.cells);
      const odd = `${plural(k, 'open end')} (purple), which can't be paired up`;
      if (info.cell !== undefined) {
        role('focus', info.cell);
        text = `A box at ${N(info.cell)} would cut off ${rule === 'parityPocket' ? `a small pocket (${plural(info.area, 'cell')}, tinted)` : 'an area'} with ${odd}. So ${N(info.cell)} is a dot.`;
      } else {
        const [a, b] = edgeCells(P, info.edge); role('focus', a, b);
        text = info.assumed === 'off'
          ? `No line between ${N(a)} and ${N(b)} would cut off an area with ${odd}. So the loop runs between them.`
          : `A line between ${N(a)} and ${N(b)} would cut off an area with ${odd}. So there is no line between them.`;
      }
      break;
    }
    case 'crossingParity': {
      const [r0, c0, r1, c1] = info.rect;
      const cells = [];
      if ((r1 - r0 + 1) * (c1 - c0 + 1) <= 400) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells.push(r * P.cols + c);
      role('range', cells);
      const [a, b] = edgeCells(P, info.edge); role('path', a, b);
      const what = `${colName(c0)}${r0 + 1} to ${colName(c1)}${r1 + 1}`;
      text = `The loop crosses the border of ${what} an even number of times. ${plural(info.crossings, 'crossing')} already drawn, and the line between ${N(a)} and ${N(b)} is the last undecided one: ${info.value === E_ON ? 'there is a line' : 'there is none'}.`;
      break;
    }
    case 'segmentStarvesClue': {
      const [a, b] = edgeCells(P, info.edge); role('focus', a, b);
      const k = info.clue; role('clue', clueCell(P, k)); role('range', P.rays[k]);
      if (st) {
        const s2 = cloneState(st); s2.e[info.edge] = info.assumed === 'off' ? E_OFF : E_ON; followLines(P, s2);
        chain = []; for (let x = 0; x < P.numEdges; x++) if (s2.e[x] === E_ON && st.e[x] !== E_ON && x !== info.edge) chain.push(x);
        role('problem', ...P.rays[k].filter((j) => st.cell[j] === 0 && s2.cell[j] === LOOP));
      }
      const what = info.assumed === 'off' ? `Without a line between ${N(a)} and ${N(b)}, the forced lines` : `A line between ${N(a)} and ${N(b)} would force lines that`;
      const more = plural(info.need, 'more box', 'more boxes');
      text = `${what} ${info.assumed === 'off' ? 'would leave' : 'leave'} the ${clueName(P, k)} without room: it would still need ${more}, but only ${info.room} fit in what is left of its line. So there is ${info.assumed === 'off' ? 'a line' : 'no line'} there.`;
      break;
    }
    case 'dotShortChain':
    case 'dotForcesLines': {
      // info.box: the dot's first consequence was the clue's one other open cell being its last box, so it is told the other way round:
      // a box THERE completes the clue (the cell in question is a dot) and the same chain follows
      const box = info.box;
      role('focus', box !== undefined ? box : info.cell);
      if (!st) { text = box !== undefined ? `A box at ${N(box)} would lead, by easy steps, to a contradiction: it's a dot.` : `A dot at ${N(info.cell)} would lead, by easy steps, to a contradiction: it's a box.`; break; }
      const t = dotTrace(P, st, info.cell);
      const said = [], boxes = [];
      const list = (xs) => (xs.length > 2 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(' and '));
      for (const { rule: r, sets, infos } of t.trace.slice(box !== undefined ? 1 : 0)) {
        if (r === 'clueFull' || r === 'clueTight') {
          for (const f of infos) {
            const sh = [...new Set(f.cells.filter((i) => sets.some(([k, j, v]) => k === 'c' && j === i && v === SHADED)))];
            if (!sh.length || sh.some((i) => boxes.includes(i))) continue;
            boxes.push(...sh);
            said.push(`the ${clueName(P, f.clue)} would need ${sh.length === 1 ? `a box at ${N(sh[0])}` : `boxes at ${list(sh.map(N))}`}`);
          }
        } else if (r === 'deadEnd') {
          const sh = sets.filter(([k, j, v]) => k === 'c' && v === SHADED && !boxes.includes(j)).map(([, j]) => j);
          if (sh.length) { boxes.push(...sh); said.push(`${list(sh.map(N))} would be left with fewer than two ways out, so ${sh.length === 1 ? 'a box' : 'boxes'}`); }
        }
      }
      if (box !== undefined) {
        const k = t.trace[0].infos[0].clue;
        role('clue', clueCell(P, k)); role('range', P.rays[k]);
        said.unshift(`the ${clueName(P, k)} would have all its boxes, so ${N(info.cell)} is a dot`);
      }
      role('problem', ...boxes);
      chain = []; for (let x = 0; x < P.numEdges; x++) if (t.s2.e[x] === E_ON && st.e[x] !== E_ON) chain.push(x);
      const why = brokenAt(P, t.s2);
      if (why.cells) role('problem', ...why.cells);
      if (why.ends) role('path', ...why.ends);
      const lines = chain.length ? 'the lines that follow (dashed)' : '';
      const how = said.length ? `${said.join('; then ')}${lines ? `; with ${lines}` : ''}` : lines ? `it would force ${lines}` : 'a few easy steps follow';
      text = box !== undefined
        ? `Imagine a box at ${N(box)}: ${how}, and then ${why.text}. So ${N(box)} is a dot.`
        : `Imagine a dot at ${N(info.cell)}: ${how}, and then ${why.text}. So ${N(info.cell)} is a box.`;
      break;
    }
    case 'chokepoint':
    case 'chokepointArea': {
      role('range', info.part);
      if (info.cut >= 0) role('problem', info.cut);
      const move = info.cell !== undefined ? `A box at ${N(info.cell)}` : info.assumed === 'off' ? `Without a line between ${edgeName(info.edge)}` : `A line between ${edgeName(info.edge)}`;
      if (info.cell !== undefined) role('focus', info.cell); else { const [a, b] = edgeCells(P, info.edge); role('focus', a, b); }
      const area = rule === 'chokepoint' ? `the marked area (${plural(info.part.length, 'cell')})` : `a large area (${plural(info.part.length, 'cell')}, marked)`;
      const result = info.cell !== undefined ? `So ${N(info.cell)} is a dot.` : info.assumed === 'off' ? 'So the line is there.' : 'So there is no line there.';
      text = info.cut >= 0
        ? `${move}, ${area} could only be reached through ${N(info.cut)}. It holds loop cells, and a loop cannot go in and come back out through one cell. ${result}`
        : `${move}, ${area} would be cut off from the rest of the board, yet it holds loop cells. ${result}`;
      if (info.cell !== undefined) text = text.replace(/^A box at (\S+), /, 'With a box at $1, ');
      break;
    }
    case 'imagine':
    case 'imagineLong': {
      // An imagined box or dot, followed by the easy rules until something breaks (js/imagine.js). The chain is told step by step from the pruned facts.
      role('focus', info.cell);
      const box = info.hyp === 'box';
      const verdict = `So ${N(info.cell)} is a ${box ? 'dot' : 'box'}.`;
      if (!st) { text = `${box ? 'A box' : 'A dot'} at ${N(info.cell)} would lead, by easy steps, to a contradiction. ${verdict}`; break; }
      const rp = replayImagine(P, st, info);
      const list = (xs) => (xs.length > 2 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(' and '));
      const said = [], dotted = new Set(), boxed = new Set();
      let saidLines = false;
      chain = info.facts.filter((f) => f.k === 'e' && f.v === E_ON).map((f) => f.i).sort((a, b) => a - b);
      for (const n of new Set(rp.facts.map((f) => f.step))) {
        const fs = rp.facts.filter((f) => f.step === n);
        const rule = fs[0].rule;
        const cellsOf = (v) => [...new Set(fs.filter((f) => f.k === 'c' && f.v === v).map((f) => f.i))];
        const byClue = (v) => { const m = new Map(); for (const f of fs) if (f.k === 'c' && f.v === v && f.clue !== undefined) m.set(f.clue, [...(m.get(f.clue) || []), f.i]); return [...m]; };   // the clue each fact came from
        if (rule === 'shadedNeighbor') {
          const dots = cellsOf(LOOP).filter((i) => !dotted.has(i)); dots.forEach((i) => dotted.add(i));
          if (dots.length) said.push(`${list(dots.map(N))} would be ${dots.length === 1 ? 'a dot' : 'dots'}, since boxes never touch`);
        } else if (rule === 'clueDone') {
          for (const [k, cs] of byClue(LOOP)) {
            cs.forEach((i) => dotted.add(i)); role('clue', clueCell(P, k)); role('range', P.rays[k]);
            said.push(P.clues[k].op !== '!=' ? `the ${clueName(P, k)} would have all ${P.clues[k].op === '<=' ? 'the boxes it allows' : 'its boxes'}, so the rest of its ${P.clues[k].region ? 'region' : 'line'} would be dots` : `the ${clueName(P, k)} could not take a box at ${list([...new Set(cs)].map(N))}`);
          }
        } else if (rule === 'clueFull' || rule === 'clueTight') {
          for (const [k, cs] of byClue(SHADED)) {
            const bs = [...new Set(cs)].filter((i) => !boxed.has(i)); bs.forEach((i) => boxed.add(i));
            role('clue', clueCell(P, k)); role('range', P.rays[k]);
            if (bs.length) said.push(`the ${clueName(P, k)} would need ${bs.length === 1 ? `a box at ${N(bs[0])}` : `boxes at ${list(bs.map(N))}`}`);
          }
        } else if (rule === 'deadEnd') {
          const bs = cellsOf(SHADED).filter((i) => !boxed.has(i)); bs.forEach((i) => boxed.add(i));
          if (bs.length) said.push(`${list(bs.map(N))} would be left with fewer than two ways out, so ${bs.length === 1 ? 'a box' : 'boxes'}`);
        } else if (rule === 'forcedExits' && !saidLines && chain.length) {
          saidLines = true; said.push('the lines that follow (dashed)');       // (said where the first forced line comes in the chain)
        }
      }
      imagined = { shaded: [...boxed].filter((i) => i !== info.cell), loop: [...dotted].filter((i) => i !== info.cell) };      // (hatching is for where it breaks, below)
      let why = brokenAt(P, rp.state);
      if (info.area) {
        const c = chokepointCheck(P, rp.state);
        if (c && !why.cells.length && !why.ends) {
          role('range', c.part); if (c.cut >= 0) role('problem', c.cut);
          why = { text: c.cut >= 0 ? `${N(c.cut)} would be the only way into a part of the board (marked) that holds loop cells, and the loop cannot get in and back out through one cell` : 'a part of the board (marked) would be cut off from the rest of the loop' , cells: [] };
        }
      }
      if (why.cells) role('problem', ...why.cells);
      if (why.ends) role('path', ...why.ends);
      text = `Imagine ${box ? 'a box' : 'a dot'} at ${N(info.cell)}${said.length ? `: ${said.join('; then ')}` : ''}, and then ${why.text}. ${verdict}`;
      break;
    }
    case 'tryCell':
      role('focus', info.cell);
      text = `Trying ${info.assumed === 'shaded' ? 'a box' : 'a dot'} at ${N(info.cell)} leads to a contradiction, so it's ${info.assumed === 'shaded' ? 'a dot' : 'a box'}.`;
      break;
    case 'tryEdge': {
      const [a, b] = edgeCells(P, info.edge); role('path', a, b);
      text = `Trying ${info.assumed === 'on' ? 'a line' : 'no line'} between ${N(a)} and ${N(b)} leads to a contradiction, so there is ${info.assumed === 'on' ? 'none' : 'one'}.`;
      break;
    }
    default:
      text = ruleLabel(rule);
  }

  const targets = { shaded: [], loop: [], segOn: [], segOff: [] };
  for (const [kind, idx, v] of step.sets) {
    if (kind === 'c') (v === SHADED ? targets.shaded : v === LOOP ? targets.loop : []).push(idx);
    else (v === E_ON ? targets.segOn : v === E_OFF ? targets.segOff : []).push(idx);
  }
  const sourceCells = [...new Set(Object.values(roles).flat())];
  return { rule, tier: step.tier, weight: step.weight, label: ruleLabel(rule), text, roles, sourceCells, targets, chain, imagined };
}

/** One line saying what the step does to the board. */
export function describeMarks(t) {
  const parts = [];
  if (t.shaded.length) parts.push(`shade ${plural(t.shaded.length, 'cell')}`);
  if (t.loop.length) parts.push(`mark ${plural(t.loop.length, 'cell')} as loop`);
  if (t.segOn.length) parts.push(`draw ${plural(t.segOn.length, 'line')}`);
  if (t.segOff.length) parts.push(`rule out ${plural(t.segOff.length, 'line')}`);
  return parts.join(', ');
}

export { E_UNKNOWN };
