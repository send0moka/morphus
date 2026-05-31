# Plugin Security Model

Morphus communicates between the Figma plugin (sandboxed iframe) and the local
companion (HTTP server). This document describes the security measures in place.

## Trust Boundaries

```
┌─────────────────────────────┐
│  Figma Plugin (iframe)      │  ← sandboxed by Figma platform
│  - No direct file system    │
│  - No direct network        │
└────────────┬────────────────┘
             │ postMessage (Figma internal)
┌────────────▼────────────────┐
│  Plugin UI (webview)        │  ← runs inside Figma app
│  - fetch() allowed          │
│  - DOM access               │
└────────────┬────────────────┘
             │ HTTP (localhost only)
┌────────────▼────────────────┐
│  Local Companion (Node.js)  │  ← runs on user's machine
│  - File system access       │
│  - Spawns processes         │
└─────────────────────────────┘
```

## Shared Secret Authentication

Every HTTP request from the plugin UI to the companion includes a
`X-Morphus-Token` header with a user-configured secret. The companion rejects
any request where the header is missing or does not match.

```ts
// companion/middleware/auth.ts
export function authMiddleware(secret: string): RequestHandler {
  return (req, res, next) => {
    if (req.headers['x-morphus-token'] !== secret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    next();
  };
}
```

The secret is set by the user in the plugin settings UI and stored in Figma's
`clientStorage` API (not in plain localStorage).

## Localhost Only

The companion binds to `127.0.0.1` (loopback) only. Requests from other
machines on the network are rejected at the OS level before reaching the app.

## Input Validation

- HTML input is size-limited (default 10 MB, configurable via `MAX_BODY_SIZE`).
- The companion strips `<script>` and `<iframe>` tags before parsing to prevent
  code injection through crafted HTML.
- File paths used in asset resolution are validated against a whitelist of
  allowed extensions (`.png`, `.jpg`, `.svg`, `.woff2`, `.woff`, `.ttf`).

## CORS

The companion sets `Access-Control-Allow-Origin` to the Figma desktop app
origin only. Requests from any other origin are rejected.

## Threat Model

| Threat | Mitigation |
|---|---|
| Another app on the same machine calls the companion | Shared secret required |
| Crafted HTML executes code in the companion | Script tags stripped; companion does not eval |
| Malicious font file exfiltrates data | Extension whitelist; no arbitrary file reads |
| Man-in-the-middle on loopback | Low risk; TLS on loopback is not supported |

## Related Docs

- [Plugin message protocol](plugin-message-protocol.md)
- [Environment variables](environment.md)
- [Local companion lifecycle](local-companion-lifecycle.md)
