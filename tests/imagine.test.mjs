import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, initialState, cloneState, cluesFromString, SHADED, LOOP, UNKNOWN } from '../js/logic.js';
import { RULES, nextStep, applySets, contradiction, rate } from '../js/rating.js';
import { run, scan, pruned, bestImagine, easyContradiction, easyContradictionAfter, replayImagine, IMAGINE_COST, MEDIUM_MAX } from '../js/imagine.js';

// positions where the easy rules have nothing more to do (the solver is about to imagine something): the precondition of the incremental machinery
const PUZZLES = [
  compile({ name: 'sfl', rows: 8, cols: 8, clues: cluesFromString('1:5:U:0;2:5:L:1;2:7:D:1;3:0:U:0;3:2:U:0;3:3:U:1;4:0:R:1;5:2:U:1;6:4:D:0;6:5:R:0;7:0:R:0;7:7:L:0') }),
  compile({ name: 'dot', rows: 8, cols: 8, clues: [{ r: 0, c: 0, d: 5, n: 2 }, { r: 0, c: 7, d: 6, n: 0 }, { r: 1, c: 5, d: 6, n: 2 }, { r: 2, c: 1, d: 5, n: 2 }, { r: 5, c: 3, d: 7, n: 0 }] }),
  compile({ name: 'd23', rows: 10, cols: 10, clues: cluesFromString('0:2:R:1;0:7:L:1;2:4:R:1;2:5:D:3;3:2:D:2;3:8:L:2;4:5:L:2;4:7:L:2;5:4:R:2;5:9:D:2;7:6:U:0;8:2:U:3') }),
];

/** every position at which the human solver needs to imagine something, as it solves (up to `max`) */
function stallPositions(P, max = 4) {
  const st = initialState(P), out = [];
  for (let g = 0; g < 400 && out.length < max; g++) {
    const step = nextStep(P, st);
    if (!step) break;
    if (step.rule.startsWith('imagine')) out.push(cloneState(st));
    if (!applySets(st, step.sets)) break;
  }
  return out;
}

const RUN_RULES = RULES.filter((r) => r.free || ['shadedNeighbor', 'clueDone', 'clueFull', 'clueTight', 'deadEnd', 'forcedExits'].includes(r.id));
/** following a hypothesis the slow, obviously right way: the full-board rules and the full easy-contradiction check at every step */
function runReference(P, st, hyp, forbid = null, maxFacts = 80) {
  const s2 = cloneState(st); applySets(s2, hyp);
  const facts = []; let steps = 0;
  for (let g = 0; g < 400; g++) {
    if (easyContradiction(P, s2)) return { ok: true, facts, steps };
    let fired = false;
    for (const r of RUN_RULES) {
      const sets = [];
      for (const f of r.find(P, s2, {})) for (const t of f.sets) {
        if ((t[0] === 'c' ? s2.cell : s2.e)[t[1]] === t[2]) continue;
        if (!r.free && forbid && forbid.has(`${t[0]}${t[1]}:${t[2]}`)) continue;
        sets.push(t);
      }
      if (!sets.length) continue;
      const ok = applySets(s2, sets);
      if (!r.free) { steps++; for (const t of sets) facts.push({ k: t[0], i: t[1], v: t[2], rule: r.id, step: steps }); }
      if (!ok) return { ok: true, facts, steps };
      if (facts.length > maxFacts) return { ok: false, facts, steps };
      fired = true; break;
    }
    if (!fired) return { ok: false, facts, steps };
  }
  return { ok: false, facts, steps };
}
const strip = (facts) => facts.map(({ k, i, v, rule, step }) => ({ k, i, v, rule, step }));

test('the change-local rules and the incremental contradiction check give exactly what the full-board versions give, in the same order', () => {
  let hyps = 0, contradicting = 0;
  for (const P of PUZZLES) for (const st of stallPositions(P)) {
    for (let i = 0; i < P.N; i++) {
      if (st.cell[i] !== UNKNOWN) continue;
      for (const pol of [SHADED, LOOP]) {
        const hyp = [['c', i, pol]];
        const a = run(P, st, hyp), b = runReference(P, st, hyp);
        assert.equal(a.ok, b.ok, `${P.name} ${i} ${pol}`);
        assert.deepEqual(strip(a.facts).map(({ g, ...f }) => f), strip(b.facts), `${P.name} ${i} ${pol}`);
        hyps++; if (a.ok) contradicting++;
      }
    }
  }
  assert.ok(hyps > 200 && contradicting > 10, `${hyps} hypotheses, ${contradicting} contradicting`);
});

test('easyContradictionAfter agrees with easyContradiction after every step of a followed hypothesis', () => {
  let checked = 0;
  for (const P of PUZZLES) for (const st of stallPositions(P, 2)) {
    for (let i = 0; i < P.N; i += 3) {
      if (st.cell[i] !== UNKNOWN) continue;
      for (const pol of [SHADED, LOOP]) {
        const s2 = cloneState(st), hyp = [['c', i, pol]];
        applySets(s2, hyp);
        let pend = hyp;
        for (let g = 0; g < 30; g++) {
          const full = easyContradiction(P, s2);
          assert.equal(easyContradictionAfter(P, s2, pend), full, `${P.name} ${i} ${pol} generation ${g}`);
          checked++;
          if (full) break;
          let fired = false;
          for (const r of RUN_RULES) {
            const sets = [];
            for (const f of r.find(P, s2, {})) for (const t of f.sets) if ((t[0] === 'c' ? s2.cell : s2.e)[t[1]] !== t[2]) sets.push(t);
            if (!sets.length) continue;
            if (!applySets(s2, sets)) { fired = false; break; }
            pend = sets; fired = true; break;
          }
          if (!fired) break;
        }
      }
    }
  }
  assert.ok(checked > 300, `${checked} checks`);
});

test('pruning keeps a contradiction, and every fact of the pruned chain is needed', () => {
  let chains = 0;
  for (const P of PUZZLES) for (const st of stallPositions(P, 2)) {
    for (let i = 0; i < P.N; i += 2) {
      if (st.cell[i] !== UNKNOWN) continue;
      const hyp = [['c', i, SHADED]];
      const pr = pruned(P, st, hyp);
      if (!pr) continue;
      chains++;
      const forbid = new Set(pr.forbid);
      assert.ok(runReference(P, st, hyp, forbid).ok, 'the pruned chain still ends in a contradiction');
      for (const f of pr.facts) {
        const without = new Set([...forbid, `${f.k}${f.i}:${f.v}`]);
        assert.ok(!runReference(P, st, hyp, without).ok, `fact ${f.k}${f.i}:${f.v} is not needed`);
      }
      assert.deepEqual([pr.nE, pr.nB, pr.nD], [pr.facts.filter((f) => f.k === 'e').length, pr.facts.filter((f) => f.k === 'c' && f.v === SHADED).length, pr.facts.filter((f) => f.k === 'c' && f.v === LOOP).length]);
    }
  }
  assert.ok(chains > 5, `${chains} chains`);
});

test('bestImagine finds the cheapest chain: no scanned hypothesis is cheaper, and ties go to the box', () => {
  for (const P of PUZZLES) for (const st of stallPositions(P, 2)) {
    const best = bestImagine(P, st);
    assert.ok(best, P.name);
    assert.equal(best.cost, IMAGINE_COST(best.pr) + (best.area ? 12 : 0));
    // brute force over every easy chain (the area ones only count when there are fewer than eight easy ones)
    const costs = [];
    for (let i = 0; i < P.N; i++) {
      if (st.cell[i] !== UNKNOWN) continue;
      for (const pol of [SHADED, LOOP]) {
        const r = scan(P, st, [['c', i, pol]]);
        if (!r || !r.ok) continue;
        const pr = pruned(P, st, [['c', i, pol]]);
        if (pr) costs.push({ i, pol, cost: IMAGINE_COST(pr), raw: r.facts.length, rawE: r.facts.filter((f) => f.k === 'e').length });
      }
    }
    if (costs.length >= 8) {
      // only the eight shortest by raw length are priced, so the winner is the cheapest of those
      const first = costs.sort((a, b) => a.rawE - b.rawE || a.raw - b.raw || (a.pol === SHADED ? -1 : 1)).slice(0, 8);
      assert.equal(best.cost, Math.min(...first.map((c) => c.cost)), `${P.name}: the cheapest of the eight shortest`);
    }
    // the conclusion is the unique solution's value (soundness is also checked along whole solves in rating.test.mjs)
    const re = replayImagine(P, st, { cell: best.cell, hyp: best.pol === SHADED ? 'box' : 'dot', forbid: best.pr.forbid, area: best.area });
    assert.ok(re.ok, 'the chain can be followed again for the explanation');
  }
});

test('the imagined chain is a step like the others: priced by its length, Medium up to the split, a box or a dot competes on length alone', () => {
  const P = PUZZLES[1];
  const r = rate(P);
  assert.ok(r.solved);
  for (const s of r.steps.filter((q) => q.rule.startsWith('imagine'))) {
    assert.equal(s.tier, s.weight <= MEDIUM_MAX ? 'Medium' : 'Hard');
    assert.equal(s.rule, s.tier === 'Medium' ? 'imagine' : 'imagineLong');
    assert.ok(Number.isInteger(s.weight) && s.weight >= 8);
  }
  // without the imagined chain the superseded rules are not used either: the human rating has no other cell-hypothesis rule left
  const without = rate(P, { without: ['imagine', 'imagineLong'] });
  assert.ok(!without.steps.some((s) => RULES.find((q) => q.id === s.rule).superseded));
  assert.ok(contradiction(P, initialState(P)) === false);
});
