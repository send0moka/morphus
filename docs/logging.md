# Logging Guide

Morphus uses a lightweight structured logger in the local companion. This
document describes the log levels, format, and how to add log statements.

## Log Levels

| Level | When to use |
|---|---|
| `error` | Unrecoverable failures; the request cannot proceed |
| `warn` | Recoverable issues; the system continues but something is off |
| `info` | Normal lifecycle events (server started, request received) |
| `debug` | Detailed tracing useful during development |

Set the active level via the `LOG_LEVEL` environment variable. Messages below
the active level are suppressed.

## Log Format

All log lines are newline-delimited JSON (NDJSON) for easy parsing by log
aggregators:

```json
{"timestamp":"2024-01-15T10:23:45.123Z","level":"info","msg":"Server started","port":3000}
{"timestamp":"2024-01-15T10:23:46.001Z","level":"debug","msg":"Incoming request","method":"POST","path":"/convert"}
```

In development (`NODE_ENV=development`), the logger pretty-prints output with
colors instead of JSON.

## Logger API

```ts
import { logger } from './logger.js';

logger.info('Server started', { port });
logger.debug('Processing node', { tag, id });
logger.warn('Missing font', { family, fallback });
logger.error('Conversion failed', { error: err.message, code: err.code });
```

Always pass context as a second object argument rather than interpolating into
the message string. This keeps messages searchable and consistent.

## Request Logging Middleware

```ts
app.use((req, _res, next) => {
  logger.debug('Incoming request', {
    method: req.method,
    path: req.path,
    contentLength: req.headers['content-length'],
  });
  next();
});
```

## Adding Log Statements

1. Import `logger` from `'./logger.js'`.
2. Choose the appropriate level.
3. Keep messages terse and action-focused.
4. Pass structured data as the second argument.
5. Never log secrets or PII.

## Related Docs

- [Environment variables](environment.md)
- [Debugging tips](debugging.md)
- [Error handling](error-handling.md)
