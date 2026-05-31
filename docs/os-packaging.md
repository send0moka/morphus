# OS Packaging Guide

Morphus ships native installers for macOS and Windows built with
[`pkg`](https://github.com/vercel/pkg). This document explains how to produce
and sign them locally.

## Prerequisites

```bash
npm install -g pkg
```

Node.js 20 LTS must be installed. The build scripts assume it is on `PATH`.

## macOS – `.dmg`

```bash
# 1. Compile TypeScript
npm run build

# 2. Bundle with pkg (targets Node 20 on Apple Silicon and Intel)
pkg out/companion/server.js \
  --targets node20-macos-arm64,node20-macos-x64 \
  --output dist/morphus-companion

# 3. (Optional) Sign the binary
codesign --sign "Developer ID Application: <Your Name>" \
  --options runtime \
  dist/morphus-companion

# 4. Create a .dmg
hdiutil create -volname "Morphus" \
  -srcfolder dist/ \
  -ov -format UDZO \
  dist/Morphus.dmg

# 5. Notarise (required for Gatekeeper)
xcrun notarytool submit dist/Morphus.dmg \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --wait
```

## Windows – `.exe`

```powershell
# 1. Compile TypeScript
npm run build

# 2. Bundle with pkg
pkg out\companion\server.js `
  --targets node20-win-x64 `
  --output dist\morphus-companion.exe

# 3. (Optional) Sign with signtool
signtool sign /fd sha256 /tr http://timestamp.digicert.com `
  /td sha256 /f cert.pfx /p $env:CERT_PASS `
  dist\morphus-companion.exe
```

## CI Automation

The `release.yml` GitHub Actions workflow runs these steps automatically on
every version tag (`v*.*.*`). Manual local builds are only needed for testing
the installer before tagging.

## Output Artifacts

| File | Platform | Notes |
|---|---|---|
| `dist/Morphus.dmg` | macOS | Universal (arm64 + x64) |
| `dist/morphus-companion.exe` | Windows x64 | Standalone; no installer |

## Related Docs

- [CI pipeline](ci-pipeline.md)
- [Deployment](deployment.md)
- [Docker guide](docker.md)
