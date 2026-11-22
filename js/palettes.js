// The color palettes for the "Color separate lines" setting: the ready-made ones (js/palette_presets.js, made by tools/make_palettes.mjs)
// and the player's own. A palette is an ordered list of colors; a new line takes the lowest one no line uses (js/pathcolors.js).
import { PRESETS } from './palette_presets.js';
import { isHex, darkVariant, distance } from './colormath.js';

export { PRESETS };
export const CUSTOM = 'custom';
export const DEFAULT_PRESET = 'default';
export const MIN_CUSTOM = 2;
export const MAX_CUSTOM = 32;

/** A saved custom palette (parsed JSON, or anything) as a clean list of '#rrggbb', or null when it is no use. */
export function sanitizeCustom(v) {
  if (!Array.isArray(v)) return null;
  const colors = v.filter(isHex).map((c) => c.toLowerCase()).slice(0, MAX_CUSTOM);
  return colors.length >= MIN_CUSTOM ? colors : null;
}

/** A palette id that is still one we have (a preset, or 'custom' when there is a custom palette), else the default. */
export const validId = (id, custom) => (PRESETS.some((p) => p.id === id) || (id === CUSTOM && custom) ? id : DEFAULT_PRESET);

/** The light-board colors of a palette; `custom` is the player's list (used when id is 'custom'). */
export function lightColors(id, custom) {
  if (id === CUSTOM && custom) return custom;
  return (PRESETS.find((p) => p.id === id) || PRESETS[0]).light;
}

/** The colors to draw with on the given theme ('light' | 'dark'). A custom palette is lightened automatically for the dark board. */
export function resolvePalette(id, custom, theme) {
  if (id === CUSTOM && custom) return theme === 'dark' ? custom.map(darkVariant) : custom;
  const p = PRESETS.find((q) => q.id === id) || PRESETS[0];
  return theme === 'dark' ? p.dark : p.light;
}

/** Whose eyes a palette is judged with: the kinds of vision (js/colormath.js) its colors were spread out for. Custom palettes: ordinary. */
export const eyesOf = (id) => (PRESETS.find((p) => p.id === id) || { eyes: ['normal'] }).eyes;

const ALIKE_RANGE = 35;   // colors this far apart (Lab distance) or more are not alike at all

/**
 * How much the colors of a palette look like each other, as a matrix: 1 on the diagonal, falling to 0 at ALIKE_RANGE apart; the gap is
 * the smallest over `eyes`, so a red-green palette is judged as a red-green color-blind person sees it.
 */
export function alikeMatrix(colors, eyes) {
  return colors.map((a, i) => colors.map((b, j) => {
    if (i === j) return 1;
    const gap = Math.min(...eyes.map((k) => distance(a, b, k)));
    return Math.max(0, 1 - gap / ALIKE_RANGE) ** 2;
  }));
}
