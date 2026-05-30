# Contributing to Morphus

Thanks for taking time to improve Morphus. The project is still young, so small, focused pull requests are the easiest to review and merge.

## Local Setup

```bash
npm install
npx playwright install chromium
npm test
```

Start the converter during plugin development:

```bash
npm run dev:converter
```

Then import `figma-plugin/manifest.json` in Figma as a development plugin.

## Good First Contributions

- Improve README and docs examples.
- Add focused tests for CSS-to-Figma mapping behavior.
- Expand the landing page fixture with real layout cases.
- Improve converter error messages.
- Document unsupported CSS patterns and useful workarounds.

## Pull Request Checklist

- Keep the PR focused on one behavior, doc topic, or bug fix.
- Add or update tests when changing mapper, extractor, or plugin behavior.
- Run `npm test` before requesting review.
- Include screenshots or sample HTML when the change affects Figma output.
- Explain any known limitation or follow-up work in the PR description.

## Snapshot Updates

When a mapper or extractor change intentionally affects the deterministic fixture output, update the snapshot:

```bash
npm run snapshot:update
npm test
```

Review the snapshot diff before committing so accidental layout regressions do not slip in.
