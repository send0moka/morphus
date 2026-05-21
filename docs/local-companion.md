# Morphus Converter

Morphus Converter lets each designer run the converter on their own laptop instead of sharing one public Hugging Face server. The Figma plugin uses `http://localhost:3210` only; if Morphus Converter is stopped or unreachable, the plugin shows a local-converter error instead of falling back to the public server.

The companion package includes:

- Node runtime bundled inside the app/folder.
- Production Morphus server code.
- Chromium browser downloaded by Playwright.
- Background idle mode after the Figma plugin is closed.

Users do not need to install Node.js.

## User Flow: Figma Plugin

Everyone needs the current Figma plugin package. This is separate from Morphus Converter.

1. Download `Morphus.Figma.Plugin.v<version>.zip` from the GitHub Release.
2. Extract it.
3. In Figma, go to `Plugins > Development > Import plugin from manifest...`.
4. Choose `manifest.json` from the extracted folder.

The old `htmltofigma-v3.zip` plugin should be replaced because it may still point to the public server and may not include the Morphus Converter heartbeat.

If Figma shows `Manifest error: Invalid value for networkAccess` or `Invalid value for allowedDomains`, the user is likely importing an older plugin package. Use a newer `Morphus.Figma.Plugin.v<version>.zip` that uses `http://localhost:3210` and includes the required `networkAccess.reasoning` field for localhost access.

## User Flow: macOS

### Homebrew

If the user already has Homebrew:

```bash
brew tap send0moka/morphus https://github.com/send0moka/morphus.git
brew install --cask morphus-converter
open -a "Morphus Converter"
```

This installs the macOS release asset referenced by `Casks/morphus-converter.rb`. For an update:

```bash
brew update
brew reinstall --cask morphus-converter
```

The cask in this repo points at the current internal release version. Update the cask version before publishing a new Homebrew release. For a stricter cask with SHA checksums, use the generated `morphus-converter.v<version>.rb` attached to tag releases.

The release workflow publishes macOS assets with versioned dot-separated filenames such as `Morphus.Converter.macOS.arm64.v0.1.4.zip`. Keep the committed cask URL in sync with that naming so Homebrew does not hit a 404.

### Zip

1. Extract `Morphus.Converter.macOS.<arch>.v<version>.zip`.
2. Move `Morphus Converter.app` to `Applications`, or keep it in the extracted folder.
3. Open `Morphus Converter.app`.
4. If macOS blocks it, right-click the app and choose `Open`.
5. A browser status page opens at `http://localhost:3210`.
6. Open the Morphus Figma plugin and convert as usual.
7. Close the Figma plugin when finished. Morphus Converter stays idle in the background.
8. To pause conversion, open `http://localhost:3210` and click `Shut Down Converter`.
9. To enable conversion again, click `Run Converter` on the same status page.

For smoother company-wide distribution, sign and notarize the `.app` with an Apple Developer ID. Without signing, Gatekeeper warnings are expected.

## User Flow: Windows

1. Extract `Morphus.Converter.Windows.<arch>.v<version>.zip`.
2. Open `Morphus Converter.vbs`. If Windows hides file extensions, this may appear as `Morphus Converter`.
3. A browser status page opens at `http://localhost:3210`.
4. The converter runs in the background without a Command Prompt window.
5. Open the Morphus Figma plugin and convert as usual.
6. Close the Figma plugin when finished. Morphus Converter stays idle in the background.
7. To pause conversion, open `http://localhost:3210` and click `Shut Down Converter`.
8. To enable conversion again, click `Run Converter` on the same status page.
9. If the background launcher is blocked by Windows policy, open `Morphus Converter Debug.cmd` to run it with visible logs.

Windows users do not need Node.js either; `node.exe` is bundled inside `.runtime/node`.

## Fast Local Testing

Use this loop while developing Morphus. Do not use GitHub Actions or release zips for every small check.

1. In Figma, import the plugin directly from this repo: `figma-plugin/manifest.json`.
2. After editing `figma-plugin/code.js` or `figma-plugin/ui.html`, close and reopen the development plugin in Figma.
3. After editing converter code such as `src/figma/mapper.js`, stop the packaged Morphus Converter first because it owns port `3210`.
4. Start the source converter from this repo:

```powershell
npm run dev:converter
```

On Windows you can also double-click `Morphus Dev Converter.cmd`.

5. Keep using the same development plugin in Figma. It still talks to `http://localhost:3210`, but now that server is the source code in this repo.
6. Run the focused tests before checking in:

```powershell
npm test -- --runInBand tests/figma-plugin.test.js tests/mapper.test.js
```

Only use the full commit, push, workflow, download, extract flow when testing the final release package exactly like a new user.

## Build Packages

Build packages on the same OS as the target package. This matters because Playwright downloads Chromium for the current OS.

### Recommended: GitHub Actions

You do not need to own or borrow a MacBook just to build the macOS package. Push this repo to GitHub, then run the `Build Morphus Packages` workflow from the `Actions` tab.

The workflow builds:

- `morphus-converter-macos-arm64` on a GitHub-hosted macOS Apple Silicon runner.
- `morphus-converter-macos-x64` on a GitHub-hosted macOS Intel runner.
- `morphus-converter-windows-x64` on a GitHub-hosted Windows runner.

The Homebrew release job only requires the macOS builds. Windows is uploaded when it succeeds, but a Windows packaging issue should not block the macOS Homebrew release.

Manual release flow:

1. Push the latest code to GitHub.
2. Open `Actions`.
3. Choose `Build Morphus Packages`.
4. Click `Run workflow`.
5. To make Homebrew work immediately, enable `publish_release` and fill `release_version`, for example `0.1.0`.
6. Download the artifact zips after the jobs finish, or use the published GitHub Release assets.
7. Share the macOS zip with teammates and the Windows zip with Windows users.

Important: Homebrew uses GitHub Release download URLs. A manual workflow run that only produces artifacts is useful for testing, but Homebrew install works after a release is published.

Release zips are intentionally flat. After users choose Extract All, the extracted Figma plugin folder contains `manifest.json` directly, and the extracted Windows converter folder contains `Morphus Converter.vbs` directly.

Tag release flow:

```bash
git tag morphus-v0.1.1
git push origin morphus-v0.1.1
```

That tag automatically starts the same workflow and publishes a GitHub Release with:

- `Morphus.Figma.Plugin.v<version>.zip` for Figma manifest import.
- `Morphus.Converter.macOS.arm64.v<version>.zip`.
- `Morphus.Converter.macOS.x64.v<version>.zip`.
- `Morphus.Converter.Windows.x64.v<version>.zip`, when the Windows build succeeds.
- Versioned `morphus-converter.v<version>.rb` Homebrew Cask with SHA checksums.

The committed cask at `Casks/morphus-converter.rb` points at the current release. If you prefer a dedicated Homebrew tap repo later, copy the generated `morphus-converter.v<version>.rb` into a separate `send0moka/homebrew-morphus` repo under `Casks/morphus-converter.rb`, then users can run:

```bash
brew tap send0moka/morphus
brew install --cask morphus-converter
```

### Local Build

On macOS:

```bash
npm run converter:build
```

Output:

```text
out/local-app/Morphus Converter macOS arm64.zip
```

or `x64` on an Intel Mac.

On Windows:

```powershell
npm run converter:build
```

Output:

```text
out/local-app/Morphus Converter Windows x64.zip
```

The default build creates a slim package: Morphus code is bundled with esbuild, the Node runtime is copied without npm/corepack, and Chromium is not bundled. On Windows this uses the built-in Microsoft Edge browser; on macOS this uses an installed Google Chrome browser.

To build the older fully offline package with Chromium included:

```powershell
$env:MORPHUS_BUNDLE_BROWSER = "1"
npm run converter:build
```

The offline package is much larger because Chromium is several hundred MB after extraction.

## Runtime Behavior

The plugin behavior:

1. Sends heartbeat to `http://localhost:3210/heartbeat` every 5 seconds while the plugin is open.
2. Uses Morphus Converter if `http://localhost:3210/health` returns a running state.
3. Shows an error dialog if Morphus Converter is stopped or unreachable. The dialog includes a button for `http://localhost:3210`.

The local server behavior:

1. Accepts only local connections by default: `HOST=localhost`.
2. Runs one conversion at a time by default: `MORPHUS_MAX_CONCURRENT_JOBS=1`.
3. Queues up to 12 local jobs by default.
4. Stays idle when there is no plugin heartbeat or active conversion.
5. Pauses conversion when the user clicks `Shut Down Converter` on the status page.
6. Resumes conversion when the user clicks `Run Converter` on the same status page.
7. Fully exits only when `MORPHUS_IDLE_SHUTDOWN_MS` is set to a positive value and the idle timer fires, or when the OS process is closed.

## Useful Environment Variables

```text
MORPHUS_PORT=3210
MORPHUS_MAX_CONCURRENT_JOBS=1
MORPHUS_MAX_QUEUED_JOBS=12
MORPHUS_IDLE_SHUTDOWN_MS=0
MORPHUS_RENDER_TIMEOUT_MS=120000
MORPHUS_JOB_TIMEOUT_MS=150000
MORPHUS_BROWSER_CHANNEL=msedge
MORPHUS_CHROMIUM_EXECUTABLE_PATH=<optional absolute browser path>
PLAYWRIGHT_BROWSERS_PATH=<offline package>/app/browsers
```

The portable launchers already set these values.

## Limits

- A Figma plugin cannot start a local process by itself. Users still need to open the companion app or launcher once.
- A zip file cannot safely auto-run code immediately after extraction on macOS or Windows.
- macOS `.app` packages should be signed/notarized before broad internal rollout.
- Windows Script Host may be disabled by company policy; use `Morphus Converter Debug.cmd` as the fallback launcher in that case.
- Cross-building is not recommended because Node and Chromium binaries are platform-specific.
