# Public Deployment

Morphus cannot be deployed as a static-only site because the converter runs Node.js and Playwright/Chromium. To let other people use the Figma plugin without `npm run server`, deploy the converter as a public HTTPS Node service, then point the plugin to that service.

## 1. Deploy The Converter

Use a platform that supports long-running Node processes and Chromium/Playwright, for example a Docker-based service or VPS.

The included `Dockerfile` uses the official Playwright image and runs:

```bash
npm start
```

The server accepts the platform `PORT` environment variable and listens on `0.0.0.0`, so it can receive public traffic inside a container.

Required public endpoints:

```text
GET  /health
POST /jobs
GET  /jobs/:jobId
POST /convert
```

## 2. Update The Figma Plugin URL

After the service is live, replace the local default in `figma-plugin/code.js`:

```js
const DEFAULT_CONVERTER_URL = 'https://your-public-domain.example';
```

Then allow that domain in `figma-plugin/manifest.json`:

```json
"networkAccess": {
  "allowedDomains": [
    "https://your-public-domain.example"
  ],
  "devAllowedDomains": [
    "http://localhost:3210",
    "https://your-public-domain.example"
  ]
}
```

## 3. Publish Or Share The Plugin

For public use, publish the plugin through Figma Community. For team-only use, publish/share it privately in your organization.

## Production Notes

- Add rate limiting before making the endpoint public.
- Add request size limits appropriate for your plan and expected HTML files.
- Treat uploaded HTML as private user data.
- Keep `allowedDomains` narrow so Figma only permits the converter API domain.
- Tune converter capacity with environment variables:
  - `MORPHUS_MAX_CONCURRENT_JOBS=1` is safest for small/free CPU Spaces because each job starts Chromium.
  - `MORPHUS_MAX_QUEUED_JOBS=30` limits how many users can wait in line before the server returns 429.
  - `MORPHUS_RENDER_TIMEOUT_MS=120000` and `MORPHUS_JOB_TIMEOUT_MS=150000` prevent stuck renders from holding the server forever.
  - `MORPHUS_NAVIGATION_TIMEOUT_MS=15000` and `MORPHUS_NETWORK_IDLE_TIMEOUT_MS=5000` keep slow external assets from failing the whole conversion.

## References

- Figma plugin `networkAccess`: https://developers.figma.com/docs/plugins/manifest/#networkaccess
- Figma Community publishing: https://help.figma.com/hc/en-us/articles/360042293394-Publish-plugins-to-the-Figma-Community
- Playwright Docker: https://playwright.dev/docs/docker
