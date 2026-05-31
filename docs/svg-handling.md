# SVG Handling

Morphus preserves inline SVG when the source markup can be represented by Figma's SVG importer.

## Extraction

Inline SVG markup is captured separately from normal HTML element mapping. The converter stores the markup on the Figma-ready node so the plugin can import it directly.

## Plugin Build

The plugin uses Figma's SVG creation API for SVG markup, then applies the extracted position, dimensions, opacity, and node name.

## When SVG Is Preferred

Use SVG import for:

- Icons.
- Logos.
- Decorative vector shapes.
- Simple illustrations that should remain editable as vector content.

## Known Constraints

Complex SVG filters, masks, external references, and scripts may not import exactly as rendered in the browser. For those cases, a raster fallback can be safer.

## Testing

Keep SVG test fixtures inline so test output stays deterministic and does not depend on remote files.
