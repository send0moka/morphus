# Release Checklist

Use this checklist before publishing Morphus converter packages or a Figma plugin zip.

## Before Tagging

- Confirm `main` contains the intended changes.
- Run the full test suite:

  ```bash
  npm test
  ```

- Run a local converter smoke test:

  ```bash
  npm run convert -- --input ./tests/landing-page/input.html --output ./out/landing-page.json
  ```

- Review `docs/local-companion.md` for any packaging notes that changed since the previous release.
- Confirm `figma-plugin/manifest.json` points to the intended converter domains.

## Package Build

- Use GitHub Actions for cross-platform packages when possible.
- Build locally only for the current OS target.
- Set `MORPHUS_BUNDLE_BROWSER=1` only when an offline Chromium bundle is required.
- Keep package naming aligned with the documented release asset names.

## Release Assets

Expected release artifacts:

- `Morphus.Figma.Plugin.v<version>.zip`
- `Morphus.Converter.macOS.arm64.v<version>.dmg`
- `Morphus.Converter.macOS.x64.v<version>.dmg`
- `Morphus.Converter.Windows.x64.v<version>.exe`
- `morphus-converter.v<version>.rb`

Windows artifacts may be omitted if a Windows packaging issue is intentionally non-blocking for a macOS-only release.

## After Publishing

- Verify the GitHub Release assets download.
- Import the released Figma plugin zip into Figma.
- Start the released companion app and open `http://localhost:3210/health`.
- Convert the landing page fixture from the released plugin.
- Update the committed Homebrew cask when publishing a Homebrew-ready macOS release.

## Rollback Notes

If a release package is broken, mark the GitHub Release as pre-release or draft, publish a fixed patch version, and keep the old tag for auditability unless it exposed sensitive data.
