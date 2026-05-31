# Text Style Generation

Morphus can create reusable Figma local text styles from repeated typography in the generated snapshot.

## Why Generate Styles

Generated styles make imported designs easier to clean up, compare, and refactor inside Figma. They are most useful when multiple text nodes share the same font, size, weight, line height, and fill.

## Naming

When the snapshot has a title, Morphus can use it as the style namespace. Otherwise it falls back to the Morphus namespace.

Example:

```text
Landing Page / Typography / Body / MD / Regular
```

## Reuse Threshold

Repeated typography patterns are better candidates for generated styles than one-off display text. Semantic PDF text roles may still become styles when the role is meaningful.

## Decoration Handling

Text decoration and mixed text runs need special care because applying a local style can reset some Figma text properties. Plugin tests guard the important underline and mixed-run behavior.

## Review Checklist

- Confirm generated text style names are readable.
- Confirm one-off headings do not create excessive style noise.
- Confirm decorations survive style application.
