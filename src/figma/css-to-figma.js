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

export function parseGradientLayers(cssBackgroundImage, rect = null) {
  return splitCssLayers(cssBackgroundImage)
    .map((layer) => parseGradientLayer(layer, rect))
    .filter(Boolean);
}

export function parseGradientLayer(cssGradient, rect = null) {
  const source = String(cssGradient || '').trim();
  if (/^linear-gradient\(/i.test(source)) {
    return parseLinearGradient(source);
  }
  if (/^radial-gradient\(/i.test(source)) {
    return parseRadialGradient(source, rect);
  }
  return null;
}

export function parseRadialGradient(cssGradient, rect = null) {
  const geometry = parseRadialGradientGeometry(cssGradient, rect);

  return {
    type: 'GRADIENT_RADIAL',
    gradientTransform: radialGradientTransform(geometry),
    gradientStops: extractGradientStops(cssGradient),
  };
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

  while ((match = stopRegex.exec(css)) !== null) {
    const color = cssColorToFigma(match[1]);
    const position = match[2] ? parseFloat(match[2]) / 100 : null;
    stops.push({
      color,
      position: Number.isFinite(position) ? position : null,
      rawColor: match[1],
    });
  }

  if (stops.length === 0) {
    return fallbackTransparentGradientStops();
  }

  return normalizeTransparentGradientStops(normalizeGradientStopPositions(stops))
    .map((stop) => ({
      color: stop.color,
      position: stop.position,
    }));
}

function normalizeGradientStopPositions(stops) {
  const result = stops.map((stop) => ({ ...stop }));
  const lastIndex = result.length - 1;

  if (result[0].position === null) {
    result[0].position = 0;
  }
  if (result[lastIndex].position === null) {
    result[lastIndex].position = lastIndex === 0 ? result[0].position : 1;
  }

  let index = 0;
  while (index < result.length) {
    if (result[index].position !== null) {
      index++;
      continue;
    }

    const startIndex = index - 1;
    let endIndex = index + 1;
    while (endIndex < result.length && result[endIndex].position === null) {
      endIndex++;
    }

    const startPosition = result[startIndex]?.position ?? 0;
    const endPosition = result[endIndex]?.position ?? 1;
    const gap = endIndex - startIndex;
    for (let fillIndex = index; fillIndex < endIndex; fillIndex++) {
      const step = fillIndex - startIndex;
      result[fillIndex].position = startPosition + ((endPosition - startPosition) * step) / gap;
    }

    index = endIndex;
  }

  let previous = 0;
  for (let stopIndex = 0; stopIndex < result.length; stopIndex++) {
    const position = Number.isFinite(result[stopIndex].position) ? result[stopIndex].position : previous;
    previous = Math.max(previous, Math.min(Math.max(position, 0), 1));
    result[stopIndex].position = previous;
  }

  return result;
}

function normalizeTransparentGradientStops(stops) {
  return stops.map((stop, index) => {
    if ((stop.color?.a ?? 1) > 0) {
      return stop;
    }

    const neighboringColor = findNeighboringOpaqueStopColor(stops, index);
    if (!neighboringColor) {
      return stop;
    }

    return {
      ...stop,
      color: {
        r: neighboringColor.r,
        g: neighboringColor.g,
        b: neighboringColor.b,
        a: 0,
      },
    };
  });
}

function findNeighboringOpaqueStopColor(stops, index) {
  for (let before = index - 1; before >= 0; before--) {
    if ((stops[before].color?.a ?? 1) > 0) {
      return stops[before].color;
    }
  }
  for (let after = index + 1; after < stops.length; after++) {
    if ((stops[after].color?.a ?? 1) > 0) {
      return stops[after].color;
    }
  }
  return null;
}

function fallbackTransparentGradientStops() {
  return [
    { color: { r: 0, g: 0, b: 0, a: 0 }, position: 0 },
    { color: { r: 0, g: 0, b: 0, a: 0 }, position: 1 },
  ];
}

function parseRadialGradientGeometry(cssGradient, rect = null) {
  const args = getGradientArguments(cssGradient);
  const prelude = getRadialGradientPrelude(args);
  const atParts = splitRadialPreludeAt(prelude);
  const shape = /\bcircle\b/i.test(atParts.size) ? 'circle' : 'ellipse';
  const size = atParts.size
    .replace(/\b(circle|ellipse)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const center = parseRadialPosition(atParts.position, rect);
  const radii = parseRadialRadii(size, shape, center, rect);

  return {
    center,
    radiusX: Math.max(radii.radiusX, 0.0001),
    radiusY: Math.max(radii.radiusY, 0.0001),
  };
}

function getGradientArguments(cssGradient) {
  const source = String(cssGradient || '').trim();
  const openIndex = source.indexOf('(');
  const closeIndex = source.lastIndexOf(')');
  if (openIndex === -1 || closeIndex <= openIndex) {
    return [];
  }
  return splitCssLayers(source.slice(openIndex + 1, closeIndex));
}

function getRadialGradientPrelude(args) {
  const first = (args && args[0] ? String(args[0]) : '').trim();
  return isRadialGradientPrelude(first) ? first : '';
}

function isRadialGradientPrelude(value) {
  const source = String(value || '').trim();
  if (!source) {
    return false;
  }
  const lower = source.toLowerCase();
  return /\bat\b/.test(lower)
    || /\b(circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner|contain|cover)\b/.test(lower)
    || /^[\d.]+(?:%|px)?(?:\s+[\d.]+(?:%|px)?)?$/.test(lower);
}

function splitRadialPreludeAt(prelude) {
  const source = String(prelude || '').trim();
  const match = source.match(/\bat\b/i);
  if (!match) {
    return { size: source, position: '' };
  }

  return {
    size: source.slice(0, match.index).trim(),
    position: source.slice(match.index + match[0].length).trim(),
  };
}

function parseRadialPosition(position, rect = null) {
  const source = String(position || '').trim().toLowerCase();
  if (!source) {
    return { x: 0.5, y: 0.5 };
  }

  const tokens = source.split(/\s+/).filter(Boolean);
  if (tokens.length >= 4) {
    return parseFourTokenRadialPosition(tokens, rect);
  }

  let x = null;
  let y = null;
  for (const token of tokens) {
    if (token === 'center') {
      if (x === null) {
        x = 0.5;
      } else if (y === null) {
        y = 0.5;
      }
    } else if (isHorizontalPositionKeyword(token)) {
      x = positionKeywordToValue(token);
    } else if (isVerticalPositionKeyword(token)) {
      y = positionKeywordToValue(token);
    } else if (x === null) {
      x = parsePositionLength(token, rect?.width);
    } else if (y === null) {
      y = parsePositionLength(token, rect?.height);
    }
  }

  return {
    x: clampUnit(x === null ? 0.5 : x),
    y: clampUnit(y === null ? 0.5 : y),
  };
}

function parseFourTokenRadialPosition(tokens, rect = null) {
  let x = 0.5;
  let y = 0.5;
  for (let index = 0; index < tokens.length - 1; index += 2) {
    const edge = tokens[index];
    const offset = tokens[index + 1];
    if (edge === 'left') {
      x = parsePositionLength(offset, rect?.width);
    } else if (edge === 'right') {
      x = 1 - parsePositionLength(offset, rect?.width);
    } else if (edge === 'top') {
      y = parsePositionLength(offset, rect?.height);
    } else if (edge === 'bottom') {
      y = 1 - parsePositionLength(offset, rect?.height);
    }
  }
  return { x: clampUnit(x), y: clampUnit(y) };
}

function isHorizontalPositionKeyword(token) {
  return token === 'left' || token === 'right';
}

function isVerticalPositionKeyword(token) {
  return token === 'top' || token === 'bottom';
}

function positionKeywordToValue(token) {
  if (token === 'left' || token === 'top') return 0;
  if (token === 'right' || token === 'bottom') return 1;
  return 0.5;
}

function parsePositionLength(token, axisLength) {
  const source = String(token || '').trim();
  if (source.endsWith('%')) {
    return parseFloat(source) / 100;
  }
  if (source.endsWith('px') && axisLength > 0) {
    return parsePx(source) / axisLength;
  }
  const value = parseFloat(source);
  return Number.isFinite(value) ? value : 0.5;
}

function parseRadialRadii(size, shape, center, rect = null) {
  const source = String(size || '').trim().toLowerCase();
  const explicit = extractRadialSizeTokens(source);
  if (explicit.length > 0) {
    return parseExplicitRadialRadii(explicit, shape, rect);
  }

  const keyword = source.match(/\b(closest-side|closest-corner|farthest-side|farthest-corner|contain|cover)\b/)?.[1]
    || 'farthest-corner';
  return keywordRadialRadii(keyword, shape, center, rect);
}

function extractRadialSizeTokens(value) {
  return (String(value || '').match(/(?:\d*\.)?\d+(?:%|px)?/g) || [])
    .filter((token) => Number.isFinite(parseFloat(token)));
}

function parseExplicitRadialRadii(tokens, shape, rect = null) {
  if (shape === 'circle') {
    if (String(tokens[0]).endsWith('px') && rect?.width > 0 && rect?.height > 0) {
      const px = parsePx(tokens[0]);
      return {
        radiusX: px / rect.width,
        radiusY: px / rect.height,
      };
    }

    const radius = parseRadialRadiusToken(tokens[0], Math.min(rect?.width || 0, rect?.height || 0));
    return { radiusX: radius, radiusY: radius };
  }

  return {
    radiusX: parseRadialRadiusToken(tokens[0], rect?.width),
    radiusY: parseRadialRadiusToken(tokens[1] || tokens[0], rect?.height),
  };
}

function parseRadialRadiusToken(token, axisLength) {
  const source = String(token || '').trim();
  if (source.endsWith('%')) {
    return parseFloat(source) / 100;
  }
  if (source.endsWith('px') && axisLength > 0) {
    return parsePx(source) / axisLength;
  }
  const value = parseFloat(source);
  return Number.isFinite(value) ? value : 0.5;
}

function keywordRadialRadii(keyword, shape, center, rect = null) {
  if (shape === 'circle') {
    const radiusPx = keywordCircleRadius(keyword, center, rect);
    const width = rect?.width || 1;
    const height = rect?.height || 1;
    return {
      radiusX: radiusPx / width,
      radiusY: radiusPx / height,
    };
  }

  const closestX = Math.min(center.x, 1 - center.x);
  const closestY = Math.min(center.y, 1 - center.y);
  const farthestX = Math.max(center.x, 1 - center.x);
  const farthestY = Math.max(center.y, 1 - center.y);

  if (keyword === 'closest-side' || keyword === 'contain') {
    return { radiusX: closestX, radiusY: closestY };
  }
  if (keyword === 'farthest-side') {
    return { radiusX: farthestX, radiusY: farthestY };
  }
  if (keyword === 'closest-corner') {
    return { radiusX: closestX * Math.SQRT2, radiusY: closestY * Math.SQRT2 };
  }
  return { radiusX: farthestX * Math.SQRT2, radiusY: farthestY * Math.SQRT2 };
}

function keywordCircleRadius(keyword, center, rect = null) {
  const width = rect?.width || 1;
  const height = rect?.height || 1;
  const left = center.x * width;
  const right = (1 - center.x) * width;
  const top = center.y * height;
  const bottom = (1 - center.y) * height;

  if (keyword === 'closest-side' || keyword === 'contain') {
    return Math.min(left, right, top, bottom);
  }
  if (keyword === 'farthest-side') {
    return Math.max(left, right, top, bottom);
  }

  const distances = [
    Math.hypot(left, top),
    Math.hypot(right, top),
    Math.hypot(left, bottom),
    Math.hypot(right, bottom),
  ];
  return keyword === 'closest-corner' ? Math.min(...distances) : Math.max(...distances);
}

function radialGradientTransform({ center, radiusX, radiusY }) {
  const centerHandle = { x: center.x, y: center.y };
  const radiusYHandle = { x: center.x, y: center.y + radiusY };
  const radiusXHandle = { x: center.x + radiusX, y: center.y };
  return gradientTransformFromHandles(centerHandle, radiusYHandle, radiusXHandle);
}

function gradientTransformFromHandles(start, end, width) {
  const ux = end.x - start.x;
  const uy = end.y - start.y;
  const vx = width.x - start.x;
  const vy = width.y - start.y;
  const det = ux * vy - vx * uy;

  if (Math.abs(det) < 1e-8) {
    return [
      [1, 0, 0],
      [0, 1, 0],
    ];
  }

  const m00 = vy / det;
  const m01 = -vx / det;
  const m10 = 0.5 * uy / det;
  const m11 = -0.5 * ux / det;
  const tx = -m00 * start.x - m01 * start.y;
  const ty = 0.5 - m10 * start.x - m11 * start.y;

  return [
    [normalizeZero(m00), normalizeZero(m01), normalizeZero(tx)],
    [normalizeZero(m10), normalizeZero(m11), normalizeZero(ty)],
  ];
}

function clampUnit(value) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(value, 1));
}

export function splitCssLayers(css) {
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

  return splitCssLayers(computed.boxShadow)
    .map((layer) => parseShadowEffect(layer, true))
    .filter(Boolean);
}

export function mapTextEffects(computed = {}) {
  return [
    ...mapTextShadow(computed),
    ...mapDropShadowFilter(computed),
  ];
}

export function mapTextShadow(computed = {}) {
  if (!computed.textShadow || computed.textShadow === 'none') return [];

  return splitCssLayers(computed.textShadow)
    .map((layer) => parseShadowEffect(layer, false))
    .filter(Boolean);
}

export function mapDropShadowFilter(computed = {}) {
  const filter = String(computed.filter || '').trim();
  if (!filter || filter === 'none' || !filter.includes('drop-shadow(')) return [];

  const effects = [];
  const regex = /drop-shadow\(([^)]+(?:\)[^)]*)?)\)/gi;
  let match;
  while ((match = regex.exec(filter)) !== null) {
    const effect = parseShadowEffect(match[1], false);
    if (effect) {
      effects.push(effect);
    }
  }
  return effects;
}

const CSS_NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black', 'blanchedalmond',
  'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue',
  'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey',
  'darkkhaki', 'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslate50', 'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia',
  'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink',
  'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
  'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink',
  'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred',
  'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab',
  'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip',
  'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue',
  'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise',
  'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen', 'transparent'
]);

function parseShadowEffect(value, allowSpread) {
  const source = String(value || '').trim();

  // 1. Check for functional colors or hex colors
  const fnOrHexRegex = /(?:rgba?|hsla?|hwb|oklab|oklch|color)\([^)]+\)|#[0-9a-fA-F]{3,8}/gi;
  const fnOrHexMatches = source.match(fnOrHexRegex) || [];
  let colorStr = fnOrHexMatches[0];

  let withoutColor = source;
  if (colorStr) {
    withoutColor = source.replace(colorStr, ' ');
  } else {
    // 2. Check for named colors
    const words = source.match(/\b[a-zA-Z-]+\b/g) || [];
    for (const word of words) {
      const lowerWord = word.toLowerCase();
      if (CSS_NAMED_COLORS.has(lowerWord) && lowerWord !== 'inset') {
        colorStr = word;
        withoutColor = source.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
        break;
      }
    }
  }

  if (!colorStr) return null;

  // Clean "inset" keyword if present
  const cleaned = withoutColor.replace(/\binset\b/gi, ' ').trim();
  const lengths = cleaned.match(/-?[\d.]+(?:px|em|rem|vh|vw|%)?|0/gi) || [];
  if (lengths.length < 2) return null;

  return {
    type: 'DROP_SHADOW',
    color: shadowColor(colorStr),
    offset: { x: parsePx(lengths[0]), y: parsePx(lengths[1]) },
    radius: parsePx(lengths[2] || '0px'),
    spread: allowSpread ? parsePx(lengths[3] || '0px') : 0,
    visible: true,
    blendMode: 'NORMAL',
  };
}

function shadowColor(colorStr) {
  const color = cssColorToFigma(colorStr);
  return { r: color.r, g: color.g, b: color.b, a: color.a };
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
  const effects = mapTextEffects(computed);

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
      ? [solidPaint('transparent')]
      : [solidPaint(computed.color)],
    ...mapTextDecoration(computed),
    ...(effects.length ? { effects } : {}),
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
