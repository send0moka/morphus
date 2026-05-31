# Converter API

Morphus exposes a small HTTP API used by the Figma plugin and local companion app.

## Health

```text
GET /health
```

Returns whether the converter is available.

Example response:

```json
{
  "ok": true,
  "running": true
}
```

## Create Conversion Job

```text
POST /jobs
```

Creates an asynchronous conversion job.

Example request:

```json
{
  "html": "<!doctype html><html><body>Hello</body></html>",
  "sourceName": "inline.html",
  "viewport": {
    "width": 1440,
    "height": 900
  }
}
```

Example response:

```json
{
  "jobId": "job-abc123"
}
```

## Read Conversion Job

```text
GET /jobs/:jobId
```

Returns conversion progress or the completed snapshot.

Running response:

```json
{
  "state": "running",
  "progress": 45,
  "message": "Rendering HTML"
}
```

Completed response:

```json
{
  "state": "done",
  "progress": 100,
  "result": {
    "version": "0.1.0",
    "meta": {
      "title": "Example"
    },
    "warnings": [],
    "figmaTree": []
  }
}
```

## Direct Conversion

```text
POST /convert
```

Runs conversion synchronously and returns the snapshot directly. This endpoint is useful for local debugging and small HTML inputs. The plugin uses `/jobs` so longer conversions can report progress and avoid request timeouts.

## Local Companion Heartbeat

```text
POST /heartbeat
```

The Figma plugin calls this endpoint while the plugin UI is open. The local companion uses it to stay idle when no designer is actively converting HTML.
