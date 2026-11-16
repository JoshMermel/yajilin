// Which step the Hint button shows (pure, no DOM, so it can be tested).
//
// The solver's steps include ones that only RULE OUT a segment ("I11 and J11 are the ends of one path, so no segment joins them").
// The player cannot mark "no segment here", so showing such a step gives them nothing to do, and since their marks cannot change
// it, the hint would show it again and again. So a step whose results are all of that kind is applied silently to the hint's own
// working position and the search goes on, until it reaches a step that tells the player something to mark (a box, a dot, a
// segment). The facts skipped on the way are returned, so the toast can say what the step relies on.
import { nextSteps, applySets } from './rating.js';
import { explainStep } from './explain.js';
import { E_ON } from './logic.js';

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
