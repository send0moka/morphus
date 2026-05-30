import {
  parseGradientLayers,
  shouldTruncateText,
  splitCssLayers,
} from '../src/figma/css-to-figma.js';

test('splits CSS image layers without breaking nested gradient commas', () => {
  const layers = splitCssLayers(
    'linear-gradient(90deg, rgba(0, 0, 0, 0.5), transparent), url("data:image/svg+xml,%3Csvg%2Cfoo"), radial-gradient(circle at 25% 75%, #ff0000 0%, #0000ff 100%)'
  );

  expect(layers).toEqual([
    'linear-gradient(90deg, rgba(0, 0, 0, 0.5), transparent)',
    'url("data:image/svg+xml,%3Csvg%2Cfoo")',
    'radial-gradient(circle at 25% 75%, #ff0000 0%, #0000ff 100%)',
  ]);
});

test('maps radial gradients with transparent stops to Figma radial paints', () => {
  const [paint] = parseGradientLayers(
    'radial-gradient(circle at 25% 75%, #ff0000 0%, transparent 100%)',
    { width: 200, height: 100 }
  );

  expect(paint.type).toBe('GRADIENT_RADIAL');
  expect(paint.gradientStops).toEqual([
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
    { position: 1, color: { r: 1, g: 0, b: 0, a: 0 } },
  ]);
});

test('requires ellipsis, single-line text, and clipping before truncating text', () => {
  const text = {
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    overflow: 'visible',
    overflowX: 'visible',
  };
  const parent = {
    overflow: 'hidden',
    overflowX: 'hidden',
  };

  expect(shouldTruncateText(text, parent)).toBe(true);
  expect(shouldTruncateText({ ...text, whiteSpace: 'normal' }, parent)).toBe(false);
  expect(shouldTruncateText({ ...text, textOverflow: 'clip' }, parent)).toBe(false);
});
