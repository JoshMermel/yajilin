// Turns a step of the human-style solver (see rating.js) into something the Hint button can show:
// a sentence, the cells to look at (each with a role, so the board can color them differently) and the marks the step makes.
import { SHADED, LOOP, CLUE, E_ON, E_OFF, E_UNKNOWN, edgeCells, colName, cloneState } from './logic.js';
import { ruleLabel, followLines, boxProof, roomGroups } from './rating.js';

const ARROWS = ['↑', '→', '↓', '←', '↗', '↘', '↙', '↖'];
/** A cell's name like a spreadsheet's: column letter, then row number (E3). */
const cellName = (P, i) => `${colName(i % P.cols)}${((i / P.cols) | 0) + 1}`;
const clueName = (P, k) => (P.clues[k].region
  ? `region numbered ${P.clues[k].n} (at ${cellName(P, P.clues[k].r * P.cols + P.clues[k].c)})`            // regional puzzles: the number counts its region
  : `${P.clues[k].n}${ARROWS[P.clues[k].d]} clue at ${cellName(P, P.clues[k].r * P.cols + P.clues[k].c)}`);
const clueCell = (P, k) => P.clues[k].r * P.cols + P.clues[k].c;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Roles a highlighted cell can have (the board gives each its own color or texture, see style.css). */
export const ROLES = {
  clue: 'the clue',
  range: 'the cells it counts',
  focus: 'the cell being decided',
  problem: 'where the box would cause trouble',
  exit: 'its remaining ways out',
  path: 'the ends of a path',
};

/** The cells a loop cell could still connect to, ignoring `ignore` (treated as shaded). Needs the solver position `st`. */
function waysOut(P, st, i, ignore = -1, skipOn = false) {
  const out = [];
  for (let d = 0; d < 4; d++) {
    const x = P.ed[i * 4 + d];
    if (x < 0) continue;
    const j = P.nb[i * 4 + d];
    if (j === ignore || st.e[x] === E_OFF || st.cell[j] === SHADED || (skipOn && st.e[x] === E_ON)) continue;
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
  let text = '', chain = [];

  const N = (i) => cellName(P, i);
  const edgeName = (edge) => { const [a, b] = edgeCells(P, edge); return `${N(a)} and ${N(b)}`; };
  switch (rule) {
    case 'clueDone': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', P.rays[k]);
      const line = P.clues[k].region ? 'region' : 'line';
      text = P.clues[k].n === 0 ? `The ${clueName(P, k)} needs no boxes: its whole ${line} gets dots.` : `The ${clueName(P, k)} has all ${plural(P.clues[k].n, 'box', 'boxes')}: the rest of its ${line} gets dots.`;
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
      if (st) role('exit', waysOut(P, st, info.cell, -1, info.on >= 1));   // with a line already, outline only where it goes next, not where it came from
      text = info.on >= 1
        ? `${N(info.cell)} has a line and one way left to go: the line continues there.`
        : `${N(info.cell)} has only two ways out: it uses both.`;
      break;
    }
    case 'tightCell':
      role('focus', info.cell); role('problem', info.neighbor);
      if (st) role('exit', waysOut(P, st, info.neighbor).filter((j) => j !== info.cell));
      text = `A box at ${N(info.cell)} would leave ${N(info.neighbor)} with just one way out.`;
      break;
    case 'deadEndNeighbor':
      role('focus', info.cell); role('problem', info.neighbor);
      if (st) role('exit', waysOut(P, st, info.neighbor, info.cell));
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
    case 'pairedEnds': {
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
        text = `${lead} A segment between them would close the loop early.`;
      }
      break;
    }
    case 'sameSegmentExits':
      role('focus', info.cell); role('path', info.a, info.b); role('exit', info.third);
      text = `${N(info.cell)} has three ways out; ${N(info.a)} and ${N(info.b)} lead to the two ends of one path. Using both would close the loop early, so it uses ${N(info.third)}.`;
      break;
    case 'closingCell':
      role('focus', info.cell); role('path', info.a, info.b);
      text = `${N(info.cell)} has only two ways out, ${N(info.a)} and ${N(info.b)}, and both lead to the two ends of one path. Using both would close the loop early, so ${N(info.cell)} is a box.`;
      break;
    case 'noEarlyClose': {
      const [a, b] = edgeCells(P, info.edge); role('path', a, b);
      text = `${N(a)} and ${N(b)} are the two ends of one path. A segment between them would close the loop early, so there is none.`;
      break;
    }
    case 'colorBalance': {
      role('range', info.cells);
      const boxes = (a) => (a[0] === a[1] ? `${a[0]}` : `${a[0]} to ${a[1]}`);
      const allBoxes = step.sets.every((x) => x[2] === SHADED), allDots = step.sets.every((x) => x[2] !== SHADED);
      text = `Colour the board like a chessboard: the loop alternates colours, so the boxes leave light and dark cells ${info.diff === 0 ? 'level' : `${Math.abs(info.diff)} apart`}, and with the numbers that fixes how many boxes each colour holds (light ${boxes([info.range[0] + info.diff, info.range[1] + info.diff])}, dark ${boxes(info.range)}). That settles the marked cells: ${allBoxes ? (info.cells.length === 1 ? 'it is a box' : 'all are boxes') : allDots ? (info.cells.length === 1 ? 'it is a dot' : 'all are dots') : 'some are boxes, the others dots'}.`;
      break;
    }
    case 'regionPairs': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      text = `Place the boxes of the ${clueName(P, info.clue)} and the ${clueName(P, info.other)} together, without touching: each marked cell is a box in every placement of the pair, or in none.`;
      break;
    }
    case 'cluePlacements': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', info.cells);
      text = `Place the boxes of the ${clueName(P, k)} without touching: each marked cell is a box in every placement, or in none.`;
      break;
    }
    case 'placementDeadEnd': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', info.cells);
      text = `Place the boxes of the ${clueName(P, k)} without touching, and without stranding a dot (leaving it just one way out): each marked cell is a box in every placement that works, or in none.`;
      break;
    }
    case 'clueTight': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', info.cells);
      text = info.runs > 1
        ? `The ${clueName(P, k)} needs ${info.need} boxes and has exactly enough room, in runs of odd length: in each run the boxes go on every other cell.`
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
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} point the same way, so the cells between them hold ${P.clues[info.clue].n} − ${P.clues[info.other].n} = ${plural(info.count, 'box', 'boxes')}${info.count === 0 ? ': they get dots.' : '. Each marked cell is a box in every way of placing those, or in none.'}`;
      break;
    }
    case 'rangeFacingKnown': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      const A = P.clues[info.clue], B = P.clues[info.other];
      const part = { M: 'the cells between them', R: `the cells past ${N(clueCell(P, info.other))}`, L: `the cells past ${N(clueCell(P, info.clue))}` };
      const boxes = (n) => (n === 0 ? 'no boxes' : plural(n, 'box', 'boxes'));
      const rest = ['M', 'R', 'L'].filter((k) => k !== info.known);
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} face each other. ${part[info.known][0].toUpperCase()}${part[info.known].slice(1)} hold ${boxes(info.counts[info.known])}, so ${part[rest[0]]} hold ${boxes(info.counts[rest[0]])} and ${part[rest[1]]} hold ${boxes(info.counts[rest[1]])}. Placing those settles the marked cells.`;
      break;
    }
    case 'rangeFacing': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      const [lo, hi] = info.between;
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} point at each other. What fits around them means the cells between hold ${lo === hi ? plural(lo, 'box', 'boxes') : `${lo} to ${hi} boxes`}, which settles the marked cells.`;
      break;
    }
    case 'shadeForcesLines':
    case 'shadeClosesLoop':
    case 'shadeShortChain': {
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
      text = `Some ways to join the open ends here could be drawn two ways over the same cells (two solutions). Without those, ${info.value === E_ON ? 'there is a segment' : 'there is no segment'} between ${N(a)} and ${N(b)}.`;
      break;
    }
    case 'segmentForcesLines':
    case 'segmentClosesLoop': {
      const [a, b] = edgeCells(P, info.edge); role('focus', a, b); role('problem', info.stranded);
      text = info.assumed === 'off'
        ? `Without a segment between ${N(a)} and ${N(b)}, the forced lines would ${segmentResult(P, st, info, rule === 'segmentClosesLoop')}.`
        : `A segment between ${N(a)} and ${N(b)} would force lines that ${segmentResult(P, st, info, rule === 'segmentClosesLoop')}.`;
      break;
    }
    case 'parityForces': {
      const k = info.ends.length;
      role('path', info.ends);
      const odd = `${plural(k, 'open end')} (purple), which can't be paired up`;
      if (info.cell !== undefined) {
        role('focus', info.cell);
        text = `A box at ${N(info.cell)} would cut off an area with ${odd}.`;
      } else {
        const [a, b] = edgeCells(P, info.edge); role('focus', a, b);
        text = info.assumed === 'off'
          ? `No segment between ${N(a)} and ${N(b)} would cut off an area with ${odd}.`
          : `A segment between ${N(a)} and ${N(b)} would cut off an area with ${odd}.`;
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
      text = `The loop crosses the border of ${what} an even number of times. ${plural(info.crossings, 'crossing')} already drawn, and the segment between ${N(a)} and ${N(b)} is the last undecided one: ${info.value === E_ON ? 'there is a segment' : 'there is none'}.`;
      break;
    }
    case 'tryCell':
      role('focus', info.cell);
      text = `Trying ${info.assumed === 'shaded' ? 'a box' : 'a dot'} at ${N(info.cell)} leads to a contradiction, so it's ${info.assumed === 'shaded' ? 'a dot' : 'a box'}.`;
      break;
    case 'tryEdge': {
      const [a, b] = edgeCells(P, info.edge); role('path', a, b);
      text = `Trying ${info.assumed === 'on' ? 'a segment' : 'no segment'} between ${N(a)} and ${N(b)} leads to a contradiction, so there is ${info.assumed === 'on' ? 'none' : 'one'}.`;
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
  return { rule, tier: step.tier, weight: step.weight, label: ruleLabel(rule), text, roles, sourceCells, targets, chain };
}

/** One line saying what the step does to the board. */
export function describeMarks(t) {
  const parts = [];
  if (t.shaded.length) parts.push(`shade ${plural(t.shaded.length, 'cell')}`);
  if (t.loop.length) parts.push(`mark ${plural(t.loop.length, 'cell')} as loop`);
  if (t.segOn.length) parts.push(`draw ${plural(t.segOn.length, 'segment')}`);
  if (t.segOff.length) parts.push(`rule out ${plural(t.segOff.length, 'segment')}`);
  return parts.join(', ');
}

export { E_UNKNOWN };
