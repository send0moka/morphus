# Contributing to Morphus

Thanks for taking time to improve Morphus. The project is still young, so small,
focused pull requests are the easiest to review and merge.

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

## Documentation

All docs live in the [`docs/`](docs/) folder and are catalogued in
[`docs/INDEX.md`](docs/INDEX.md). Before opening a PR please check:

- The topic is not already covered by an existing doc.
- Your doc is linked from the index under the appropriate section.
- Related docs cross-link to each other in a `## Related Docs` section.

## Good First Contributions

- Improve README and docs examples.
- Add focused tests for CSS-to-Figma mapping behavior.
- Expand the landing page fixture with real layout cases.
- Improve converter error messages.
- Document unsupported CSS patterns and useful workarounds.
- Translate the plugin UI to a new locale (see [i18n notes](docs/i18n.md)).

## Pull Request Checklist

- Keep the PR focused on one behavior, doc topic, or bug fix.
- Add or update tests when changing mapper, extractor, or plugin behavior.
- Follow the [code style guide](docs/code-style.md).
- Run `npm test` and `npm run lint` before requesting review.
- Include screenshots or sample HTML when the change affects Figma output.
- Explain any known limitation or follow-up work in the PR description.
- Use [Conventional Commits](docs/changelog-conventions.md) for the commit
  message.

## Snapshot Updates

When a mapper or extractor change intentionally affects the deterministic
fixture output, update the snapshot:

```bash
npm run snapshot:update
npm test
```

Review the snapshot diff before committing so accidental layout regressions do
not slip in.

## Useful References

- [Architecture](docs/architecture.md)
- [Data flow](docs/data-flow.md)
- [Debugging tips](docs/debugging.md)
- [Error handling](docs/error-handling.md)
- [Testing guide](docs/testing.md)
