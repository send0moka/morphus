# Test Fixtures Reference

This document lists all official test fixtures in `tests/fixtures/` and explains
what each one covers.

## Fixture Structure

```
tests/fixtures/
  <name>/
    input.html      # HTML input to the converter
    input.css       # CSS applied alongside the HTML (may be empty)
    expected.json   # Expected Figma node tree (snapshot)
    README.md       # Optional description of what the fixture tests
```

## Running a Fixture

```bash
# Run all fixtures
npm test

# Run a single fixture by name
node --loader ts-node/esm tests/run-fixture.mjs button-basic
```

## Fixture Catalog

| Name | What it tests |
|---|---|
| `button-basic` | Single `<button>` with padding, border-radius, background |
| `card-shadow` | Div with `box-shadow` → Figma drop shadow effect |
| `flex-row` | Horizontal flex container with three children |
| `flex-column` | Vertical flex container with gap |
| `grid-3col` | CSS Grid with three equal columns |
| `text-styles` | Headings h1–h6 with font size and weight |
| `image-embed` | `<img>` with a data-URI source |
| `svg-inline` | Inline `<svg>` path converted to vector node |
| `background-gradient` | `linear-gradient` background → Figma gradient fill |
| `nested-frames` | Four levels of nested divs |
| `opacity-layer` | Element with `opacity: 0.5` |
| `z-index-order` | Three siblings with varying z-index |
| `border-all-sides` | Different border widths on each side |
| `custom-font` | `@font-face` declaration with a woff2 URL |

## Updating a Fixture Snapshot

When you intentionally change converter output:

```bash
UPDATE_SNAPSHOTS=true npm test
```

This re-writes all `expected.json` files. Review the diff before committing.

## Adding a New Fixture

1. Create a directory: `tests/fixtures/<name>/`.
2. Add `input.html` and `input.css`.
3. Run `UPDATE_SNAPSHOTS=true npm test` to generate `expected.json`.
4. Verify the output visually by loading `input.html` in the plugin.
5. Add the fixture to the catalog table above.

## Related Docs

- [Fixture authoring](fixture-authoring.md)
- [Testing guide](testing.md)
- [Benchmarks](benchmarks.md)
