# Conversion Job Lifecycle

The converter supports asynchronous jobs so long-running HTML renders can report progress without blocking the plugin request.

## States

```text
queued -> running -> done
queued -> running -> error
```

## Queued

The server has accepted a job but has not started rendering it yet. Queue limits protect small machines from too many Chromium processes.

## Running

The converter is rendering HTML, extracting computed styles, resolving fonts, mapping nodes, and preparing the final snapshot.

The plugin polls `/jobs/:jobId` while the job is running and displays the latest message.

## Done

The job response includes the Figma-ready snapshot:

```json
{
  "state": "done",
  "result": {
    "figmaTree": []
  }
}
```

## Error

The job failed or timed out. Error responses should include a user-facing message and avoid logging raw submitted HTML.
