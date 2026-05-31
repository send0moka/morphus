# Data Flow Diagram

This document describes the end-to-end data flow when a user converts an HTML
page to a Figma design using Morphus.

## High-Level Flow

```
Browser / Figma Plugin UI
        │
        │ 1. User pastes HTML + CSS
        ▼
┌───────────────────────┐
│   Plugin UI (webview) │
│   • Validates input   │
│   • Reads user token  │
└──────────┬────────────┘
           │
           │ 2. POST /v1/convert
           │    X-Morphus-Token: <secret>
           │    Body: { html, css, options }
           ▼
┌───────────────────────────────────┐
│  Local Companion (Node.js)        │
│  • Auth middleware validates token│
│  • Rate limiter checks quota      │
│  • HTML parser builds DOM tree    │
│  • CSS parser computes styles     │
│  • Converter walks DOM + styles   │
│    → emits Figma node objects     │
│  • Asset fetcher inlines images   │
│    and resolves @font-face URLs   │
└──────────────┬────────────────────┘
               │
               │ 3. Response: { ok, nodes }
               ▼
┌───────────────────────┐
│   Plugin UI (webview) │
│   • Receives node tree│
│   • postMessage →     │
│     plugin sandbox    │
└──────────┬────────────┘
           │
           │ 4. postMessage { type: 'RENDER', nodes }
           ▼
┌───────────────────────────────────┐
│  Plugin Sandbox (Figma API)       │
│  • Deserialises node tree         │
│  • Creates Figma frames, text,    │
│    fills, effects, components     │
│  • Appends to current page        │
└───────────────────────────────────┘
               │
               │ 5. Design nodes appear in Figma canvas
               ▼
          Designer's canvas
```

## Key Data Transformations

| Step | Input | Output |
|---|---|---|
| HTML parse | Raw HTML string | DOM node tree |
| Style compute | DOM tree + CSS string | Computed style map |
| Conversion | DOM tree + style map | Figma node JSON array |
| Asset inline | Image URLs | Base64 data URIs |
| Figma API | Figma node JSON | Figma SceneNode objects |

## Error Paths

- **Auth failure**: Companion returns 401; plugin UI shows token error modal.
- **Parse failure**: Companion returns 400; plugin UI shows error with hint.
- **Conversion error**: Companion returns 500; plugin UI shows console link.
- **Network timeout**: Plugin UI retries once, then shows connection error.

## Related Docs

- [Architecture](architecture.md)
- [Plugin message protocol](plugin-message-protocol.md)
- [Conversion job lifecycle](job-lifecycle.md)
- [Error handling](error-handling.md)
