// Slow, obviously-correct yajilin solver for tiny boards, used only to cross-check js/logic.js.
// Enumerates every set of shaded cells, then counts Hamiltonian cycles through the remaining non-clue cells.
import { DR, DC } from '../js/logic.js';

/** Number of solutions of a compiled puzzle (rows*cols must be small, <= ~20). */
export function referenceCount(P) {
  const { rows, cols, N } = P;
  const free = [];
  for (let i = 0; i < N; i++) if (P.clueAt[i] < 0) free.push(i);
  let total = 0;
  for (let mask = 0; mask < (1 << free.length); mask++) {
    const shaded = new Uint8Array(N);
    free.forEach((i, k) => { if (mask >> k & 1) shaded[i] = 1; });
    if (!validShading(P, shaded)) continue;
    const loop = free.filter((i) => !shaded[i]);
    total += countHamiltonianCycles(rows, cols, loop);
  }
  return total;
}

function validShading(P, shaded) {
  const { rows, cols, N } = P;
  for (let i = 0; i < N; i++) {
    if (!shaded[i]) continue;
    const r = (i / cols) | 0, c = i % cols;
    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d], nc = c + DC[d];
      if (nr >= 0 && nc >= 0 && nr < rows && nc < cols && shaded[nr * cols + nc]) return false;
    }
  }
  for (let k = 0; k < P.clues.length; k++) {
    let s = 0;
    for (const i of P.rays[k]) s += shaded[i];
    if (s !== P.clues[k].n) return false;
  }
  return true;
}

function countHamiltonianCycles(rows, cols, cells) {
  if (cells.length < 4) return 0;
  const inSet = new Set(cells);
  const start = cells[0];
  const seen = new Set([start]);
  let directed = 0;
  const adj = (i) => {
    const r = (i / cols) | 0, c = i % cols, out = [];
    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d], nc = c + DC[d];
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const j = nr * cols + nc;
      if (inSet.has(j)) out.push(j);
    }
    return out;
  };
  const dfs = (i) => {
    for (const j of adj(i)) {
      if (j === start && seen.size === cells.length) directed++;
      else if (!seen.has(j)) { seen.add(j); dfs(j); seen.delete(j); }
    }
  };
  dfs(start);
  return directed / 2;
}
