# Feature Flags

Morphus uses a lightweight feature flag system to roll out experimental features
without requiring a new release.

## How Flags Work

Feature flags are boolean values read from the `FEATURES_*` environment
variables when the companion starts. The plugin UI reads the active flags from
the `GET /v1/features` endpoint and shows or hides UI elements accordingly.

```
GET /v1/features
→ { "ok": true, "flags": { "persistentCache": false, "gridLayout": true } }
```

## Current Flags

| Flag | Env var | Default | Description |
|---|---|---|---|
| `gridLayout` | `FEATURE_GRID_LAYOUT` | `true` | CSS Grid → Auto Layout conversion |
| `persistentCache` | `FEATURE_PERSISTENT_CACHE` | `false` | Disk-based cache across restarts |
| `svgOptimize` | `FEATURE_SVG_OPTIMIZE` | `true` | Run SVGO on converted SVGs |
| `debugOverlay` | `FEATURE_DEBUG_OVERLAY` | `false` | Show conversion metadata in Figma |

## Enabling a Flag

```bash
FEATURE_PERSISTENT_CACHE=true node out/companion/server.js
```

Or add to your `.env` file:

```
FEATURE_PERSISTENT_CACHE=true
```

## Consuming Flags in Code

```ts
import { flags } from './features.js';

if (flags.persistentCache) {
  await saveToDisk(result);
}
```

Never hard-code feature flag checks with raw environment variable reads.
Always use the `flags` object so they are centrally logged on startup.

## Adding a New Flag

1. Add a new entry to the `FLAGS` record in `src/features.ts`:
   ```ts
   persistentCache: env('FEATURE_PERSISTENT_CACHE', false),
   ```
2. Document it in the table above.
3. Use `flags.yourFlag` wherever the guarded code path appears.
4. Add a test that exercises the code path with the flag enabled and disabled.
5. When the feature is stable, remove the guard and delete the flag.

## Related Docs

- [Environment variables](environment.md)
- [Caching strategy](caching.md)
- [Development workflow](development-workflow.md)
