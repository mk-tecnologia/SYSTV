import test from 'node:test';
import assert from 'node:assert/strict';
import { TV_PALETTES, getTVPalette } from '../public/tv-palettes.js';

// Luminância relativa sRGB e razão de contraste: WCAG 2.2, SC 1.4.6.
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}

test('seis novas paletas preservam as anteriores e oferecem contraste de texto de pelo menos 7:1', () => {
  assert.equal(TV_PALETTES.length, 12);
  assert.equal(new Set(TV_PALETTES.map(palette => palette.id)).size, 12);
  for (const id of ['classic', 'navy', 'graphite', 'forest', 'plum', 'ivory']) assert.equal(getTVPalette(id).id, id);
  assert.equal(getTVPalette('inexistente').id, 'classic');
  for (const id of ['midnight', 'wine', 'coffee', 'ice', 'sage', 'peach']) {
    const palette = getTVPalette(id);
    assert.equal(palette.id, id);
    for (const key of ['background', 'row', 'text', 'accent', 'badge', 'muted']) assert.match(palette[key], /^#[\da-f]{6}$/i);
    const pairs = [
      ['text', 'background'], ['text', 'row'], ['accent', 'row'],
      ['muted', 'background'],
    ];
    for (const [foreground, background] of pairs) {
      const ratio = contrast(palette[foreground], palette[background]);
      assert.ok(ratio >= 7, `${id}: ${foreground}/${background} = ${ratio.toFixed(2)}:1`);
    }
    assert.ok(contrast('#ffffff', palette.badge) >= 7, `${id}: nome da TV sobre o marcador`);
  }
});


test('todas as paletas mantêm oferta distinta e contraste AA para texto, preço e marcador', () => {
  for (const palette of TV_PALETTES) {
    assert.notEqual(palette.accent.toLowerCase(), palette.text.toLowerCase(), palette.id);
    for (const [foreground, background] of [['text','background'], ['text','row'], ['accent','row'], ['muted','background']]) {
      assert.ok(contrast(palette[foreground], palette[background]) >= 4.5, `${palette.id}: ${foreground}/${background}`);
    }
    assert.ok(contrast('#ffffff', palette.badge) >= 4.5, `${palette.id}: marcador`);
  }
});
