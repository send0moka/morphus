# Grid Layout Mapping

Morphus converts CSS Grid containers and their children into Figma Auto Layout
frames with best-effort column/row alignment.

## Supported Grid Properties

| CSS property | Support | Figma translation |
|---|---|---|
| `display: grid` | ✅ | Frame with Auto Layout enabled |
| `grid-template-columns` | Partial | Column count inferred; fixed sizes used |
| `grid-template-rows` | Partial | Row count inferred; fixed sizes used |
| `gap` / `column-gap` / `row-gap` | ✅ | Item spacing in Auto Layout |
| `grid-column-start` / `grid-column-end` | ❌ | Ignored; item placed in flow order |
| `grid-area` named areas | ❌ | Not supported |
| `align-items` | ✅ | Counter-axis alignment |
| `justify-items` | Partial | Primary-axis alignment approximated |
| `grid-auto-flow: column` | Partial | Horizontal layout mode |

## Conversion Strategy

1. **Detect grid**: If `display: grid`, the converter creates a horizontal or
   vertical Auto Layout frame depending on `grid-auto-flow`.
2. **Column count**: Parsed from `grid-template-columns` (e.g. `repeat(3, 1fr)`
   → 3 columns). Fractional units are distributed equally.
3. **Fixed widths**: When `px` values appear in `grid-template-columns`, children
   are given explicit widths.
4. **Gap**: `column-gap` and `row-gap` map directly to Auto Layout spacing.
5. **Wrap**: `grid-auto-flow: row` with multiple columns produces a wrapping
   hug-content frame; Figma does not natively support grid wrap so items are
   grouped in rows.

## Example

```css
.container {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
```

Result: Auto Layout frame, horizontal, spacing 16, three equal-width children.

## Known Limitations

- Spanning (cells covering multiple columns/rows) is not converted.
- Named grid areas are ignored.
- `minmax()` and `auto-fill`/`auto-fit` are simplified to equal fixed widths.

## Related Docs

- [Layout mapping](layout-mapping.md)
- [Stacking order](stacking-order.md)
- [CSS to Figma mapping](css-figma-mapping.md)
