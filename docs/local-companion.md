# Morphus Local Companion

Morphus Local Companion lets each designer run the converter on their own laptop instead of sharing one public Hugging Face server. The Figma plugin checks `http://127.0.0.1:3210` first, then falls back to the public server if local is not running.

The companion package includes:

- Node runtime bundled inside the app/folder.
- Production Morphus server code.
- Chromium browser downloaded by Playwright.
- Auto shutdown after the Figma plugin stops sending heartbeat.

Users do not need to install Node.js.

## User Flow: macOS

### Homebrew

If the user already has Homebrew:

```bash
brew tap send0moka/morphus https://github.com/send0moka/morphus.git
brew install --cask morphus-local
open -a "Morphus Local"
```

This installs the latest macOS release asset from GitHub Releases. For an update:

```bash
brew update
brew reinstall --cask morphus-local
```

The cask in this repo uses `version :latest` so teammates do not need a cask update for every internal build. For a stricter versioned cask with SHA checksums, use the generated `morphus-local.rb` attached to tag releases.

The release workflow publishes macOS assets with dot-separated filenames such as `Morphus.Local.macOS.arm64.zip`. Keep the committed cask URL in sync with that naming so Homebrew does not hit a 404.

### Zip

1. Extract `Morphus Local macOS <arch>.zip`.
2. Move `Morphus Local.app` to `Applications`, or keep it in the extracted folder.
3. Open `Morphus Local.app`.
4. If macOS blocks it, right-click the app and choose `Open`.
5. A browser status page opens at `http://127.0.0.1:3210`.
6. Open the Morphus Figma plugin and convert as usual.
7. Close the Figma plugin when finished. Morphus Local exits automatically after about 90 seconds.

For smoother company-wide distribution, sign and notarize the `.app` with an Apple Developer ID. Without signing, Gatekeeper warnings are expected.

## User Flow: Windows

1. Extract `Morphus Local Windows <arch>.zip`.
2. Open `Morphus Local.cmd`.
3. Keep the console window open while using the Figma plugin.
4. A browser status page opens at `http://127.0.0.1:3210`.
5. Open the Morphus Figma plugin and convert as usual.
6. Close the Figma plugin when finished. Morphus Local exits automatically after about 90 seconds.

Windows users do not need Node.js either; `node.exe` is bundled inside `.runtime/node`.

## Build Packages

Build packages on the same OS as the target package. This matters because Playwright downloads Chromium for the current OS.

### Recommended: GitHub Actions

You do not need to own or borrow a MacBook just to build the macOS package. Push this repo to GitHub, then run the `Build Local Companion` workflow from the `Actions` tab.

The workflow builds:

- `morphus-local-macos-arm64` on a GitHub-hosted macOS Apple Silicon runner.
- `morphus-local-macos-x64` on a GitHub-hosted macOS Intel runner.
- `morphus-local-windows-x64` on a GitHub-hosted Windows runner.

The Homebrew release job only requires the macOS builds. Windows is uploaded when it succeeds, but a Windows packaging issue should not block the macOS Homebrew release.

Manual release flow:

1. Push the latest code to GitHub.
2. Open `Actions`.
3. Choose `Build Local Companion`.
4. Click `Run workflow`.
5. To make Homebrew work immediately, enable `publish_release` and fill `release_version`, for example `0.1.0`.
6. Download the artifact zips after the jobs finish, or use the published GitHub Release assets.
7. Share the macOS zip with teammates and the Windows zip with Windows users.

Important: Homebrew uses GitHub Release download URLs. A manual workflow run that only produces artifacts is useful for testing, but Homebrew install works after a release is published.

Tag release flow:

```bash
git tag local-companion-v0.1.0
git push origin local-companion-v0.1.0
```

That tag automatically starts the same workflow and publishes a GitHub Release with:

- macOS Apple Silicon zip.
- macOS Intel zip.
- Windows x64 zip, when the Windows build succeeds.
- Versioned `morphus-local.rb` Homebrew Cask with SHA checksums.

The committed cask at `Casks/morphus-local.rb` points at the latest release. If you prefer a dedicated Homebrew tap repo later, copy the generated `morphus-local.rb` into a separate `send0moka/homebrew-morphus` repo under `Casks/morphus-local.rb`, then users can run:

```bash
brew tap send0moka/morphus
brew install --cask morphus-local
```

### Local Build

On macOS:

```bash
npm run local-app:build
```

Output:

```text
out/local-app/Morphus Local macOS arm64.zip
```

or `x64` on an Intel Mac.

On Windows:

```powershell
npm run local-app:build
```

Output:

```text
out/local-app/Morphus Local Windows x64.zip
```

The build script downloads a Node runtime from `nodejs.org`, installs production dependencies, installs Chromium into the app package, then creates the zip.

## Runtime Behavior

The plugin behavior:

1. Sends heartbeat to `http://127.0.0.1:3210/heartbeat` every 5 seconds while the plugin is open.
2. Uses local converter if `http://127.0.0.1:3210/health` is reachable.
3. Falls back to `https://jehian-tempelhtml.hf.space` if local converter is not reachable.

The local server behavior:

1. Accepts only local connections by default: `HOST=127.0.0.1`.
2. Runs one conversion at a time by default: `MORPHUS_MAX_CONCURRENT_JOBS=1`.
3. Queues up to 12 local jobs by default.
4. Exits after 90 seconds without plugin heartbeat.
5. Keeps running while a conversion is active.

## Useful Environment Variables

```text
MORPHUS_PORT=3210
MORPHUS_MAX_CONCURRENT_JOBS=1
MORPHUS_MAX_QUEUED_JOBS=12
MORPHUS_IDLE_SHUTDOWN_MS=90000
MORPHUS_RENDER_TIMEOUT_MS=120000
MORPHUS_JOB_TIMEOUT_MS=150000
PLAYWRIGHT_BROWSERS_PATH=<package>/app/browsers
```

The portable launchers already set these values.

## Limits

- A Figma plugin cannot start a local process by itself. Users still need to open the companion app or command once.
- A zip file cannot safely auto-run code immediately after extraction on macOS or Windows.
- macOS `.app` packages should be signed/notarized before broad internal rollout.
- Cross-building is not recommended because Node and Chromium binaries are platform-specific.
