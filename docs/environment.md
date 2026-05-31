# Environment Variables

Morphus can run as a local converter, a packaged companion app, or a public service. These environment variables tune those modes.

## Server

```text
MORPHUS_PORT=3210
HOST=localhost
PORT=<platform-provided-port>
```

- `MORPHUS_PORT` controls the local companion and development server port.
- `HOST=localhost` keeps local conversion private to the current machine.
- `PORT` is used by public hosting platforms that inject a service port.

## Queue And Capacity

```text
MORPHUS_MAX_CONCURRENT_JOBS=1
MORPHUS_MAX_QUEUED_JOBS=12
```

- Keep concurrency low on small machines because each conversion can start Chromium.
- Use a queue limit so overloaded public services fail quickly instead of holding requests forever.

## Timeouts

```text
MORPHUS_RENDER_TIMEOUT_MS=120000
MORPHUS_JOB_TIMEOUT_MS=150000
MORPHUS_NAVIGATION_TIMEOUT_MS=15000
MORPHUS_NETWORK_IDLE_TIMEOUT_MS=5000
```

- `MORPHUS_RENDER_TIMEOUT_MS` caps browser rendering time.
- `MORPHUS_JOB_TIMEOUT_MS` caps the full conversion job.
- `MORPHUS_NAVIGATION_TIMEOUT_MS` limits initial page navigation.
- `MORPHUS_NETWORK_IDLE_TIMEOUT_MS` limits waiting for remote assets.

## Browser Selection

```text
MORPHUS_BROWSER_CHANNEL=msedge
MORPHUS_CHROMIUM_EXECUTABLE_PATH=<absolute-browser-path>
PLAYWRIGHT_BROWSERS_PATH=<offline-package>/app/browsers
MORPHUS_BUNDLE_BROWSER=1
```

- `MORPHUS_BROWSER_CHANNEL` prefers an installed browser channel.
- `MORPHUS_CHROMIUM_EXECUTABLE_PATH` points to a specific browser binary.
- `PLAYWRIGHT_BROWSERS_PATH` is useful for offline companion packages.
- `MORPHUS_BUNDLE_BROWSER=1` builds a larger package with Chromium included.

## Web Fonts

```text
MORPHUS_INSTALL_WEB_FONTS=1
MORPHUS_WINDOWS_FONT_DIR=<optional Windows font install folder>
MORPHUS_MACOS_FONT_DIR=<optional macOS font install folder>
```

- `MORPHUS_INSTALL_WEB_FONTS=1` lets the local companion install captured web fonts for the current user.
- The OS-specific font directory variables are mainly useful for packaging and testing.

Always confirm the font license allows local installation before distributing packages that install fonts automatically.

## Idle Behavior

```text
MORPHUS_IDLE_SHUTDOWN_MS=0
```

The local companion stays idle when no plugin heartbeat is active. Set a positive value to let it exit after the idle timer fires.
