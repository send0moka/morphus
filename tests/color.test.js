import {
  cssColorToFigma,
  hexToFigmaRGB,
  rgbaStringToFigma,
  solidPaint,
} from '../src/utils/color.js';

test('parses short and alpha hex colors into normalized Figma RGBA', () => {
  expect(hexToFigmaRGB('#0f08')).toEqual({
    r: 0,
    g: 1,
    b: 0,
    a: 0x88 / 255,
  });

  expect(hexToFigmaRGB('#336699cc')).toEqual({
    r: 0x33 / 255,
    g: 0x66 / 255,
    b: 0x99 / 255,
    a: 0xcc / 255,
  });
});

test('parses modern rgb syntax with percentage alpha', () => {
  const color = rgbaStringToFigma('rgb(100% 50% 0% / 25%)');

  expect(color.r).toBe(1);
  expect(color.g).toBe(0.5);
  expect(color.b).toBe(0);
  expect(color.a).toBe(0.25);
});

test('resolves named colors and transparent values', () => {
  expect(cssColorToFigma('rebeccapurple')).toEqual({
    r: 0x66 / 255,
    g: 0x33 / 255,
    b: 0x99 / 255,
    a: 1,
  });

  expect(cssColorToFigma('transparent')).toEqual({
    r: 0,
    g: 0,
    b: 0,
    a: 0,
  });
});

test('combines color alpha with explicit paint opacity', () => {
  expect(solidPaint('rgba(10, 20, 30, 0.4)', 0.5)).toEqual({
    type: 'SOLID',
    color: {
      r: 10 / 255,
      g: 20 / 255,
      b: 30 / 255,
    },
    opacity: 0.2,
  });
});
