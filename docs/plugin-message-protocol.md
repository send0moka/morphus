# Plugin Message Protocol

Morphus splits work between the plugin UI and the Figma plugin main thread.

## UI Responsibilities

- Collect pasted or uploaded HTML.
- Validate source input before conversion.
- Collect one or more viewport presets.
- Send conversion requests to the main thread.
- Render progress, errors, and completion states.

## Main Thread Responsibilities

- Check converter health.
- Submit jobs to the converter.
- Poll job status.
- Preload fonts.
- Build Figma nodes from the snapshot.
- Notify the UI when conversion completes or fails.

## Common Message Flow

```text
UI -> CONVERT_AND_BUILD
main -> PROGRESS
main -> DONE
```

Errors return as UI messages rather than thrown browser errors so the user can recover without closing the plugin.

## Multi-Viewport Flow

When several viewports are selected, the UI sends all selected viewport definitions in one payload. The main thread converts and builds each viewport in sequence, then places the resulting frames next to each other on the canvas.
