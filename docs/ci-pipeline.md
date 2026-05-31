# CI Pipeline Walkthrough

This document describes the GitHub Actions workflows that run on every pull
request and merge to `main`.

## Workflow Files

```
.github/
  workflows/
    ci.yml          # main CI: lint, test, build
    release.yml     # triggered on version tags; builds installers
```

## `ci.yml` – Pull Request & Main Branch

### Trigger

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

### Jobs

| Job | Steps | Fails PR if |
|---|---|---|
| `lint` | `npm ci` → `npm run lint` → `npm run format -- --check` | Any lint or format error |
| `test` | `npm ci` → `npm test` | Any test fails |
| `build` | `npm ci` → `npm run build` | TypeScript compile error |

All three jobs run in parallel on `ubuntu-latest` with `node-version: 20`.

### Caching

`actions/cache` caches `~/.npm` keyed on `package-lock.json` hash to speed up
`npm ci` on repeat runs.

## `release.yml` – Version Tags

Triggered by tags matching `v*.*.*`. Builds platform installers:

1. **macOS** – runs on `macos-latest`; produces `.dmg` via `pkg` and signs with
   the Apple Developer ID stored in secrets.
2. **Windows** – runs on `windows-latest`; produces `.exe` via `pkg` and signs
   with the code-signing cert stored in secrets.
3. Uploads both artifacts to the GitHub Release created by the tag push.

## Adding a New Check

1. Add the script to `package.json` (e.g. `"check:types": "tsc --noEmit"`).
2. Add a step to the relevant job in `ci.yml`:
   ```yaml
   - name: Type check
     run: npm run check:types
   ```
3. Open a PR; the new step appears in the PR checks list automatically.

## Secrets Required

| Secret name | Used in |
|---|---|
| `APPLE_DEVELOPER_ID` | `release.yml` macOS signing |
| `APPLE_KEYCHAIN_PASS` | `release.yml` macOS signing |
| `WIN_CERT_BASE64` | `release.yml` Windows signing |

## Related Docs

- [Development workflow](development-workflow.md)
- [Deployment](deployment.md)
- [Release checklist](release-checklist.md)
