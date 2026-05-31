# Fixture Authoring

Fixtures help Morphus reproduce browser rendering and Figma mapping behavior consistently.

## Keep Fixtures Focused

Each fixture should isolate one layout, typography, image, or interaction pattern. Prefer a small page that demonstrates the behavior clearly over a large real website export.

Good fixture targets:

- Flex rows and columns with spacing or auto margins.
- CSS Grid patterns that need mapper coverage.
- Mixed typography runs.
- Web font loading and fallback behavior.
- Images, SVGs, gradients, and background images.
- Table or data layouts with truncation.

## Include Enough CSS

Write the minimum HTML and CSS needed to reproduce the behavior. Inline styles are fine for targeted fixtures, but use a `<style>` block when multiple elements share rules.

Avoid remote dependencies unless the test is explicitly about network assets or web fonts. Local and inline assets make snapshot diffs easier to understand.

## Use Stable Dimensions

Prefer fixed viewport-sized examples when testing mapper output:

```html
<main class="fixture">
  <section class="hero">...</section>
</main>
```

```css
body {
  margin: 0;
  width: 1440px;
}
```

Stable dimensions reduce noise in generated JSON and snapshots.

## Name Elements For Debugging

Use readable class names so generated Figma node names are easy to inspect:

```html
<div class="pricing-card">
  <h2 class="pricing-title">Team</h2>
</div>
```

Avoid generic class names such as `.box` and `.item` when several patterns appear in the same fixture.

## Updating Expected Output

After changing a deterministic fixture intentionally:

```bash
npm run snapshot:update
npm test -- --runInBand tests/landing-page.test.js
```

Review the generated JSON diff and mention the expected visual change in the PR.
