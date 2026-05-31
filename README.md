---
title: Morphus
sdk: docker
app_port: 7860
pinned: false
---

# Morphus

Morphus converts HTML into editable Figma designs through a local, HTML-first pipeline.

It renders real HTML with Playwright, captures computed styles and layout data, then maps the result into a Figma-ready JSON tree that the plugin can build into editable frames, text layers, fills, strokes, and effects.

## Highlights

- Converts local HTML into editable Figma layers.
- Uses Playwright/Chromium so layout is read from the browser, not guessed from raw markup.
- Preserves practical design details such as typography, fills, borders, radius, opacity, z-index order, and layout hints.
- Runs through a local converter service, keeping the Figma plugin lightweight.
- Includes deterministic snapshot tests for safer mapper and extractor changes.
- Supports local companion packaging for teams that do not want every designer to install Node.js.

## Flow

1. Playwright renders the HTML and captures computed styles.
2. The local pipeline resolves fonts, ordering, and Figma-ready layout data.
3. A local server returns Figma-ready JSON.
4. The Figma plugin builds the design from that JSON automatically.

## Quickstart

```bash
npm install
npx playwright install chromium
npm run server
```

Then in Figma:

1. Import `figma-plugin/manifest.json` as a development plugin.
2. Open the Morphus plugin.
3. Paste or upload HTML.
4. Click `Convert & Build`.

The plugin talks to the local converter at `http://localhost:3210`.

## Commands

```bash
npm run convert -- --input ./tests/landing-page/input.html --output ./out/landing-page.json
npm run server
npm run local:server
npm run converter:build
npm test
npm run snapshot:update
```

## CLI Conversion

Use the converter directly when you want to debug the browser extraction and mapper output without opening Figma:

```bash
npm run convert -- --input ./tests/landing-page/input.html --output ./out/landing-page.json
```

The generated JSON is the same intermediate representation consumed by the plugin.

## Figma Plugin

The plugin lives in `figma-plugin/`:

- `manifest.json` defines the Figma plugin entrypoints and allowed network domains.
- `ui.html` contains the plugin interface.
- `code.js` connects Figma to the converter and creates the final nodes.

During development, restart the plugin in Figma after editing `ui.html` or `code.js`.

## Project Checklist

See [docs/CHECKLIST.md](docs/CHECKLIST.md) for the list of completed project items.

## Public Use

To let other people use the plugin without running the local server, deploy the converter as a public HTTPS Node/Playwright service and update the plugin's converter URL. See [docs/deployment.md](docs/deployment.md).

## Internal Local App

For office/internal rollout, package Morphus Converter so each user runs the converter on their own laptop without installing Node.js. The default package is slim and uses the system browser; set `MORPHUS_BUNDLE_BROWSER=1` only when you need a fully offline Chromium bundle. GitHub Actions can build macOS DMGs, a self-extracting Windows EXE, and a Figma plugin zip for you, and macOS users can install through Homebrew Cask after a GitHub Release is published. See [docs/local-companion.md](docs/local-companion.md).

## Snapshot Test

`tests/landing-page/expected-snapshot.json` is the deterministic baseline for `tests/landing-page/input.html`.

## Project Layout

- `scripts/convert.js` CLI conversion
- `scripts/server.js` local bridge for the plugin
- `figma-plugin/` Figma UI and builder
- `src/` Playwright extraction and Figma mapping code
- `tests/landing-page/` fixture and snapshot

## Development Notes

Useful docs:

- [Documentation index](docs/INDEX.md)
- [Architecture](docs/architecture.md)
- [Converter API](docs/converter-api.md)
- [CSS to Figma mapping](docs/css-figma-mapping.md)
- [Development workflow](docs/development-workflow.md)
- [Deployment](docs/deployment.md)
- [Environment variables](docs/environment.md)
- [Fixture authoring](docs/fixture-authoring.md)
- [Local companion packaging](docs/local-companion.md)
- [Privacy and security](docs/privacy-security.md)
- [Release checklist](docs/release-checklist.md)
- [Testing guide](docs/testing.md)
- [Troubleshooting](docs/troubleshooting.md)

Before opening a PR, run the focused test suite for the area you changed, or run the full suite:

```bash
npm test
```
