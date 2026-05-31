# Development Workflow

This guide describes the day-to-day loop for changing Morphus locally.

## 1. Install Dependencies

```bash
npm install
npx playwright install chromium
```

Use the same Node.js major version across the team when comparing snapshots or generated packages.

## 2. Run The Converter From Source

```bash
npm run dev:converter
```

The development converter listens on `http://localhost:3210`, matching the Figma plugin manifest. Stop any packaged Morphus Converter process first if it already owns that port.

## 3. Load The Figma Plugin

1. Open Figma.
2. Go to `Plugins > Development > Import plugin from manifest...`.
3. Choose `figma-plugin/manifest.json` from this repo.
4. Reopen the development plugin after changing `figma-plugin/ui.html` or `figma-plugin/code.js`.

## 4. Debug Converter Output

Use the CLI when you want to inspect the generated JSON before opening Figma:

```bash
npm run convert -- --input ./tests/landing-page/input.html --output ./out/landing-page.json
```

This is the fastest way to isolate extractor, font, z-index, and mapper behavior.

## 5. Run Focused Tests

Run the tests closest to the files you changed:

```bash
npm test -- --runInBand tests/mapper.test.js
npm test -- --runInBand tests/figma-plugin.test.js
npm test -- --runInBand tests/extractor.test.js
```

Use the full suite before merging broad mapper, extractor, or plugin changes:

```bash
npm test
```

## 6. Update Snapshots Intentionally

Only update deterministic snapshots when the rendered output is expected to change:

```bash
npm run snapshot:update
npm test
```

Review the snapshot diff before committing so accidental layout changes are visible in the PR.
