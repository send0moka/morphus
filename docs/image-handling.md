# Image Handling

Morphus maps HTML images and captured raster data to Figma image fills.

## Supported Sources

- Inline base64 image data.
- Browser-captured image bytes.
- CSS background images that the converter can fetch or capture.

## Figma Output

Image nodes are represented as frames or image-like nodes with an `IMAGE` fill. The plugin creates a Figma image hash, applies the fill, and chooses a scale mode based on the extracted CSS object fitting behavior.

## Object Fit

CSS `object-fit` is reduced to practical Figma scale modes:

- `cover` -> `FILL`
- `contain` -> `FIT`
- `fill` -> `FILL`

When an input is ambiguous, Morphus prefers a predictable editable result over pixel-perfect raster behavior.

## Testing

Image behavior is covered in plugin tests with inline base64 fixtures so the suite does not rely on remote assets.
