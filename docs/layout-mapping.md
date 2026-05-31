# Layout Mapping

Morphus maps rendered browser geometry into Figma frames and auto layout where the result is predictable.

## Browser Geometry First

The extractor records bounding boxes after the browser has resolved CSS. Mapper logic should prefer those rendered dimensions over reimplementing CSS layout math.

## Auto Layout

Flex containers can become Figma auto layout frames when their visual flow is clear. The mapper preserves direction, alignment, gaps, padding, and fill sizing where possible.

## Absolute Positioning

Elements with fixed or absolute positioning keep explicit `x` and `y` offsets relative to their parent. This is safer for overlays, headers, and decorative layers.

## Fixed Dimensions

When rendered free space matters, Morphus keeps frames fixed on the relevant axis instead of shrinking to child content.

## Review Checklist

- Child order matches visual order.
- Padding and gaps match browser output.
- Fill children do not collapse parent width.
- Fixed headers do not cover shifted page content.
