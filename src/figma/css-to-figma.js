/**
 * src/figma/css-to-figma.js
 * Deterministic CSS property → Figma property mapper.
 * This is the core 1:1 mapping layer.
 *
 * All functions here take CSS computed style values
 * and return Figma Plugin API property objects.
 */

import { cssColorToFigma, solidPaint } from '../utils/color.js';
import {
  parsePx,
  letterSpacingToPx,
  lineHeightToFigma,
  WEIGHT_MAP,
  TEXT_ALIGN_MAP,
  TEXT_CASE_MAP,
  JUSTIFY_MAP,
  ALIGN_MAP,
} from '../utils/units.js';

function isTransparentCssColor(value) {
  if (!value || value === 'transparent' || value === 'none') {
    return true;
  }
  return cssColorToFigma(value).a === 0;
}

function meaningfulTextOverflow(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized && normalized !== 'clip' && normalized !== 'none' ? normalized : '';
}

function overflowClipsInlineContent(computed) {
  if (!computed) {
    return false;
  }

  return ['overflow', 'overflowX'].some((prop) => {
    return isClippingOverflowValue(computed[prop]);
  });
}

function isClippingOverflowValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .some((part) => part === 'hidden' || part === 'clip' || part === 'scroll' || part === 'auto');
}

function isSingleLineWhiteSpace(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('nowrap') || normalized === 'pre';
}

/**
 * CSS ellipsis requires text-overflow, non-wrapping inline text,
 * and clipping on either the text box or the parent cell/container.
 */
export function shouldTruncateText(computed = {}, parentComputed = null) {
  const textOverflow = meaningfulTextOverflow(computed?.textOverflow)
    || meaningfulTextOverflow(parentComputed?.textOverflow);

  if (!textOverflow.includes('ellipsis')) {
    return false;
  }

  if (!isSingleLineWhiteSpace(computed?.whiteSpace) && !isSingleLineWhiteSpace(parentComputed?.whiteSpace)) {
    return false;
  }

  return overflowClipsInlineContent(computed) || overflowClipsInlineContent(parentComputed);
}

// ─── LAYOUT ──────────────────────────────────────────────────────────────────

/**
 * display: flex → Figma Auto Layout
 */
export function mapFlexLayout(computed) {
  const isRow = computed.flexDirection !== 'column' && computed.flexDirection !== 'column-reverse';
  const columnGap = parsePx(computed.columnGap || computed.gap);
  const rowGap = parsePx(computed.rowGap || computed.gap);
  const wraps = computed.flexWrap === 'wrap' || computed.flexWrap === 'wrap-reverse';
  const result = {
    layoutMode: isRow ? 'HORIZONTAL' : 'VERTICAL',
    primaryAxisAlignItems: JUSTIFY_MAP[computed.justifyContent] ?? 'MIN',
    counterAxisAlignItems: ALIGN_MAP[computed.alignItems] ?? 'MIN',
    itemSpacing: isRow ? columnGap : rowGap,
  };

  if (wraps) {
    result.layoutWrap = 'WRAP';
    result.counterAxisSpacing = isRow ? rowGap : columnGap;
  }

  return result;
}

/**
 * padding → Figma frame padding
 */
export function mapPadding(computed) {
  return {
    paddingTop: parsePx(computed.paddingTop),
    paddingRight: parsePx(computed.paddingRight),
    paddingBottom: parsePx(computed.paddingBottom),
    paddingLeft: parsePx(computed.paddingLeft),
  };
}

/**
 * overflow → Figma clipsContent
 */
export function mapOverflow(computed) {
  return {
    clipsContent: isClippingOverflowValue(computed.overflow)
      || isClippingOverflowValue(computed.overflowX)
      || isClippingOverflowValue(computed.overflowY),
  };
}

/**
 * border-radius → Figma cornerRadius
 */
export function mapBorderRadius(computed, rect = { width: 0, height: 0 }) {
  const tl = parseRadiusValue(computed.borderTopLeftRadius, rect);
  const tr = parseRadiusValue(computed.borderTopRightRadius, rect);
  const br = parseRadiusValue(computed.borderBottomRightRadius, rect);
  const bl = parseRadiusValue(computed.borderBottomLeftRadius, rect);

  if (tl === tr && tr === br && br === bl) {
    return { cornerRadius: tl };
  }
  return {
    topLeftRadius: tl,
    topRightRadius: tr,
    bottomRightRadius: br,
    bottomLeftRadius: bl,
  };
}

function parseRadiusValue(value, rect) {
  if (!value || value === 'none' || value === 'auto') return 0;
  if (typeof value === 'string' && value.endsWith('%')) {
    const percent = parseFloat(value);
    if (Number.isFinite(percent)) {
      return (Math.min(rect.width || 0, rect.height || 0) * percent) / 100;
    }
  }
  return parsePx(value);
}

// ─── VISUAL / FILLS ───────────────────────────────────────────────────────────

/**
 * background-color → Figma solid fill
 */
export function mapBackgroundColor(computed) {
  const color = computed.backgroundColor;
  if (isTransparentCssColor(color)) return [];
  return [solidPaint(color)];
}

/**
 * Parse CSS linear-gradient → Figma GRADIENT_LINEAR paint.
 * Handles: linear-gradient(to bottom, ...) and linear-gradient(180deg, ...)
 */
export function parseLinearGradient(cssGradient) {
  const gradientTransform = linearGradientTransform(cssGradient);

  // Extract color stops (simplified — handles rgba and hex)
  const stops = extractGradientStops(cssGradient);

  return {
    type: 'GRADIENT_LINEAR',
    gradientTransform,
    gradientStops: stops,
  };
}

export function parseLinearGradientLayers(cssBackgroundImage) {
  return splitCssLayers(cssBackgroundImage)
    .filter((layer) => /^linear-gradient\(/i.test(layer.trim()))
    .map((layer) => parseLinearGradient(layer));
}

function linearGradientTransform(cssGradient) {
  const angle = parseLinearGradientAngle(cssGradient);
  const rad = ((angle - 90) * Math.PI) / 180;
  const dx = normalizeZero(Math.cos(rad));
  const dy = normalizeZero(Math.sin(rad));

  return [
    [dx, dy, normalizeZero(0.5 - dx / 2 - dy / 2)],
    [normalizeZero(-dy), dx, normalizeZero(0.5 + dy / 2 - dx / 2)],
  ];
}

function normalizeZero(value) {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

function parseLinearGradientAngle(cssGradient) {
  const directionMatch = cssGradient.match(/linear-gradient\(\s*to\s+([a-z\s]+?)(?:,|\))/i);
  if (directionMatch) {
    const direction = directionMatch[1].trim().toLowerCase();
    if (direction === 'right') return 90;
    if (direction === 'left') return 270;
    if (direction === 'bottom') return 180;
    if (direction === 'top') return 0;
    if (direction === 'bottom right' || direction === 'right bottom') return 135;
    if (direction === 'bottom left' || direction === 'left bottom') return 225;
    if (direction === 'top right' || direction === 'right top') return 45;
    if (direction === 'top left' || direction === 'left top') return 315;
  }

  const degMatch = cssGradient.match(/linear-gradient\(\s*(-?[\d.]+)deg/i);
  if (degMatch) {
    const angle = parseFloat(degMatch[1]);
    if (Number.isFinite(angle)) return angle;
  }

  return 180;
}

function extractGradientStops(css) {
  const stopRegex = /(rgba?\([^)]+\)|#[0-9a-f]{3,8}|transparent)\s*([\d.]+%)?/gi;
  const stops = [];
  let match;
  let index = 0;

  while ((match = stopRegex.exec(css)) !== null) {
    const color = cssColorToFigma(match[1]);
    const position = match[2] ? parseFloat(match[2]) / 100 : index === 0 ? 0 : 1;
    stops.push({ color, position });
    index++;
  }

  return stops.length > 0 ? stops : [
    { color: { r: 0, g: 0, b: 0, a: 0 }, position: 0 },
    { color: { r: 0, g: 0, b: 0, a: 0 }, position: 1 },
  ];
}

function splitCssLayers(css) {
  const source = String(css || '');
  const layers = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];

    if (quote) {
      current += char;
      if (char === quote && source[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') {
      depth++;
      current += char;
      continue;
    }

    if (char === ')') {
      depth = Math.max(depth - 1, 0);
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        layers.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    layers.push(current.trim());
  }

  return layers;
}

// ─── BORDERS / STROKES ────────────────────────────────────────────────────────

/**
 * border → Figma strokes
 */
export function mapBorder(computed) {
  const sides = getBorderSides(computed);
  const visibleSides = Object.values(sides).filter((side) => isRenderableBorderSide(side));
  if (visibleSides.length === 0) return {};

  const color = cssColorToFigma(visibleSides[0].color);
  const result = {
    strokes: [{
      type: 'SOLID',
      color: { r: color.r, g: color.g, b: color.b },
      opacity: color.a,
    }],
    strokeWeight: visibleSides[0].width,
    strokeAlign: 'INSIDE', // CSS border-box behavior
  };

  if (!hasUniformBorder(sides)) {
    result.strokeTopWeight = isRenderableBorderSide(sides.top) ? sides.top.width : 0;
    result.strokeRightWeight = isRenderableBorderSide(sides.right) ? sides.right.width : 0;
    result.strokeBottomWeight = isRenderableBorderSide(sides.bottom) ? sides.bottom.width : 0;
    result.strokeLeftWeight = isRenderableBorderSide(sides.left) ? sides.left.width : 0;
  }

  return result;
}

function getBorderSides(computed) {
  return {
    top: getBorderSide(computed, 'Top', 0),
    right: getBorderSide(computed, 'Right', 1),
    bottom: getBorderSide(computed, 'Bottom', 2),
    left: getBorderSide(computed, 'Left', 3),
  };
}

function getBorderSide(computed, sideName, shorthandIndex) {
  const lowerSide = sideName.toLowerCase();
  return {
    width: parsePx(computed[`border${sideName}Width`] ?? getCssBoxValue(computed.borderWidth, shorthandIndex)),
    style: computed[`border${sideName}Style`] ?? getCssBoxValue(computed.borderStyle, shorthandIndex) ?? 'none',
    color: computed[`border${sideName}Color`] ?? getCssBoxValue(computed.borderColor, shorthandIndex) ?? computed.color ?? '#000',
    side: lowerSide,
  };
}

function isRenderableBorderSide(side) {
  return side.width > 0 && side.style !== 'none' && side.style !== 'hidden' && cssColorToFigma(side.color).a > 0;
}

function hasUniformBorder(sides) {
  const values = Object.values(sides);
  const first = values[0];
  return values.every((side) =>
    isRenderableBorderSide(side) &&
    side.width === first.width &&
    side.style === first.style &&
    normalizeCssValue(side.color) === normalizeCssValue(first.color)
  );
}

function getCssBoxValue(value, index) {
  const parts = splitCssWhitespaceList(value);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return index === 0 || index === 2 ? parts[0] : parts[1];
  if (parts.length === 3) return index === 0 ? parts[0] : index === 2 ? parts[2] : parts[1];
  return parts[index] ?? null;
}

function splitCssWhitespaceList(value) {
  const source = String(value || '').trim();
  if (!source) return [];

  const parts = [];
  let current = '';
  let depth = 0;

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(depth - 1, 0);

    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function normalizeCssValue(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

// ─── EFFECTS ─────────────────────────────────────────────────────────────────

/**
 * box-shadow → Figma DROP_SHADOW effect
 * Handles: "0 0 30px 10px rgba(201,168,76,0.3)"
 */
export function mapBoxShadow(computed) {
  if (!computed.boxShadow || computed.boxShadow === 'none') return [];

  const parts = computed.boxShadow.match(
    /(?:(rgba?\([^)]+\)|#[0-9a-f]{3,8})\s+)?(-?[\d.]+px)\s+(-?[\d.]+px)\s+([\d.]+px)\s*([\d.]+px)?(?:\s+(rgba?\([^)]+\)|#[0-9a-f]{3,8}))?/i
  );
  if (!parts) return [];

  const [, leadingColor, x, y, blur, spread = '0px', trailingColor] = parts;
  const colorStr = leadingColor || trailingColor;
  if (!colorStr) return [];
  const color = cssColorToFigma(colorStr);

  return [{
    type: 'DROP_SHADOW',
    color: { r: color.r, g: color.g, b: color.b, a: color.a },
    offset: { x: parsePx(x), y: parsePx(y) },
    radius: parsePx(blur),
    spread: parsePx(spread),
    visible: true,
    blendMode: 'NORMAL',
  }];
}

// ─── TYPOGRAPHY ───────────────────────────────────────────────────────────────

/**
 * CSS text properties → Figma text node properties
 */
export function mapTypography(computed, fontMap = {}, parentComputed = null) {
  const familyRaw = computed.fontFamily?.split(',')[0].replace(/['"]/g, '').trim() ?? 'Inter';
  const weight = computed.fontWeight ?? '400';
  const isItalic = computed.fontStyle === 'italic';
  const fontKey = `${computed.fontFamily}|${weight}|${isItalic ? 'italic' : 'normal'}`;

  const font = fontMap?.[fontKey] ?? { family: familyRaw, style: 'Regular' };
  const fontSize = parsePx(computed.fontSize) || 16;

  const result = {
    fontName: font,
    fontSize,
    lineHeight: lineHeightToFigma(computed.lineHeight, computed.fontSize),
    letterSpacing: {
      value: letterSpacingToPx(computed.letterSpacing, computed.fontSize),
      unit: 'PIXELS',
    },
    textAlignHorizontal: TEXT_ALIGN_MAP[computed.textAlign] ?? 'LEFT',
    textCase: TEXT_CASE_MAP[computed.textTransform] ?? 'ORIGINAL',
    // -webkit-text-stroke → outline text (color: transparent + stroke)
    fills: isTransparentCssColor(computed.color)
      ? []
      : [solidPaint(computed.color)],
    ...mapTextDecoration(computed),
  };

  if (shouldTruncateText(computed, parentComputed)) {
    result.textTruncation = 'ENDING';
  }

  return result;
}

function mapTextDecoration(computed = {}) {
  const line = String(computed.textDecorationLine || computed.textDecoration || '').toLowerCase();
  const hasUnderline = line.includes('underline');
  const hasStrikethrough = line.includes('line-through');
  if (!hasUnderline && !hasStrikethrough) {
    return {};
  }

  const result = {
    textDecoration: hasUnderline ? 'UNDERLINE' : 'STRIKETHROUGH',
  };

  const style = mapTextDecorationStyle(computed.textDecorationStyle || computed.textDecoration);
  if (style) {
    result.textDecorationStyle = style;
  }

  const color = mapTextDecorationColor(computed.textDecorationColor);
  if (color) {
    result.textDecorationColor = color;
  }

  const thickness = mapTextDecorationThickness(computed.textDecorationThickness);
  if (thickness) {
    result.textDecorationThickness = thickness;
  }

  return result;
}

function mapTextDecorationStyle(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('dotted')) return 'DOTTED';
  if (normalized.includes('wavy')) return 'WAVY';
  if (normalized.includes('solid')) return 'SOLID';
  return null;
}

function mapTextDecorationColor(value) {
  if (!value || value === 'currentcolor' || value === 'currentColor') {
    return null;
  }

  const color = cssColorToFigma(value);
  if (color.a === 0) {
    return null;
  }

  return {
    value: {
      type: 'SOLID',
      color: { r: color.r, g: color.g, b: color.b },
      opacity: color.a,
    },
  };
}

function mapTextDecorationThickness(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'auto' || raw === 'from-font') {
    return null;
  }

  if (raw.endsWith('%')) {
    const percent = parseFloat(raw);
    return Number.isFinite(percent) ? { value: percent, unit: 'PERCENT' } : null;
  }

  const px = parsePx(raw);
  return px > 0 ? { value: px, unit: 'PIXELS' } : null;
}

/**
 * Map -webkit-text-stroke to Figma strokes on a text node.
 */
export function mapTextStroke(computed) {
  // CSS doesn't expose webkit-text-stroke in getComputedStyle reliably,
  // but if fill is transparent we know it's outline text
  if (isTransparentCssColor(computed.color) && parsePx(computed.webkitTextStrokeWidth) > 0) {
    const width = parsePx(computed.webkitTextStrokeWidth);
    const color = cssColorToFigma(computed.webkitTextStrokeColor ?? '#000');
    return {
      strokes: [{
        type: 'SOLID',
        color: { r: color.r, g: color.g, b: color.b },
        opacity: color.a,
      }],
      strokeWeight: width,
      strokeAlign: 'OUTSIDE',
    };
  }
  return {};
}

// ─── POSITIONING ─────────────────────────────────────────────────────────────

/**
 * position: absolute → Figma absolute positioning
 */
export function mapPositioning(computed, rect, parentRect) {
  if (computed.position !== 'absolute' && computed.position !== 'fixed') {
    return {};
  }

  return {
    layoutPositioning: 'ABSOLUTE',
    x: rect.x - (parentRect?.x ?? 0),
    y: rect.y - (parentRect?.y ?? 0),
  };
}
