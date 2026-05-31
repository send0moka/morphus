# Testing Guide

Morphus uses focused Jest tests plus deterministic conversion snapshots to protect the converter and plugin behavior.

## Run Everything

```bash
npm test
```

Use the full suite before merging changes that touch shared mapper behavior, extraction, plugin building, font handling, or packaging.

## Run Focused Tests

```bash
npm test -- --runInBand tests/css-to-figma.test.js
npm test -- --runInBand tests/mapper.test.js
npm test -- --runInBand tests/extractor.test.js
npm test -- --runInBand tests/figma-plugin.test.js
```

Focused tests are faster while iterating and make it easier to isolate failures.

## Snapshot Tests

`tests/landing-page/expected-snapshot.json` is the deterministic baseline for the landing page fixture.

Update it only when the expected output changes:

```bash
npm run snapshot:update
npm test -- --runInBand tests/landing-page.test.js
```

Review the snapshot diff before committing. A large snapshot change should usually be explained in the PR body.

## Converter CLI Checks

The CLI is useful when a test failure needs direct JSON inspection:

```bash
npm run convert -- --input ./tests/landing-page/input.html --output ./out/landing-page.json
```

Compare the generated JSON against the expected snapshot or a reduced fixture before changing mapper logic.

## Suggested Test Scope

- `src/core/extractor.js`: run extractor and landing page tests.
- `src/figma/mapper.js`: run mapper and landing page tests.
- `src/figma/css-to-figma.js`: run CSS-to-Figma and mapper tests.
- `figma-plugin/code.js`: run Figma plugin tests.
- `src/figma/font-resolver.js` or `src/core/web-fonts.js`: run font resolver, web font, and plugin tests.

When a change affects multiple layers, run the full suite.
