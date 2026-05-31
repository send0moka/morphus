# Stacking Order & Z-Index Mapping

Morphus preserves the visual stacking order from the DOM and translates it into
Figma layer ordering so the final design matches the browser render.

## How CSS Stacking Contexts Map to Figma

| CSS property | Effect on stacking | Figma equivalent |
|---|---|---|
| `z-index` (positive) | Raises element above siblings | Layer moved toward top of group |
| `z-index` (negative) | Lowers element below siblings | Layer moved toward bottom of group |
| `position: relative/absolute/fixed` | Creates stacking context | Affects insertion order in parent frame |
| `opacity < 1` | Creates stacking context | Figma layer opacity applied |
| `transform` | Creates stacking context | Figma transform applied |

## Processing Order

1. The converter walks the DOM in document order (depth-first).
2. Each element is appended as a new Figma child — later siblings appear on top.
3. After the walk, the converter re-orders children according to computed `z-index`
   values within the same stacking context.
4. Nested stacking contexts are treated as isolated groups; their internal order
   does not affect siblings in the parent context.

## Known Limitations

- Elements with `z-index: auto` inside a stacking context are ordered by DOM
  position only.
- Overlapping elements from different stacking contexts may not render identically
  to the browser when `overflow: hidden` is involved.
- `mix-blend-mode` is not yet forwarded to Figma layer blend modes.

## Example

```html
<div style="position:relative">
  <div style="z-index:1; background:red">A</div>
  <div style="z-index:3; background:blue">B</div>
  <div style="z-index:2; background:green">C</div>
</div>
```

Figma layer order (top → bottom): **B → C → A**

## Related Docs

- [Layout mapping](layout-mapping.md)
- [CSS to Figma mapping](css-figma-mapping.md)
