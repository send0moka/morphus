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
npm run convert -- --input ./tests/vela/input.html --output ./out/vela.json
npm run server
npm test
npm run snapshot:update
```

## Project Checklist
See [CHECKLIST.md](CHECKLIST.md) for the list of completed project items.

## Public Use
To let other people use the plugin without running the local server, deploy the converter as a public HTTPS Node/Playwright service and update the plugin's converter URL. See [docs/deployment.md](docs/deployment.md).

## Snapshot Test
`tests/vela/expected-snapshot.json` is the deterministic baseline for `tests/vela/input.html`.

## Project Layout
- `scripts/convert.js` CLI conversion
- `scripts/server.js` local bridge for the plugin
- `figma-plugin/` Figma UI and builder
- `src/` Playwright extraction and Figma mapping code
- `tests/vela/` fixture and snapshot
