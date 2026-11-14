// Rate every puzzle in a CSV with the human-style solver and print a table.
//
//   node tools/rate_puzzles.mjs [file.csv] [--steps]     (default data/tmp.csv)
//
// With --steps, also print each puzzle's steps (rule and what it touched).
import fs from 'node:fs';
import { compile, parseCsv } from '../js/logic.js';
import { rate, RULE_IDS } from '../js/rating.js';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || root + 'data/tmp.csv';
const showSteps = args.includes('--steps');

const puzzles = parseCsv(fs.readFileSync(file, 'utf8')).map(compile);
const rows = [];
for (const P of puzzles) {
  const t0 = Date.now();
  const r = rate(P);
  rows.push({ name: P.name, site: P.tier, size: `${P.cols}x${P.rows}`, solved: r.solved, tier: r.tier, rules: r.rules, score: r.score, steps: r.steps.length, ms: Date.now() - t0, counts: r.counts, r });
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('name', 16) + pad('site', 8) + pad('size', 6) + pad('solved', 8) + pad('tier', 10) + pad('hardest rule', 18) + pad('score', 7) + pad('steps', 7) + 'ms');
for (const r of rows) console.log(pad(r.name, 16) + pad(r.site || '', 8) + pad(r.size, 6) + pad(r.solved, 8) + pad(r.tier, 10) + pad(r.rules, 18) + pad(r.score, 7) + pad(r.steps, 7) + r.ms);
console.log('\nrule usage (puzzles using the rule / total uses):');
for (const id of RULE_IDS) {
  const using = rows.filter((r) => r.counts[id]);
  if (using.length) console.log('  ' + pad(id, 18) + `${using.length} / ${using.reduce((a, r) => a + r.counts[id], 0)}`);
}
if (showSteps) {
  for (const row of rows) {
    console.log(`\n== ${row.name} (${row.tier}, ${row.score})`);
    row.r.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.rule} ${JSON.stringify(s.info)}`));
  }
}
