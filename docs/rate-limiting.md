# Rate Limiting

The Morphus local companion applies request rate limiting to protect the host
machine from runaway conversion loops.

## Default Limits

| Endpoint | Limit | Window |
|---|---|---|
| `POST /v1/convert` | 10 requests | 60 seconds |
| `GET /v1/status/:jobId` | 60 requests | 60 seconds |
| `GET /v1/health` | Unlimited | – |

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_CONVERT` | `10` | Max convert requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window size in milliseconds |
| `RATE_LIMIT_ENABLED` | `true` | Set to `false` to disable (dev only) |

## Response When Limit Exceeded

When a client exceeds the limit the companion responds with HTTP 429:

```json
{
  "ok": false,
  "code": "RATE_LIMITED",
  "message": "Too many requests. Please wait before retrying.",
  "retryAfterMs": 42000
}
```

The `Retry-After` header is also set (in seconds).

## Why Rate Limiting Exists

The companion is a local process with no auth beyond the shared secret. A bug in
the plugin UI or a malicious page that somehow obtained the secret could trigger
thousands of conversions in a short time, monopolizing CPU and memory.

Rate limiting is intentionally low because normal interactive use never exceeds
a few conversions per minute.

## Disabling for Tests

Integration tests that need to send many requests in quick succession should set:

```bash
RATE_LIMIT_ENABLED=false node out/companion/server.js
```

Never disable rate limiting in production deployments.

## Implementation Reference

```ts
import rateLimit from 'express-rate-limit';

const convertLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  max: Number(process.env.RATE_LIMIT_CONVERT ?? 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please wait before retrying.',
    });
  },
});

router.post('/convert', convertLimiter, convertHandler);
```

## Related Docs

- [Security model](security-model.md)
- [Environment variables](environment.md)
- [Error handling](error-handling.md)
