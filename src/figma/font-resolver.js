/**
 * src/figma/font-resolver.js
 * Resolves CSS font families and weights to Figma font names.
 * Builds a font map for the entire DOM tree before node creation.
 *
 * NOTE: This module runs in Node.js (not inside Figma).
 * It outputs a fontMap that the Figma plugin reads and pre-loads.
 */

import { walk } from '../core/dom-tree.js';
import { WEIGHT_MAP } from '../utils/units.js';

// Known Google Fonts available in Figma + their available styles
const FIGMA_FONT_STYLES = {
  'Playfair Display': ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black',
                        'Thin Italic', 'ExtraLight Italic', 'Light Italic', 'Italic', 'Medium Italic',
                        'SemiBold Italic', 'Bold Italic', 'ExtraBold Italic', 'Black Italic'],
  'DM Sans': ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black',
               'Thin Italic', 'ExtraLight Italic', 'Light Italic', 'Italic', 'Medium Italic',
               'SemiBold Italic', 'Bold Italic', 'ExtraBold Italic', 'Black Italic'],
  'Bebas Neue': ['Regular'],
  Gelica: ['Regular', 'Medium', 'SemiBold', 'Bold'],
  'Neulis Neue': ['Regular', 'Medium', 'Semi Bold', 'Bold'],
  'Inter': ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black',
             'Thin Italic', 'ExtraLight Italic', 'Light Italic', 'Italic', 'Medium Italic',
             'SemiBold Italic', 'Bold Italic', 'ExtraBold Italic', 'Black Italic'],
  Georgia: ['Regular', 'Italic', 'Bold', 'Bold Italic'],
  'Courier New': ['Regular', 'Italic', 'Bold', 'Bold Italic'],
};

/**
 * @param {object} domTree
 * @returns {Promise<FontMap>} Map of "family|weight|italic" → { family, style }
 */
export async function resolveFonts(domTree) {
  const needed = new Set();

  walk(domTree, (node) => {
    const { fontFamily, fontWeight, fontStyle } = node.computed ?? {};
    if (fontFamily) {
      const key = `${fontFamily}|${fontWeight ?? '400'}|${fontStyle ?? 'normal'}`;
      needed.add(key);
    }

    for (const run of node.textRuns ?? []) {
      const runFamily = run.computed?.fontFamily;
      if (!runFamily) continue;
      const key = `${runFamily}|${run.computed?.fontWeight ?? '400'}|${run.computed?.fontStyle ?? 'normal'}`;
      needed.add(key);
    }

    for (const pseudo of [node.pseudo?.before, node.pseudo?.after]) {
      const pseudoFamily = pseudo?.computed?.fontFamily;
      if (!pseudoFamily) continue;
      const key = `${pseudoFamily}|${pseudo.computed?.fontWeight ?? '400'}|${pseudo.computed?.fontStyle ?? 'normal'}`;
      needed.add(key);
    }
  });

  const fontMap = {};
  for (const key of needed) {
    const [family, weight, style] = key.split('|');
    const resolved = resolveFont(family, weight, style === 'italic');
    fontMap[key] = resolved;
  }

  return fontMap;
}

/**
 * Strip quotes from CSS font-family string.
 * e.g. "'Playfair Display', serif" → "Playfair Display"
 */
function cleanFamilyName(css) {
  return getFontFamilyStack(css)[0] ?? '';
}

/**
 * Resolve to a specific Figma font, with fallback chain.
 */
function resolveFont(cssFamily, weightStr, isItalic) {
  const stack = getFontFamilyStack(cssFamily);
  const family = cleanFamilyName(cssFamily);
  const weight = parseInt(weightStr) || 400;
  const styleName = WEIGHT_MAP[weight] ?? 'Regular';
  const italicSuffix = isItalic ? ' Italic' : '';
  const targetStyle = styleName === 'Regular' && isItalic ? 'Italic' : `${styleName}${italicSuffix}`;
  const requestedNamedFamily = getRequestedNamedFamily(stack);

  const candidates = [];
  const availableStackFamily = stack.find((name) => FIGMA_FONT_STYLES[name]);
  if (availableStackFamily) {
    candidates.push(availableStackFamily);
  } else if (requestedNamedFamily) {
    candidates.push(requestedNamedFamily);
  } else {
    const generic = getGenericFontFamily(stack);
    if (generic === 'serif') {
      candidates.push('Georgia');
    } else if (generic === 'monospace') {
      candidates.push('Courier New');
    } else {
      candidates.push('Inter');
    }
  }

  if (family && family !== candidates[0] && FIGMA_FONT_STYLES[family]) {
    candidates.push(family);
  }

  if (!candidates.includes('Inter')) {
    candidates.push('Inter');
  }

  for (const candidate of candidates) {
    const styles = FIGMA_FONT_STYLES[candidate];
    if (!styles) {
      return { family: candidate, style: targetStyle };
    }
    const matchedStyle = findMatchingStyle(styles, targetStyle);
    if (matchedStyle) {
      return { family: candidate, style: matchedStyle };
    }
    if (styles.includes('Regular')) {
      return { family: candidate, style: 'Regular' };
    }
  }

  return { family: 'Inter', style: 'Regular' };
}

function getFontFamilyStack(cssFamily) {
  return String(cssFamily || '')
    .split(',')
    .map((part) => part.trim().replace(/['"]/g, ''))
    .filter(Boolean);
}

function findMatchingStyle(styles, targetStyle) {
  const normalizedTarget = normalizeStyleName(targetStyle);
  return styles.find((style) => normalizeStyleName(style) === normalizedTarget) || null;
}

function normalizeStyleName(style) {
  return String(style || '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase();
}

function getGenericFontFamily(stack) {
  if (!Array.isArray(stack) || stack.length === 0) {
    return null;
  }

  const last = stack[stack.length - 1].toLowerCase();
  if (last === 'serif' || last === 'sans-serif' || last === 'monospace') {
    return last;
  }

  return null;
}

function getRequestedNamedFamily(stack) {
  if (!Array.isArray(stack)) {
    return null;
  }

  return stack.find((name) => !isGenericFontFamily(name)) || null;
}

function isGenericFontFamily(name) {
  const normalized = String(name || '').toLowerCase();
  return normalized === 'serif'
    || normalized === 'sans-serif'
    || normalized === 'monospace'
    || normalized === 'cursive'
    || normalized === 'fantasy'
    || normalized === 'system-ui'
    || normalized === 'ui-serif'
    || normalized === 'ui-sans-serif'
    || normalized === 'ui-monospace'
    || normalized === 'ui-rounded';
}

/**
 * @typedef {Record<string, { family: string, style: string }>} FontMap
 */
