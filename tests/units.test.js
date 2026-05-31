import {
  ALIGN_MAP,
  JUSTIFY_MAP,
  letterSpacingToPx,
  lineHeightToFigma,
  parsePx,
} from '../src/utils/units.js';

test('parses CSS length-like values into pixels', () => {
  expect(parsePx('24px')).toBe(24);
  expect(parsePx('0')).toBe(0);
  expect(parsePx('auto')).toBe(0);
  expect(parsePx('none')).toBe(0);
  expect(parsePx('not-a-length')).toBe(0);
});

test('converts letter spacing from em and px values', () => {
  expect(letterSpacingToPx('0.12em', '20px')).toBe(2.4);
  expect(letterSpacingToPx('1.5px', '20px')).toBe(1.5);
  expect(letterSpacingToPx('normal', '20px')).toBe(0);
});

test('maps line-height values to Figma line height objects', () => {
  expect(lineHeightToFigma('normal', '16px')).toEqual({ unit: 'AUTO' });
  expect(lineHeightToFigma('1.5', '16px')).toEqual({ value: 150, unit: 'PERCENT' });
  expect(lineHeightToFigma('125%', '16px')).toEqual({ value: 125, unit: 'PERCENT' });
  expect(lineHeightToFigma('24px', '16px')).toEqual({ value: 24, unit: 'PIXELS' });
});

test('exposes stable flex alignment lookup values', () => {
  expect(JUSTIFY_MAP).toMatchObject({
    'flex-start': 'MIN',
    center: 'CENTER',
    'flex-end': 'MAX',
    'space-between': 'SPACE_BETWEEN',
  });

  expect(ALIGN_MAP).toMatchObject({
    'flex-start': 'MIN',
    center: 'CENTER',
    'flex-end': 'MAX',
    stretch: 'STRETCH',
    baseline: 'BASELINE',
  });
});
