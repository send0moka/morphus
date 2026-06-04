/**
 * src/utils/units.js
 * Unit conversion helpers for CSS → Figma (always px).
 * Since we use computed styles from Playwright, most values
 * are already resolved to px by the browser. These helpers
 * handle the remaining edge cases.
 */

/**
 * Parse a CSS px string → number.
 * e.g. "24px" → 24, "0" → 0
 */
export function parsePx(value) {
  if (!value || value === 'none' || value === 'auto') return 0;
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

/**
 * Convert CSS letter-spacing (em) to px, given a font size.
 * e.g. "0.12em", fontSize=13 → 1.56
 */
export function letterSpacingToPx(value, fontSize) {
  if (!value || value === 'normal') return 0;
  if (value.endsWith('em')) {
    return parseFloat(value) * parsePx(fontSize);
  }
  return parsePx(value);
}

/**
 * Convert CSS line-height to Figma format.
 * Returns { value: number, unit: "PERCENT" | "PIXELS" | "AUTO" }
 */
export function lineHeightToFigma(value, fontSize) {
  if (!value || value === 'normal') return { unit: 'AUTO' };

  // Unitless (e.g. 1.8) → multiply by 100 for percent
  const n = parseFloat(value);
  if (!isNaN(n) && !value.includes('px') && !value.includes('%')) {
    return { value: Math.round(n * 100), unit: 'PERCENT' };
  }

  if (value.endsWith('%')) {
    return { value: parseFloat(value), unit: 'PERCENT' };
  }

  if (value.endsWith('px')) {
    return { value: n, unit: 'PIXELS' };
  }

  return { unit: 'AUTO' };
}

/**
 * Convert CSS font-weight number → Figma style name.
 */
export const WEIGHT_MAP = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

/**
 * Convert CSS text-align → Figma textAlignHorizontal.
 */
export const TEXT_ALIGN_MAP = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT',
  justify: 'JUSTIFIED',
};

/**
 * Convert CSS text-transform → Figma textCase.
 */
export const TEXT_CASE_MAP = {
  uppercase: 'UPPER',
  lowercase: 'LOWER',
  capitalize: 'TITLE',
  none: 'ORIGINAL',
};

/**
 * Convert CSS justify-content → Figma primaryAxisAlignItems.
 */
export const JUSTIFY_MAP = {
  'flex-start': 'MIN',
  'center': 'CENTER',
  'flex-end': 'MAX',
  'space-between': 'SPACE_BETWEEN',
};

/**
 * Convert CSS align-items → Figma counterAxisAlignItems.
 * Figma's parent counter axis enum does not include STRETCH; CSS stretch is
 * represented by FILL sizing on children that fill the rendered counter axis.
 */
export const ALIGN_MAP = {
  'flex-start': 'MIN',
  'center': 'CENTER',
  'flex-end': 'MAX',
  'stretch': 'MIN',
  'baseline': 'BASELINE',
};
