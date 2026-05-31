# Error Handling Guide

This document describes how Morphus surfaces errors from conversion, network
calls, and plugin communication, and how developers should add new error paths.

## Error Categories

| Category | Source | User-facing message |
|---|---|---|
| `NETWORK_ERROR` | Companion HTTP request timeout/failure | "Cannot reach local companion" |
| `PARSE_ERROR` | Invalid HTML or CSS input | "Could not parse the provided markup" |
| `CONVERSION_ERROR` | Converter throws during mapping | "Conversion failed – see console" |
| `PLUGIN_MSG_ERROR` | Malformed message to/from plugin | "Unexpected plugin response" |
| `FS_ERROR` | File system read/write in companion | "File operation failed" |

## Centralized Error Object

All internal errors should be thrown as `MorphusError`:

```ts
class MorphusError extends Error {
  constructor(
    message: string,
    public code: string,
    public detail?: unknown
  ) {
    super(message);
    this.name = 'MorphusError';
  }
}
```

Consumers catch `MorphusError` and map `code` to a localized user message.

## Plugin Side

The Figma plugin catches all unhandled errors in its message handler:

```ts
figma.ui.onmessage = async (msg) => {
  try {
    await handleMessage(msg);
  } catch (err) {
    figma.notify(err instanceof MorphusError ? err.message : 'Unknown error');
    figma.ui.postMessage({ type: 'ERROR', error: String(err) });
  }
};
```

## Companion Side

The Express server uses a global error middleware:

```ts
app.use((err, _req, res, _next) => {
  const code = err instanceof MorphusError ? err.code : 'UNKNOWN';
  res.status(500).json({ ok: false, code, message: err.message });
});
```

## Adding a New Error Path

1. Import `MorphusError` from `src/errors.ts`.
2. Throw with a meaningful `code` constant (add to `ErrorCode` enum if new).
3. Add a test fixture in `tests/errors/` that triggers the error path.
4. Document the code and message in this file.

## Related Docs

- [Conversion job lifecycle](job-lifecycle.md)
- [Plugin message protocol](plugin-message-protocol.md)
- [Troubleshooting](troubleshooting.md)
