import { extractFontFacesFromCss } from '../src/core/web-fonts.js';

test('parses @font-face rules with relative and absolute font URLs', () => {
  const faces = extractFontFacesFromCss(`
    /* latin */
    @font-face {
      font-family: 'Brand Sans';
      font-style: italic;
      font-weight: 300 700;
      src:
        local('Brand Sans'),
        url('../fonts/brand-sans.woff2') format('woff2'),
        url("https://cdn.example.com/brand-sans.ttf") format("truetype");
      unicode-range: U+0000-00FF;
    }
  `, 'https://example.com/assets/css/site.css');

  expect(faces).toEqual([
    {
      family: 'Brand Sans',
      style: 'italic',
      weight: { min: 300, max: 700 },
      stretch: '',
      unicodeRange: 'U+0000-00FF',
      sources: [
        {
          url: 'https://example.com/assets/fonts/brand-sans.woff2',
          format: 'woff2',
        },
        {
          url: 'https://cdn.example.com/brand-sans.ttf',
          format: 'ttf',
        },
      ],
    },
  ]);
});
