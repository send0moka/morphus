# Debugging Tips

This document collects common debugging techniques for the Morphus plugin,
converter, and local companion.

## Plugin Side (Figma)

### Open the Plugin Console

In Figma desktop: **Plugins → Development → Open Console**. All `console.log`
calls from both the plugin sandbox and the plugin UI appear here.

### Inspect postMessage Traffic

Add a temporary listener in the plugin UI to log every message:

```ts
window.addEventListener('message', (e) => {
  console.log('[UI←plugin]', JSON.stringify(e.data));
});
parent.postMessage({ pluginMessage: { __debug: true } }, '*');
```

### Reload the Plugin Without Restarting Figma

**Plugins → Development → [your plugin] → Run** re-loads the plugin bundle.
No need to restart Figma unless you changed the `manifest.json`.

## Converter Side (Node.js / TypeScript)

### Run a Single Fixture

```bash
node --loader ts-node/esm src/cli.ts convert tests/fixtures/button.html
```

Set `DEBUG=morphus:*` to enable verbose logging from all converter modules.

### Inspect Intermediate Output

Add a breakpoint after `buildTree()` in `src/converter/index.ts` to inspect
the intermediate node tree before it is serialized into Figma's API format.

### Source Maps

The companion is compiled with `"sourceMap": true`. Node.js respects source
maps in stack traces when run with `--enable-source-maps`:

```bash
node --enable-source-maps out/companion/server.js
```

## Companion Side (HTTP Server)

### Verbose Request Logging

Set `LOG_LEVEL=debug` to log every incoming request, matched route, and
response status code.

### Test Endpoints Directly

```bash
curl -X POST http://localhost:3000/convert \
  -H "X-Morphus-Token: <secret>" \
  -H "Content-Type: application/json" \
  -d '{"html":"<p>Hello</p>","css":""}'
```

### Check if the Companion Is Running

```bash
curl http://localhost:3000/health
# {"ok":true}
```

## Common Errors

| Error | Cause | Fix |
|---|---|---|
| `EADDRINUSE 3000` | Another process on port 3000 | Kill the process or change `PORT` |
| `401 Unauthorized` | Token mismatch | Check plugin settings match `MORPHUS_SECRET` |
| `Unexpected token '<'` | HTML returned instead of JSON | Companion returning HTML error page |
| Node names are `undefined` | Missing tag handler | Add handler in `src/converter/tags/` |

## Related Docs

- [Error handling](error-handling.md)
- [Troubleshooting](troubleshooting.md)
- [Local companion lifecycle](local-companion-lifecycle.md)
