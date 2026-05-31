# Manifest Schema Reference

The Figma plugin manifest (`figma-plugin/manifest.json`) declares how the plugin
is loaded by Figma. This document describes every field used by Morphus.

## Full Example

```json
{
  "name": "Morphus",
  "id": "1234567890123456789",
  "api": "1.0.0",
  "main": "code.js",
  "capabilities": [],
  "enableProposedApi": false,
  "editorType": ["figma"],
  "ui": "ui.html",
  "networkAccess": {
    "allowedDomains": ["http://localhost:3000"],
    "reasoning": "Connects to the local Morphus companion for HTML/CSS conversion."
  },
  "permissions": ["currentuser"],
  "documentAccess": "dynamic-page"
}
```

## Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Display name shown in the Figma plugin menu |
| `id` | string | Yes | Unique plugin ID from Figma's developer portal |
| `api` | string | Yes | Minimum Figma plugin API version required |
| `main` | string | Yes | Entry point for the plugin sandbox (compiled JS) |
| `ui` | string | No | HTML file for the plugin UI webview |
| `editorType` | string[] | Yes | Which Figma products the plugin runs in |
| `networkAccess.allowedDomains` | string[] | Yes | Domains the UI may `fetch()`; must include companion URL |
| `permissions` | string[] | No | Extra permissions; `currentuser` reads user locale |
| `documentAccess` | string | No | `"dynamic-page"` lets the plugin read any page |
| `enableProposedApi` | boolean | No | Enable unstable Figma APIs (avoid in production) |
| `capabilities` | string[] | No | Additional capabilities (empty for current release) |

## Network Access

The `networkAccess.allowedDomains` list must include the companion URL. The
default `http://localhost:3000` covers the standard local setup. If a user runs
the companion on a non-standard port, they must manually update the manifest
(development mode only).

## Updating the Manifest

Changes to `manifest.json` require reloading the plugin in Figma. The file is
**not** compiled; edit it directly and reload.

## Related Docs

- [Plugin message protocol](plugin-message-protocol.md)
- [Security model](security-model.md)
- [Development workflow](development-workflow.md)
