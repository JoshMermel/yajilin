// Which step the Hint button shows (pure, no DOM, so it can be tested).
//
// The solver's steps include ones that only RULE OUT a segment ("I11 and J11 are the ends of one path, so no segment joins them").
// The player cannot mark "no segment here", so showing such a step gives them nothing to do, and since their marks cannot change
// it, the hint would show it again and again. So a step whose results are all of that kind is applied silently to the hint's own
// working position and the search goes on, until it reaches a step that tells the player something to mark (a box, a dot, a
// segment). The facts skipped on the way are returned; reliesOn then picks the ones a shown step really needs, so the toast can say so.
import { nextSteps, applySets, RULES } from './rating.js';
import { explainStep } from './explain.js';
import { E_ON, E_UNKNOWN, cloneState } from './logic.js';

/** Does this firing give the player something to mark? A box, a dot or a segment; not only "there is no segment here". */
export const isMarkable = (firing) => firing.sets.some(([kind, , v]) => kind === 'c' || v === E_ON);

export const MAX_SKIPS = 40;       // a safety net: more silent steps in a row than this shows the last one as it is

/**
 * The next step worth showing from the position `st` (changed in place: the solver's bookkeeping and the silent steps are applied to it).
 * Returns null when the solver is stuck, else { res, background }:
 *   res         { rule, tier, weight, firings } as nextSteps returns it, but with only the firings that give something to mark
 *               (if every firing of the cheapest rule is silent, the search has moved on to the next rule)
 *   background  explanations (explainStep results) of the silent steps taken on the way, oldest first
 */
export function nextMarkableStep(P, st) {
  const background = [];
  for (let n = 0; n <= MAX_SKIPS; n++) {
    const res = nextSteps(P, st);
    if (!res) return null;
    const markable = res.firings.filter(isMarkable);
    if (markable.length) return { res: { ...res, firings: markable }, background };
    if (n === MAX_SKIPS) return { res, background };                         // give up skipping: show it as it is
    for (const f of res.firings) background.push(explainStep(P, { rule: res.rule, tier: res.tier, weight: res.weight, sets: f.sets, info: f.info }, st));
    for (const f of res.firings) if (!applySets(st, f.sets)) return null;     // (cannot happen for sound rules; the player's marks may be inconsistent)
  }
  return null;
}

/**
 * Which of the skipped "no segment here" facts does this firing really need? A fact counts when taking it away (its segments back to
 * undecided) makes the rule stop finding the firing. The rest were only passed on the way (the old toast named the last two skipped
 * facts, which mostly had nothing to do with the step shown). `st` is the position nextMarkableStep returned the firing for.
 * Returns the subset of `background`, in order.
 */
export function reliesOn(P, st, rule, firing, background) {
  if (!background.length) return [];
  const find = RULES.find((r) => r.id === rule).find;
  const upto = RULES.findIndex((r) => r.lookahead);
  return background.filter((b) => {
    const edges = b.targets.segOff;
    if (!edges.length) return false;
    const s2 = cloneState(st);
    for (const x of edges) s2.e[x] = E_UNKNOWN;
    const found = new Set();
    for (const f of find(P, s2, { upto })) for (const [kind, idx, v] of f.sets) found.add(`${kind}${idx}:${v}`);
    return !firing.sets.every(([kind, idx, v]) => found.has(`${kind}${idx}:${v}`));
  });
}
