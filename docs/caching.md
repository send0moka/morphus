# Caching Strategy

Morphus caches intermediate conversion results and remote assets to reduce
latency on repeated conversions. This document describes the caching layers,
invalidation rules, and configuration options.

## Cache Layers

### 1. Font Cache

Remote fonts fetched via `@font-face` src URLs are cached in memory for the
lifetime of the companion process. The cache key is the full URL.

- **TTL**: process lifetime (evicted on restart)
- **Max size**: 50 MB (configurable via `FONT_CACHE_MAX_MB`)
- **Eviction**: LRU when the limit is reached

### 2. Image Cache

External images referenced by `<img src>` or `url()` in CSS are fetched once
and stored as base64 strings in memory.

- **TTL**: process lifetime
- **Max size**: 100 MB (configurable via `IMAGE_CACHE_MAX_MB`)
- **Eviction**: LRU

### 3. CSS Parse Cache

Parsed CSS ASTs are cached by stylesheet content hash (SHA-256) to avoid
re-parsing identical inline styles.

- **TTL**: process lifetime
- **Invalidation**: content-addressed (hash change = new cache entry)

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `FONT_CACHE_MAX_MB` | `50` | Max font cache size in megabytes |
| `IMAGE_CACHE_MAX_MB` | `100` | Max image cache size in megabytes |
| `DISABLE_CACHE` | `false` | Set to `true` to bypass all caches (useful for testing) |

## Cache Bypass

Pass `?nocache=1` to any `/v1/convert` request to skip cached assets for that
request only. The cache is not cleared; subsequent requests without the flag
will still use cached entries.

## Persistent Cache (Future)

A disk-based persistent cache is planned for a future release. It will allow
converted design nodes to be reused across companion restarts. See the open
issue for design discussion.

## Testing Without Cache

```bash
DISABLE_CACHE=true node out/companion/server.js
```

Or per-request:

```bash
curl -X POST http://localhost:3000/v1/convert?nocache=1 \
  -H "X-Morphus-Token: <secret>" \
  -d '{"html":"...","css":""}'
```

## Related Docs

- [Environment variables](environment.md)
- [Performance benchmarks](benchmarks.md)
- [Debugging tips](debugging.md)
