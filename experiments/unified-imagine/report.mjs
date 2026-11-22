import fs from 'node:fs';
const T = ['Beginner', 'Medium', 'Hard', 'Expert'];
for (const M of ['A', 'B']) {
  const rs = []; for (let s = 0; s < 5; s++) rs.push(...JSON.parse(fs.readFileSync(`dry_${M}_${s}.json`)));
  const n = rs.length;
  const trans = {}; let solvedLost = 0, fb = 0, fbP = 0, up = 0, down = 0, same = 0;
  const deltas = [];
  for (const r of rs) {
    const k = `${r.old[0]}->${r.neu[0]}`; trans[k] = (trans[k] || 0) + 1;
    if (r.old[2] && !r.neu[2]) solvedLost++;
    if (r.fallback) { fbP++; fb += r.fallback; }
    const d = r.neu[1] - r.old[1]; deltas.push(d);
    const ti = T.indexOf(r.neu[0]) - T.indexOf(r.old[0]); if (ti > 0) up++; else if (ti < 0) down++; else same++;
  }
  deltas.sort((a, b) => a - b); const pct = (p) => deltas[Math.floor((n - 1) * p)];
  const withFam = rs.filter((r) => r.oldFam > 0).length;
  const im = rs.reduce((a, r) => ({ box: a.box + r.box, dot: a.dot + r.dot, area: a.area + r.area }), { box: 0, dot: 0, area: 0 });
  console.log(`\n=== model ${M}: ${n} puzzles (<=256 cells), ${withFam} use at least one old family rule`);
  console.log('tier transitions', JSON.stringify(trans));
  console.log({ tierUp: up, tierDown: down, tierSame: same, solvedLost, puzzlesWithFallback: fbP, fallbackSteps: fb });
  console.log('score delta new-old: min', pct(0), 'p10', pct(.1), 'median', pct(.5), 'p90', pct(.9), 'max', pct(1), '| mean', (deltas.reduce((a, b) => a + b, 0) / n).toFixed(1));
  console.log('imagine steps used', im);
  const old = rs.filter((r) => r.oldFam > 0), sameScore = rs.filter((r) => r.neu[1] === r.old[1]).length;
  console.log('score unchanged:', sameScore, '/', n);
  // by label group
  const g = {}; for (const r of rs) { const key = r.label.replace(/\.csv$/, '').replace(/-?\d+x\d+$/, ''); (g[key] ||= []).push(r); }
}
