/**
 * src/utils/color.js
 * Color conversion utilities for CSS → Figma RGB (0-1 range).
 */

const NAMED_COLORS = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkgrey: '#a9a9a9',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslate50: '#483d8b',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  grey: '#808080',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgreen: '#90ee90',
  lightgrey: '#d3d3d3',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  red: '#ff0000',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
  transparent: '#00000000',
};

/**
 * Convert hex color to Figma RGBA object.
 * Supports: #rgb, #rgba, #rrggbb, #rrggbbaa
 * @param {string} hex - e.g. "#c9a84c" or "#fff"
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
export function hexToFigmaRGB(hex) {
  const clean = hex.replace('#', '');
  if (clean.length === 3 || clean.length === 4) {
    const r = parseInt(clean[0] + clean[0], 16) / 255;
    const g = parseInt(clean[1] + clean[1], 16) / 255;
    const b = parseInt(clean[2] + clean[2], 16) / 255;
    const a = clean.length === 4 ? parseInt(clean[3] + clean[3], 16) / 255 : 1;
    return { r, g, b, a };
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  const a = clean.length === 8 ? parseInt(clean.substring(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

/**
 * Convert CSS rgba() string to Figma RGBA.
 * Supports standard commas syntax, modern spaces syntax, and percentages.
 * @param {string} rgba - e.g. "rgba(201, 168, 76, 0.3)" or "rgba(200 255 0 / 0.5)"
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
export function rgbaStringToFigma(rgba) {
  const normalized = rgba.trim().toLowerCase();
  const matches = normalized.match(/[\d.]+%?/g) || [];
  if (matches.length < 3) {
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  const parseComponent = (val, max) => {
    if (val.endsWith('%')) {
      return (parseFloat(val) / 100) * max;
    }
    return parseFloat(val);
  };

  const rVal = parseComponent(matches[0], 255);
  const gVal = parseComponent(matches[1], 255);
  const bVal = parseComponent(matches[2], 255);

  let aVal = 1;
  if (matches.length >= 4) {
    const aPart = matches[3];
    if (aPart.endsWith('%')) {
      aVal = parseFloat(aPart) / 100;
    } else {
      aVal = parseFloat(aPart);
    }
  }

  return {
    r: Math.max(0, Math.min(255, rVal)) / 255,
    g: Math.max(0, Math.min(255, gVal)) / 255,
    b: Math.max(0, Math.min(255, bVal)) / 255,
    a: Math.max(0, Math.min(1, aVal))
  };
}

/**
 * Convert HSL HSL/HSLA color values to RGB.
 */
function hslToRgb(h, s, l) {
  h = h % 360;
  if (h < 0) h += 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else if (h >= 300 && h < 360) {
    r = c; g = 0; b = x;
  }

  return {
    r: r + m,
    g: g + m,
    b: b + m
  };
}

/**
 * Convert HSL/HSLA string to Figma RGBA.
 */
export function hslStringToFigma(hslStr) {
  const normalized = hslStr.trim().toLowerCase();
  const matches = normalized.match(/[\d.]+(?:%|deg)?/g) || [];
  if (matches.length < 3) {
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  const hVal = parseFloat(matches[0]);
  const sVal = parseFloat(matches[1]);
  const lVal = parseFloat(matches[2]);

  let aVal = 1;
  if (matches.length >= 4) {
    const aPart = matches[3];
    if (aPart.endsWith('%')) {
      aVal = parseFloat(aPart) / 100;
    } else {
      aVal = parseFloat(aPart);
    }
  }

  const rgb = hslToRgb(hVal, sVal, lVal);
  return {
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    a: Math.max(0, Math.min(1, aVal))
  };
}

/**
 * Parse any CSS color string → Figma RGBA.
 * Handles: hex, rgba(), rgb(), hsl(), hsla(), named colors
 */
export function cssColorToFigma(color) {
  if (!color) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const clean = color.trim().toLowerCase();
  if (clean === 'transparent' || clean === 'none') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (clean.startsWith('#')) {
    const parsed = hexToFigmaRGB(clean);
    return { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a ?? 1 };
  }
  if (clean.startsWith('rgb')) {
    return rgbaStringToFigma(clean);
  }
  if (clean.startsWith('hsl')) {
    return hslStringToFigma(clean);
  }
  if (NAMED_COLORS[clean]) {
    const hex = NAMED_COLORS[clean];
    if (hex === '#00000000') {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const parsed = hexToFigmaRGB(hex);
    return { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a ?? 1 };
  }
  // Fallback
  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Build a Figma solid paint object.
 */
export function solidPaint(cssColor, opacity = 1) {
  const { r, g, b, a } = cssColorToFigma(cssColor);
  return {
    type: 'SOLID',
    color: { r, g, b },
    opacity: opacity * a,
  };
}
