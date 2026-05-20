---
title: Morphus
sdk: docker
app_port: 7860
pinned: false
---

# Morphus

Morphus converts HTML into editable Figma designs with a local HTML-first flow.

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

Then in Figma: open the Morphus plugin, paste or upload HTML, and click `Convert & Build`.

## Commands
```bash
npm run convert -- --input ./tests/landing-page/input.html --output ./out/landing-page.json
npm run server
npm run local:server
npm run local-app:build
npm test
npm run snapshot:update
```

## Project Checklist
See [CHECKLIST.md](CHECKLIST.md) for the list of completed project items.

## Public Use
To let other people use the plugin without running the local server, deploy the converter as a public HTTPS Node/Playwright service and update the plugin's converter URL. See [docs/deployment.md](docs/deployment.md).

## Internal Local App
For office/internal rollout, package Morphus Local Companion so each user runs the converter on their own laptop without installing Node.js. GitHub Actions can build the macOS and Windows zips for you, so you do not need a MacBook locally. See [docs/local-companion.md](docs/local-companion.md).

## Snapshot Test
`tests/landing-page/expected-snapshot.json` is the deterministic baseline for `tests/landing-page/input.html`.

## Project Layout
- `scripts/convert.js` CLI conversion
- `scripts/server.js` local bridge for the plugin
- `figma-plugin/` Figma UI and builder
- `src/` Playwright extraction and Figma mapping code
- `tests/landing-page/` fixture and snapshot
