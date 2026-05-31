# Background Image Handling

CSS backgrounds can contain solid colors, gradients, raster images, or multiple layered values. Morphus maps the pieces it can preserve into Figma fills.

## Layer Order

CSS background layers are listed top-to-bottom. Figma fills are also ordered, so Morphus keeps layer order stable when converting gradients and image fills.

## Gradients

Linear and radial gradients are mapped to Figma gradient paints when their color stops and geometry can be parsed.

Transparent stops are normalized with neighboring opaque color channels so fades behave more like browser gradients.

## Raster Backgrounds

Captured background images become Figma image fills. Morphus prefers stable inline or captured data over remote references during plugin build.

## Fallbacks

Unsupported background features should remain visible in warnings or fixtures. When a CSS feature cannot be mapped cleanly, use a reduced fixture before changing mapper behavior.

## Testing

Background image changes should run:

```bash
npm test -- --runInBand tests/css-to-figma.test.js tests/figma-plugin.test.js
```
