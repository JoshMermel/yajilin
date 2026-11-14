// Turns a step of the human-style solver (see rating.js) into something the Hint button can show:
// a sentence, the cells to look at (each with a role, so the board can colour them differently) and the marks the step makes.
import { SHADED, LOOP, E_ON, E_OFF, E_UNKNOWN, edgeCells } from './logic.js';
import { ruleLabel } from './rating.js';

const ARROWS = ['↑', '→', '↓', '←'];
const cellName = (P, i) => `row ${((i / P.cols) | 0) + 1}, column ${(i % P.cols) + 1}`;
const clueName = (P, k) => `${P.clues[k].n}${ARROWS[P.clues[k].d]} clue at ${cellName(P, P.clues[k].r * P.cols + P.clues[k].c)}`;
const clueCell = (P, k) => P.clues[k].r * P.cols + P.clues[k].c;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Roles a highlighted cell can have (the board gives each its own colour or texture, see style.css). */
export const ROLES = {
  clue: 'the clue',
  range: 'the cells it counts',
  focus: 'the cell being decided',
  problem: 'the neighbour that would be stranded',
  exit: 'its remaining ways out',
  path: 'the ends of a path',
};

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

/**
 * Returns { rule, tier, weight, label, text, roles: {role: [cells]}, sourceCells, targets: { shaded, loop, segOn, segOff } }.
 * `st` is the solver position the step was found in (optional; lets some explanations show ways out).
 */
export function explainStep(P, step, st = null) {
  const { rule, info } = step;
  const roles = {};
  const role = (r, ...cells) => { roles[r] = [...new Set([...(roles[r] || []), ...cells.flat().filter((c) => c !== undefined && c >= 0)])]; };
  let text = '';

  switch (rule) {
    case 'clueDone': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', P.rays[k]);
      text = `The ${clueName(P, k)} already has all ${P.clues[k].n} of its shaded cells, so every other open cell in its line is on the loop.`;
      break;
    }
    case 'clueFull': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', P.rays[k]);
      text = `The ${clueName(P, k)} still needs ${plural(info.cells.length, 'shaded cell')} and has exactly that many open cells left in its line, so all of them are shaded.`;
      break;
    }
    case 'shadedNeighbor':
      role('focus', info.cell);
      text = 'Shaded cells never touch, so the cells next to this shaded cell are on the loop.';
      break;
    case 'deadEnd':
      role('focus', info.cell);
      text = 'This cell has fewer than two ways out (the rest are clue cells, shaded cells, the border or ruled-out segments). A loop cell needs two, so it must be shaded.';
      break;
    case 'forcedExits': {
      role('focus', info.cell);
      if (st) role('exit', waysOut(P, st, info.cell));
      text = info.on >= 1
        ? 'This loop cell already has a line and only one other way out left, so the line continues there.'
        : 'This loop cell has exactly two ways out left, so the loop uses both.';
      break;
    }
    case 'tightCell':
      role('focus', info.cell); role('problem', info.neighbor);
      if (st) role('exit', waysOut(P, st, info.neighbor).filter((j) => j !== info.cell));
      text = `The cell at ${cellName(P, info.neighbor)} (hatched) only has two neighbours it could ever connect to; the board's edge and clue cells block the rest. It is either on the loop, using both of them, or shaded, which makes both of them loop. Either way this cell is on the loop.`;
      break;
    case 'deadEndNeighbor':
      role('focus', info.cell); role('problem', info.neighbor);
      if (st) role('exit', waysOut(P, st, info.neighbor, info.cell));
      text = `If this cell were shaded, the neighbouring cell at ${cellName(P, info.neighbor)} (hatched) would be left with fewer than two ways out (green outline: what it would have left), and it cannot be shaded instead because it would touch this one. So this cell is on the loop.`;
      break;
    case 'sameSegmentExits':
      role('focus', info.cell); role('path', info.a, info.b); role('exit', info.third);
      text = `This loop cell has three ways out, and two of them (${cellName(P, info.a)} and ${cellName(P, info.b)}, purple) lead to the two ends of the same path. Using both would close the loop too early, so it uses the third.`;
      break;
    case 'closingCell':
      role('focus', info.cell); role('path', info.a, info.b);
      text = `This cell has only two ways out (${cellName(P, info.a)} and ${cellName(P, info.b)}, purple), and both lead to the two ends of the same path. Using both would close the loop too early, so this cell cannot be on the loop: it is a box.`;
      break;
    case 'noEarlyClose': {
      const [a, b] = edgeCells(P, info.edge); role('path', a, b);
      text = 'These two cells (purple) are the ends of the same path. Joining them would close the loop while other loop cells are still outside it, so there is no segment between them (the cross).';
      break;
    }
    case 'cluePlacements': {
      const k = info.clue; role('clue', clueCell(P, k)); role('range', info.cells);
      text = `Try every way to place the shaded cells of the ${clueName(P, k)} without two touching: the marked cells are shaded in all of them, or in none of them.`;
      break;
    }
    case 'rangeSame': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} point the same way, so the cells between them (highlighted) hold ${P.clues[info.clue].n} - ${P.clues[info.other].n} = ${plural(info.count, 'shaded cell')}. Trying every way to place those, the marked cells are shaded in all of them or in none.`;
      break;
    }
    case 'rangeFacing': {
      role('clue', clueCell(P, info.clue), clueCell(P, info.other)); role('range', info.cells);
      const [lo, hi] = info.between;
      text = `The ${clueName(P, info.clue)} and the ${clueName(P, info.other)} point at each other. What the cells between them and the cells past each end can hold means the cells between them contain ${lo === hi ? lo : `${lo} to ${hi}`} shaded; that fixes how many each end needs, and the marked cells follow.`;
      break;
    }
    case 'shadeForcesLines':
      role('focus', info.cell); role('problem', info.stranded);
      text = `If this cell were shaded, the lines that forces would make the cell at ${cellName(P, info.stranded)} (hatched) need three lines or have fewer than two ways out: a line end would have to do two incompatible things. So this cell is on the loop.`;
      break;
    case 'parityForces': {
      const k = info.ends.length;
      role('path', info.ends);
      if (info.cell !== undefined) {
        role('focus', info.cell);
        text = `If this cell were shaded, it would cut off an area with ${plural(k, 'open end')} (purple: cells with one line that still need a second). Inside a cut-off area every strand of the loop joins two open ends, so the number has to be even. So this cell is on the loop.`;
      } else {
        const [a, b] = edgeCells(P, info.edge); role('focus', a, b);
        text = info.assumed === 'off'
          ? `If there were no segment between these two cells, an area would be left with ${plural(k, 'open end')} (purple: cells with one line that still need a second). Inside a cut-off area every strand joins two open ends, so the number has to be even. So there is a segment here.`
          : `If there were a segment between these two cells, an area would be left with ${plural(k, 'open end')} (purple: cells with one line that still need a second). Inside a cut-off area every strand joins two open ends, so the number has to be even. So there is no segment here.`;
      }
      break;
    }
    case 'tryCell':
      role('focus', info.cell);
      text = `Suppose this cell were ${info.assumed}. Following the easier rules from there ends in a contradiction, so it is ${info.assumed === 'shaded' ? 'on the loop' : 'shaded'}.`;
      break;
    case 'tryEdge': {
      const [a, b] = edgeCells(P, info.edge); role('path', a, b);
      text = `Suppose the segment between these two cells were ${info.assumed}. Following the easier rules from there ends in a contradiction, so it is ${info.assumed === 'on' ? 'off' : 'on'}.`;
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
  return { rule, tier: step.tier, weight: step.weight, label: ruleLabel(rule), text, roles, sourceCells, targets };
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
