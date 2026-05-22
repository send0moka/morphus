import {
  extractFontFacesFromCss,
  installWebFontsForDom,
  resolveDownloadedFontFormat,
} from '../src/core/web-fonts.js';
import { rmSync } from 'node:fs';

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

test('prefers downloaded font bytes over a wrong CSS format hint', () => {
  expect(resolveDownloadedFontFormat(Buffer.from('wOF2fake'), {
    url: 'https://cdn.example.com/font.ttf',
    contentType: 'application/octet-stream',
    declaredFormat: 'ttf',
  })).toBe('woff2');

  expect(resolveDownloadedFontFormat(Buffer.from('<!doctype html>'), {
    url: 'https://cdn.example.com/font.ttf',
    contentType: 'text/html',
    declaredFormat: 'ttf',
  })).toBe('');
});

test('installs raw ttf when the JS font parser cannot rewrite it', async () => {
  const previousDir = process.env.MORPHUS_WINDOWS_FONT_DIR;
  const previousRegistration = process.env.MORPHUS_SKIP_FONT_REGISTRATION;
  const previousInstall = process.env.MORPHUS_INSTALL_WEB_FONTS;
  const testFontDir = 'out/test-fonts-raw-fallback';
  rmSync(testFontDir, { recursive: true, force: true });
  process.env.MORPHUS_WINDOWS_FONT_DIR = testFontDir;
  process.env.MORPHUS_SKIP_FONT_REGISTRATION = '1';
  process.env.MORPHUS_INSTALL_WEB_FONTS = '1';

  try {
    const buffer = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x00, 0x00]),
      Buffer.from('not-a-complete-ttf'),
    ]);
    const summary = await installWebFontsForDom({
      computed: {
        fontFamily: 'Broken Sans, sans-serif',
        fontWeight: '400',
        fontStyle: 'normal',
      },
      children: [],
    }, {
      faces: [{
        family: 'Broken Sans',
        style: 'normal',
        weight: { min: 400, max: 400 },
        sources: [{ url: 'https://example.com/broken.ttf', format: 'ttf' }],
      }],
      fontResponses: [{
        url: 'https://example.com/broken.ttf',
        buffer,
        contentType: 'font/ttf',
        format: 'ttf',
      }],
    }, { enabled: true });

    expect(summary.errors).toEqual([]);
    expect(summary.installed[0]).toMatchObject({
      family: 'Broken Sans',
      style: 'Regular',
      format: 'ttf',
      rawFallback: true,
    });
  } finally {
    restoreEnv('MORPHUS_WINDOWS_FONT_DIR', previousDir);
    restoreEnv('MORPHUS_SKIP_FONT_REGISTRATION', previousRegistration);
    restoreEnv('MORPHUS_INSTALL_WEB_FONTS', previousInstall);
    rmSync(testFontDir, { recursive: true, force: true });
  }
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
