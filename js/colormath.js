// Color math for the line palettes (js/palettes.js, tools/make_palettes.mjs): sRGB <-> CIE Lab, a color distance, and a simulation of
// how the three kinds of color blindness see a color. Crude on purpose (CIE76 distance, Machado 2009 full-strength matrices): the line
// colors are a convenience, so "far apart in Lab under the simulation" is all the checking they get.

/** '#rrggbb' -> [r, g, b] (0..255). */
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** [r, g, b] (0..255, clipped) -> '#rrggbb'. */
export const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

const toLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB.
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const CVD_KINDS = Object.keys(CVD);

const D65 = [0.95047, 1, 1.08883];
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const finv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) * 27 / 24389);

const linToLab = ([r, g, b]) => {
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b, y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b;
  const fx = f(x / D65[0]), fy = f(y / D65[1]), fz = f(z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const labToLin = ([L, a, b]) => {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const x = D65[0] * finv(fx), y = D65[1] * finv(fy), z = D65[2] * finv(fz);
  return [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.9692660 * x + 1.8760108 * y + 0.0415560 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
};

/** CIE Lab of a color as `kind` sees it: undefined/'normal' for ordinary vision, or 'protan' | 'deutan' | 'tritan'. */
export function labOf(hex, kind) {
  let lin = hexToRgb(hex).map(toLinear);
  const m = CVD[kind];
  if (m) lin = m.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]).map((v) => Math.max(0, Math.min(1, v)));
  return linToLab(lin);
}

/** How different two colors look: the distance between their Lab values (about 2.3 is a just noticeable difference; 20+ is easy). */
export function distance(a, b, kind) {
  const p = labOf(a, kind), q = labOf(b, kind);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Lightness (0..100) and chroma of a color. */
export const lightness = (hex) => labOf(hex)[0];
export const chroma = (hex) => { const [, a, b] = labOf(hex); return Math.hypot(a, b); };

/** The Lab color (L, chroma, hue in radians) as '#rrggbb'; a color outside the sRGB gamut keeps its lightness and hue and loses chroma. */
export function lchToHex(L, C, h) {
  const inGamut = (c) => labToLin([L, c * Math.cos(h), c * Math.sin(h)]).every((v) => v >= -0.0005 && v <= 1.0005);
  let lo = 0, hi = C;
  if (inGamut(C)) lo = C;
  else for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(mid)) lo = mid; else hi = mid; }
  return rgbToHex(labToLin([L, lo * Math.cos(h), lo * Math.sin(h)]).map(fromLinear));
}

/**
 * A light-theme line color made for the dark board: same hue, lightness lifted into 58..82 (the darkest color becomes the darkest of
 * the lifted ones, so colors that differ in lightness still do). Used for custom palettes; the presets list their own dark colors.
 */
export function darkVariant(hex) {
  const [L, a, b] = labOf(hex);
  const lifted = Math.max(58, Math.min(82, 58 + (L - 25) * (24 / 55)));
  return lchToHex(lifted, Math.hypot(a, b), Math.atan2(b, a));
}

/** The smallest distance between any two colors of a list, as `kind` sees them (Infinity for fewer than two colors). */
export function minDistance(colors, kind) {
  let best = Infinity;
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) best = Math.min(best, distance(colors[i], colors[j], kind));
  return best;
}
