// Builds js/palette_presets.js: the ready-made line palettes for the "Color separate lines" setting.
//
//   node tools/make_palettes.mjs                  write js/palette_presets.js and print how far apart the colors are
//   node tools/make_palettes.mjs --check          only print the report
//   node tools/make_palettes.mjs --cvd=3          how little the default palette cares about color blindness (see SPECS); --only=default
//
// A palette is an ORDERED list: a new line takes the best color nobody uses (js/pathcolors.js), so a player with three lines sees colors
// 1 to 3 and a player with eight sees 1 to 8. The order is therefore what is optimized, not just the set. For an ordering s:
//     score(s) = sum over k = 2..n of  gap(first k colors of s) / k          gap = the smallest distance between two of them
// so the first few prefixes weigh the most (the pair counts 1/2, the first eight together about 60% of the whole). Search: a greedy
// "farthest from all so far" ordering from every possible first color, then the best few are polished (replace any color by any other,
// swap any two positions, until nothing improves).
//
// "Distance" is the CIE Lab distance between two colors as seen by the eyes a palette is made for; a pair is as far apart as in the
// worst of them. Each eye has a factor its distances are multiplied by: a factor above 1 forgives a smaller gap in that eye (the default
// palette is for everybody, so for a color-blind eye a gap a third as big as the ordinary one is accepted: factor 3):
//   default   everybody: ordinary vision at factor 1, the three kinds of color blindness at --cvd (default 3)
//   redgreen  deuteranopia and protanopia
//   tritan    tritanopia
// Each palette is made twice: for the white board and for the dark board (lighter colors).
import { writeFileSync } from 'node:fs';
import { rgbToHex, labOf, lightness, chroma, minDistance } from '../js/colormath.js';

const arg = (name, fallback) => { const a = process.argv.find((s) => s.startsWith(`--${name}=`)); return a ? +a.split('=')[1] : fallback; };
const CVD = arg('cvd', 3);
const SIZES = { default: 24, redgreen: 16, tritan: 16 };
// Lightness bands (Lab L, 0 black .. 100 white) for a thin line on the white / dark board: a narrow band, so that colors differ mostly in
// hue (easy to see on a thin line) and not in how dark they are (a maroon next to a brown-red). Chroma: greys are the boxes, dots and clue
// cells, so a line color must look like a color; and not a screaming one.
const band = (name, fallback) => { const a = process.argv.find((s) => s.startsWith(`--${name}=`)); return a ? a.split('=')[1].split(',').map(Number) : fallback; };
const NARROW = { light: band('lightL', [40, 68]), dark: band('darkL', [62, 84]), chroma: band('chroma', [38, 72]) };
// the color-blindness palettes lean on lightness differences, so they get the wider band
const WIDE = { light: [30, 72], dark: [58, 88], chroma: [30, 72] };
const STEP = 12;                          // the grid of candidate colors (sRGB steps)
const POLISH = 12;                        // how many of the best greedy orderings get polished

const SPECS = [
  { id: 'default', name: 'Default', bands: NARROW, eyes: [['normal', 1], ['deutan', CVD], ['protan', CVD], ['tritan', CVD]], report: ['normal'],
    desc: 'Colors that stay clearly apart however many lines you have, easy to tell apart for most eyes' },
  { id: 'redgreen', name: 'Red-green color blindness', bands: WIDE, eyes: [['deutan', 1], ['protan', 1]],
    desc: 'For deuteranopia and protanopia: colors that differ in blue-yellow and in lightness, never in red-green alone' },
  { id: 'tritan', name: 'Blue-yellow color blindness', bands: WIDE, eyes: [['tritan', 1]],
    desc: 'For tritanopia: reds, greens and lightness steps, avoiding blue against green and yellow against pink' },
];

function makePool(theme, allEyes, bands) {
  const [lo, hi] = bands[theme], [MIN_CHROMA, MAX_CHROMA] = bands.chroma;
  const eyes = allEyes.filter(([, scale]) => scale > 0);   // an eye that counts for nothing is left out
  const hex = [];
  for (let r = 0; r < 256; r += STEP) for (let g = 0; g < 256; g += STEP) for (let b = 0; b < 256; b += STEP) {
    const h = rgbToHex([r, g, b]), L = lightness(h), C = chroma(h);
    if (L >= lo && L <= hi && C >= MIN_CHROMA && C <= MAX_CHROMA) hex.push(h);
  }
  const n = hex.length, labs = eyes.map(([kind]) => hex.map((h) => labOf(h, kind)));
  const D = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let d = Infinity;
    eyes.forEach(([, scale], e) => { const p = labs[e][i], q = labs[e][j]; d = Math.min(d, scale * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); });
    D[i * n + j] = D[j * n + i] = d;
  }
  return { hex, n, D };
}

const score = (pool, seq) => {
  let gap = Infinity, total = 0;
  for (let k = 1; k < seq.length; k++) {
    for (let j = 0; j < k; j++) gap = Math.min(gap, pool.D[seq[j] * pool.n + seq[k]]);
    total += gap / (k + 1);
  }
  return total;
};

function greedy(pool, first, size) {
  const { n, D } = pool, seq = [first], near = Float32Array.from({ length: n }, (_, i) => D[first * n + i]);
  while (seq.length < size) {
    let best = -1;
    for (let i = 0; i < n; i++) if (best < 0 || near[i] > near[best]) best = i;
    seq.push(best);
    for (let i = 0; i < n; i++) near[i] = Math.min(near[i], D[best * n + i]);
  }
  return seq;
}

function polish(pool, seq) {
  let best = score(pool, seq);
  for (let sweep = 0; sweep < 20; sweep++) {
    let improved = false;
    for (let pos = 0; pos < seq.length; pos++) {                  // replace one color by any other
      let keep = seq[pos];
      for (let c = 0; c < pool.n; c++) {
        if (seq.includes(c)) continue;
        seq[pos] = c;
        const v = score(pool, seq);
        if (v > best + 1e-9) { best = v; keep = c; improved = true; }
      }
      seq[pos] = keep;
    }
    for (let i = 0; i < seq.length; i++) for (let j = i + 1; j < seq.length; j++) {   // swap two places
      [seq[i], seq[j]] = [seq[j], seq[i]];
      const v = score(pool, seq);
      if (v > best + 1e-9) { best = v; improved = true; } else [seq[i], seq[j]] = [seq[j], seq[i]];
    }
    if (!improved) break;
  }
  return best;
}

function optimize(spec, theme, size) {
  const pool = makePool(theme, spec.eyes, spec.bands);
  const starts = Array.from({ length: pool.n }, (_, i) => greedy(pool, i, size)).map((seq) => ({ seq, v: score(pool, seq) }));
  starts.sort((a, b) => b.v - a.v);
  let best = null;
  for (const s of starts.slice(0, POLISH)) {
    const v = polish(pool, s.seq);
    if (!best || v > best.v) best = { seq: s.seq, v };
  }
  return best.seq.map((i) => pool.hex[i]);
}

const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const presets = SPECS.filter((s) => !ONLY || s.id === ONLY).map((s) => {
  console.error(`making ${s.id}...`);
  return {
    id: s.id, name: s.name, desc: s.desc, eyes: s.report || s.eyes.map(([k]) => k),
    light: optimize(s, 'light', SIZES[s.id]), dark: optimize(s, 'dark', SIZES[s.id]),
  };
});

// report: the smallest distance among the first k colors, as each kind of eye sees them
const kindsAll = ['normal', 'deutan', 'protan', 'tritan'];
for (const p of presets) {
  console.log(`\n${p.id} (${p.light.length} colors)   smallest gap among the first k colors (light board / dark board); normal, deutan, protan, tritan`);
  for (const k of [2, 3, 4, 5, 6, 8, 10, 12, 16, 24]) {
    if (k > p.light.length) break;
    const row = (cols) => kindsAll.map((kind) => minDistance(cols.slice(0, k), kind).toFixed(0).padStart(3)).join(' ');
    console.log(`  k=${String(k).padStart(2)}   ${row(p.light)}   |   ${row(p.dark)}`);
  }
}
const hue = (h) => { const [, a, b] = labOf(h); return String(Math.round(((Math.atan2(b, a) * 180) / Math.PI + 360) % 360)).padStart(3); };
console.log('\nlight:', presets[0].light.slice(0, 12).join(' '));
console.log('hues: ', presets[0].light.slice(0, 12).map(hue).join('     '));
console.log('dark: ', presets[0].dark.slice(0, 12).join(' '));
console.log('hues: ', presets[0].dark.slice(0, 12).map(hue).join('     '));

if (!process.argv.includes('--check')) {
  const list = (a) => '[' + a.map((c) => `'${c}'`).join(', ') + ']';
  let js = '// GENERATED by tools/make_palettes.mjs (node tools/make_palettes.mjs): do not edit by hand.\n';
  js += '// The ready-made line palettes: `light` for the white board, `dark` for the dark one. Order matters: a new line takes the best unused color.\n';
  js += 'export const PRESETS = [\n';
  for (const p of presets) js += `  {\n    id: '${p.id}', name: ${JSON.stringify(p.name)},\n    eyes: ${JSON.stringify(p.eyes)},   // whose eyes judge how alike two colors look (js/colormath.js labOf kinds)\n    desc: ${JSON.stringify(p.desc)},\n    light: ${list(p.light)},\n    dark: ${list(p.dark)},\n  },\n`;
  js += '];\n';
  writeFileSync(new URL('../js/palette_presets.js', import.meta.url), js);
  console.log('\nwrote js/palette_presets.js');
}
