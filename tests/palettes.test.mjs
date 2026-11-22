import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, rgbToHex, distance, labOf, lightness, chroma, minDistance, darkVariant, isHex } from '../js/colormath.js';
import { PRESETS, CUSTOM, sanitizeCustom, validId, resolvePalette, lightColors, MAX_CUSTOM, eyesOf, alikeMatrix } from '../js/palettes.js';

test('hex and Lab behave', () => {
  assert.deepEqual(hexToRgb('#0072b2'), [0, 114, 178]);
  assert.equal(rgbToHex([0, 114, 178]), '#0072b2');
  assert.ok(Math.abs(lightness('#ffffff') - 100) < 0.1 && Math.abs(lightness('#000000')) < 0.1);
  assert.ok(Math.abs(distance('#ffffff', '#000000') - 100) < 0.2);
  assert.equal(distance('#336699', '#336699'), 0);
  assert.ok(chroma('#808080') < 0.5 && chroma('#ff0000') > 70);
});

test('color-blindness simulation leaves greys alone and merges what each kind confuses', () => {
  for (const kind of ['protan', 'deutan', 'tritan']) assert.ok(distance('#808080', '#808080', kind) === 0 && Math.abs(labOf('#808080', kind)[0] - labOf('#808080')[0]) < 0.5);
  // red and green are far apart normally and close for protan/deutan; blue and green close for tritan
  assert.ok(distance('#cc4400', '#559900') > 50);
  assert.ok(distance('#cc4400', '#559900', 'deutan') < 0.6 * distance('#cc4400', '#559900'));
  assert.ok(distance('#0000ff', '#00aa88', 'tritan') < 0.6 * distance('#0000ff', '#00aa88'));
});

test('darkVariant lightens, keeps the hue and the order of lightness', () => {
  for (const c of ['#0072b2', '#d55e00', '#7a5195', '#8c564b']) {
    const d = darkVariant(c);
    assert.ok(isHex(d));
    assert.ok(lightness(d) >= 56 && lightness(d) > lightness(c));
    const ha = Math.atan2(labOf(c)[2], labOf(c)[1]), hb = Math.atan2(labOf(d)[2], labOf(d)[1]);
    assert.ok(Math.abs(Math.atan2(Math.sin(ha - hb), Math.cos(ha - hb))) < 0.35, `${c} -> ${d} keeps its hue`);
  }
  assert.ok(lightness(darkVariant('#003366')) < lightness(darkVariant('#66aadd')));
});

test('presets: every palette has a dark twin of valid, distinct colors', () => {
  const def = PRESETS.find((p) => p.id === 'default');
  assert.ok(def.light.length >= 24);
  for (const p of PRESETS) {
    assert.equal(p.light.length, p.dark.length, p.id);
    for (const c of [...p.light, ...p.dark]) assert.ok(isHex(c), `${p.id}: ${c}`);
    assert.equal(new Set(p.light).size, p.light.length, `${p.id}: no repeats`);
    assert.equal(new Set(p.dark).size, p.dark.length, `${p.id}: no repeats`);
  }
});

test('the default palette is ordered for a player with few lines: the first colors are the farthest apart, for everybody', () => {
  const def = PRESETS.find((p) => p.id === 'default');
  for (const cols of [def.light, def.dark]) {
    assert.ok(minDistance(cols.slice(0, 3)) >= 60, 'the first three');
    assert.ok(minDistance(cols.slice(0, 6)) >= 40, 'the first six');
    assert.ok(minDistance(cols.slice(0, 8)) >= 30, 'the first eight');
    assert.ok(minDistance(cols) >= 15, 'all of them');
    for (const kind of ['deutan', 'protan', 'tritan']) assert.ok(minDistance(cols.slice(0, 6), kind) >= 12, `the first six, ${kind}`);
    // the gap can only shrink as colors are added, and the order is what keeps it from shrinking early
    const gaps = [3, 4, 5, 6, 8, 12, 16, 24].map((k) => minDistance(cols.slice(0, k)));
    assert.ok(gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + 1e-9));
  }
});

test('presets keep their colors apart for the eyes they are made for (Lab distance: 10 is plain to see, 20 is easy)', () => {
  const eyes = { default: [undefined], redgreen: ['deutan', 'protan'], tritan: ['tritan'] };
  for (const p of PRESETS) {
    for (const kind of eyes[p.id]) {
      for (const [theme, cols] of [['light', p.light], ['dark', p.dark]]) {
        const all = minDistance(cols, kind), first8 = minDistance(cols.slice(0, 8), kind);
        assert.ok(all >= 10, `${p.id} ${theme}, all ${cols.length}, ${kind || 'normal'}: ${all.toFixed(1)}`);
        if (p.id !== 'default') assert.ok(first8 >= 20, `${p.id} ${theme}, first 8, ${kind}: ${first8.toFixed(1)}`);
      }
    }
  }
});

test('custom palettes are cleaned on the way in', () => {
  assert.equal(sanitizeCustom(null), null);
  assert.equal(sanitizeCustom('red'), null);
  assert.equal(sanitizeCustom(['#ff0000']), null);                      // too few
  assert.deepEqual(sanitizeCustom(['#FF0000', 'blue', '#00ff00', 5, '#0000ff']), ['#ff0000', '#00ff00', '#0000ff']);
  assert.equal(sanitizeCustom(Array.from({ length: 50 }, () => '#123456')).length, MAX_CUSTOM);
});

test('palette ids fall back to the default; custom needs a custom palette', () => {
  assert.equal(validId('redgreen', null), 'redgreen');
  assert.equal(validId('nonsense', null), 'default');
  assert.equal(validId(null, null), 'default');
  assert.equal(validId(CUSTOM, null), 'default');
  assert.equal(validId(CUSTOM, ['#111111', '#eeeeee']), CUSTOM);
});

test('resolvePalette: presets by theme, custom lightened for dark', () => {
  const def = PRESETS[0];
  assert.deepEqual(resolvePalette('default', null, 'light'), def.light);
  assert.deepEqual(resolvePalette('default', null, 'dark'), def.dark);
  const mine = ['#003366', '#660000'];
  assert.deepEqual(resolvePalette(CUSTOM, mine, 'light'), mine);
  const dark = resolvePalette(CUSTOM, mine, 'dark');
  assert.equal(dark.length, 2);
  assert.ok(dark.every((c, i) => lightness(c) > lightness(mine[i]) + 20));
  assert.deepEqual(lightColors('tritan', null), PRESETS.find((p) => p.id === 'tritan').light);
  assert.deepEqual(lightColors(CUSTOM, mine), mine);
});

test('alikeMatrix: 1 for a color with itself, near 0 for far apart colors, judged by the eyes given', () => {
  const cols = ['#0072b2', '#d55e00', '#009e73', '#cc4400', '#559900'];
  const m = alikeMatrix(cols, ['normal']);
  assert.ok(cols.every((_, i) => m[i][i] === 1));
  assert.ok(m.every((row, i) => row.every((v, j) => v === m[j][i] && v >= 0 && v <= 1)));
  assert.ok(m[0][1] < 0.1);                                           // blue and orange: not alike
  const dm = alikeMatrix(cols, ['deutan']);
  assert.ok(m[3][4] < 0.05 && dm[3][4] > 0.5);                        // a red and a green: not alike, but alike to a deuteranope
  assert.deepEqual(eyesOf('redgreen'), ['deutan', 'protan']);
  assert.deepEqual(eyesOf('default'), ['normal']);
  assert.deepEqual(eyesOf(CUSTOM), ['normal']);
});
