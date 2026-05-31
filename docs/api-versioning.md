# API Versioning

The Morphus local companion exposes an HTTP API consumed by the Figma plugin UI.
This document explains how the API is versioned and how to handle version
mismatches.

## Current Version

The companion API is at **v1**. All endpoints are prefixed with `/v1/`.

```
GET  /v1/health
POST /v1/convert
GET  /v1/status/:jobId
```

## Version Header

Every response includes an `X-Morphus-API-Version` header:

```
X-Morphus-API-Version: 1
```

The plugin UI reads this header on startup and shows a warning if the companion
version is older than the minimum required by the plugin.

## Version Compatibility Matrix

| Plugin version | Minimum companion version | Maximum companion version |
|---|---|---|
| 0.x | 0.x | 0.x |
| 1.0 | 1.0 | 1.x |
| 1.1 | 1.0 | 1.x |

A minor companion bump is always backward-compatible with the same major plugin
version. A major bump may require both to be updated together.

## Adding a New Endpoint

1. Define the route handler in `companion/routes/v1/`.
2. Register it under the `/v1` Express router.
3. Document the request/response shape in this file.
4. Add integration tests in `tests/api/v1/`.

## Breaking Change Policy

Before introducing a breaking change:

1. Add the new behaviour under `/v2/`.
2. Keep `/v1/` operational for one major release cycle.
3. Update the plugin to default to `/v2/` in the next minor release.
4. Remove `/v1/` only when no production users depend on it.

## Endpoint Reference

### `POST /v1/convert`

**Request**
```json
{
  "html": "<div>...</div>",
  "css": "body { ... }",
  "options": {
    "embedImages": true,
    "maxDepth": 20
  }
}
```

**Response**
```json
{
  "ok": true,
  "jobId": "abc123",
  "nodes": [ /* Figma node tree */ ]
}
```

### `GET /v1/status/:jobId`

Returns the current state of an async conversion job.

```json
{ "ok": true, "status": "done", "progress": 100 }
```

## Related Docs

- [Plugin message protocol](plugin-message-protocol.md)
- [Error handling](error-handling.md)
- [Converter API](converter-api.md)
