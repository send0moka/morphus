# Architecture

## Overview

Morphus renders HTML in Playwright, extracts computed styles, maps the result to a Figma-ready JSON tree, and lets the Figma plugin build the design locally.

1. Playwright renders the page and captures bounding boxes plus computed styles.
2. The Node pipeline normalizes fonts, stacking order, and layout hints.
3. The pipeline returns a deterministic JSON snapshot.
4. The Figma plugin reads the snapshot and creates nodes.

---

## Intermediate Representation

```json
{
  "version": "0.1.0",
  "meta": {
    "source": "./examples/vela.html",
    "title": "VELA — Creative Studio",
    "viewport": { "width": 1440, "height": 900 }
  },
  "warnings": [],
  "figmaTree": [
    {
      "id": "body-el-abc1",
      "name": "body",
      "type": "FRAME",
      "x": 0,
      "y": 0,
      "width": 1440,
      "height": 5200,
      "children": []
    }
  ]
}
```

### FigmaNode schema

```ts
type FigmaNode = {
  id: string;
  name: string;
  type: "FRAME" | "TEXT" | "SVG";
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;

  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  effects?: Effect[];
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  layoutMode?: "HORIZONTAL" | "VERTICAL" | "NONE";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  // CSS align-items: stretch is represented by child layoutSizing* = "FILL".
  itemSpacing?: number;
  layoutPositioning?: "AUTO" | "ABSOLUTE";
  clipsContent?: boolean;
  cornerRadius?: number;
  children?: FigmaNode[];

  characters?: string;
  fontName?: { family: string; style: string };
  fontSize?: number;
  lineHeight?: { value: number; unit: "PERCENT" | "PIXELS" | "AUTO" };
  letterSpacing?: { value: number; unit: "PIXELS" };
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";

  _gridStrategy?: object;
  _hoverSpec?: object;
  _isPseudo?: boolean;
  _pseudoType?: string;
  _pseudoPosition?: string;
  _pageLayout?: boolean;
  _role?: string;
  _backgroundPattern?: object;
  _svgMarkup?: string;
};
```

---

## Node Pipeline

```
scripts/convert.js
├── core/extractor.js
├── figma/font-resolver.js
├── figma/z-index-sorter.js
├── figma/mapper.js
└── pipeline/convert.js
```

### Responsibilities

- `src/core/extractor.js` renders the page in Chromium and reads `getComputedStyle()` plus geometry.
- `src/figma/css-to-figma.js` converts CSS values into Figma properties.
- `src/figma/font-resolver.js` maps browser font weights and styles to available Figma fonts.
- `src/figma/z-index-sorter.js` orders nodes to match stacking context.
- `src/figma/mapper.js` assembles the final node tree.
- `src/pipeline/convert.js` coordinates the full conversion and returns the JSON snapshot.

---

## Figma Plugin Flow

```
User selects HTML -> clicks Convert & Build
  -> ui.html posts BUILD or CONVERT_AND_BUILD
  -> code.js checks converter health
  -> local server converts HTML to JSON
  -> plugin preloads fonts
  -> plugin creates frames, text nodes, and SVG nodes
  -> top-level layout is arranged on the page
```

The plugin also exposes a Benchmark button that opens `https://figmaeval.vercel.app` for visual comparison.

---

## Key Constraints

### Figma Plugin Sandbox
- No Node.js filesystem APIs.
- No external fetch unless the domain is allowed.
- Async/await is supported.
- `figma.createImageAsync()` needs image bytes.

### Playwright
- Run headless.
- `page.evaluate()` must use serializable functions.
- Injected style tags should be removed or controlled carefully.

---

## Current Gaps

- `clip-path` still needs a raster fallback.
- Complex CSS Grid patterns still fall back to simpler layout heuristics.
- Multi-page support is still missing.
- Watch mode is not wired in yet.
- Visual diff is handled externally through the benchmark site.
