# Docker Guide

The Morphus local companion ships with a `Dockerfile` so you can run it without
installing Node.js directly.

## Prerequisites

- Docker Engine 24+ or Docker Desktop 4.x
- A running Figma desktop app (to receive converted assets)

## Build the Image

```bash
docker build -t morphus-companion:latest .
```

The Dockerfile copies only production dependencies and the compiled `out/`
directory so the image stays small.

## Run the Companion

```bash
docker run --rm \
  -p 3000:3000 \
  -e MORPHUS_SECRET=<your-secret> \
  morphus-companion:latest
```

The companion listens on port 3000 inside the container. Pass `--network host`
on Linux if the Figma plugin needs to reach `localhost:3000`.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MORPHUS_SECRET` | Yes | – | Shared secret validated on every request |
| `PORT` | No | `3000` | Port for the HTTP server |
| `LOG_LEVEL` | No | `info` | One of `debug`, `info`, `warn`, `error` |
| `MAX_BODY_SIZE` | No | `10mb` | Maximum request body size |

## Volume Mounts

If you want the companion to write converted assets to the host filesystem:

```bash
docker run --rm \
  -p 3000:3000 \
  -v "$(pwd)/output:/app/output" \
  -e MORPHUS_SECRET=<your-secret> \
  morphus-companion:latest
```

## Health Check

The container exposes `GET /health` which returns `{"ok":true}` when ready.
Docker's built-in health check polls this endpoint every 10 seconds.

## Multi-Stage Build Details

```dockerfile
# Build stage: compiles TypeScript
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage: copies only dist
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/out ./out
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "out/companion/server.js"]
```

## Related Docs

- [Deployment](deployment.md)
- [Environment variables](environment.md)
- [Local companion lifecycle](local-companion-lifecycle.md)
