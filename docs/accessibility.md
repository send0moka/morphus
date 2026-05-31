# Accessibility Notes

Morphus converts visual HTML/CSS into Figma design assets. This document
explains how accessibility-related attributes are handled and what information
is preserved or lost during conversion.

## What Is Preserved

| HTML/ARIA attribute | Figma representation |
|---|---|
| `alt` on `<img>` | Node name set to the alt text |
| `aria-label` | Node name set to the label value |
| `aria-hidden="true"` | Node renamed with `[hidden]` prefix |
| `title` on SVG | Included in node description |
| Semantic element names (`<nav>`, `<main>`, `<button>`) | Node name set to tag + role |

## What Is Not Preserved

Figma does not have a native accessibility layer, so the following attributes
are dropped during conversion:

- `role` (beyond naming the node)
- `tabindex`
- `aria-describedby`, `aria-labelledby`
- `aria-live`, `aria-atomic`, `aria-relevant`
- `aria-disabled`, `aria-expanded`, `aria-checked`

## Design Recommendations

When exporting from Figma, reviewers should:

1. **Verify alt text**: Ensure image nodes have meaningful names that convey
   the same information as the original `alt` attribute.
2. **Add annotations**: Use Figma's annotation kit to mark interactive elements
   and their expected roles.
3. **Maintain heading hierarchy**: Morphus names heading nodes with their tag
   (e.g. `h1`, `h2`). Designers should preserve the hierarchy in handoff.

## Future Work

- Map `role="button"` to an interactive component variant in Figma.
- Export ARIA metadata as a JSON sidecar so developers can re-apply it.
- Surface `tabindex` order as a numbered annotation overlay.

## Related Docs

- [Image handling](image-handling.md)
- [SVG handling](svg-handling.md)
- [Architecture](architecture.md)
