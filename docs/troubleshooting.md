# Troubleshooting

This guide covers the most common Morphus setup, converter, and Figma plugin problems.

## Converter Is Not Reachable

Symptoms:

- The plugin says the local converter is unavailable.
- `http://localhost:3210/health` does not open in a browser.
- Conversion never starts after clicking `Convert & Build`.

Checks:

1. Start the converter from source:

   ```bash
   npm run dev:converter
   ```

2. Open the health endpoint:

   ```text
   http://localhost:3210/health
   ```

3. If another process owns the port, stop that process or set a different `MORPHUS_PORT` for the converter and plugin config.

## Figma Manifest Network Error

Symptoms:

- Figma rejects the plugin manifest.
- Figma reports an invalid `networkAccess` value.

Checks:

1. Import the plugin from the current `figma-plugin/manifest.json`.
2. Confirm the manifest includes `http://localhost:3210` in `networkAccess.allowedDomains`.
3. Replace old plugin zips that may still reference a public converter URL or older manifest shape.

## Playwright Browser Missing

Symptoms:

- The converter starts, but conversion fails before rendering.
- Terminal output mentions a missing Chromium or browser executable.

Fix:

```bash
npx playwright install chromium
```

For packaged local companion builds, Morphus can use the system browser by default or bundle Chromium when `MORPHUS_BUNDLE_BROWSER=1` is set during build.

## Conversion Hangs Or Times Out

Symptoms:

- The job stays in a running state for too long.
- Slow external images or fonts delay the render.

Checks:

1. Reduce external dependencies in the input HTML.
2. Try the conversion with local or inline assets first.
3. Tune timeouts for heavier pages:

   ```text
   MORPHUS_RENDER_TIMEOUT_MS=120000
   MORPHUS_JOB_TIMEOUT_MS=150000
   MORPHUS_NAVIGATION_TIMEOUT_MS=15000
   MORPHUS_NETWORK_IDLE_TIMEOUT_MS=5000
   ```

## Fonts Do Not Match In Figma

Symptoms:

- Text is converted, but Figma uses a fallback font.
- A freshly installed web font is not available yet.

Checks:

1. Confirm the font license allows local installation.
2. Keep `MORPHUS_INSTALL_WEB_FONTS=1` enabled for local companion usage.
3. Restart or reload Figma after the converter installs a new font.
4. Run the conversion again after Figma sees the installed font.

## Output Looks Structurally Wrong

Symptoms:

- A layout that is correct in the browser becomes awkward in Figma.
- A complex CSS Grid or `clip-path` effect does not map cleanly.

Checks:

1. Compare the browser rendering against the generated JSON.
2. Create a reduced HTML fixture that isolates the layout case.
3. Add or update a mapper test before changing conversion logic.
4. Check [css-figma-mapping.md](css-figma-mapping.md) for known mapping behavior and current gaps.

## Useful Debug Commands

```bash
npm run convert -- --input ./tests/landing-page/input.html --output ./out/landing-page.json
npm test -- --runInBand tests/mapper.test.js
npm test -- --runInBand tests/figma-plugin.test.js
```
