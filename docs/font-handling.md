# Font Handling

Morphus tries to preserve browser typography while still respecting what Figma can load.

## Extraction

The browser exposes computed font families, weights, styles, sizes, line heights, and letter spacing. The converter records those values in the intermediate snapshot.

## Resolution

`src/figma/font-resolver.js` maps CSS font stacks to Figma font names. It prefers a named family from the stack when that family is available, then falls back to a safe default.

## Local Web Fonts

The local companion can capture and install web fonts for the current user when enabled:

```text
MORPHUS_INSTALL_WEB_FONTS=1
```

Figma may need a reload or restart before it sees a newly installed font.

## Plugin Build

The plugin preloads font names before creating text nodes. If a requested font is unavailable, it falls back and notifies the user so the mismatch is visible.

## Testing

Font changes should usually run:

```bash
npm test -- --runInBand tests/font-resolver.test.js tests/web-fonts.test.js tests/figma-plugin.test.js
```
