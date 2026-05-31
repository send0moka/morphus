# Local Companion Lifecycle

Morphus Converter can run as a local companion app so designers do not need to install Node.js.

## Startup

The companion starts a local HTTP server on `http://localhost:3210` by default. A browser status page may open so users can see whether conversion is running or paused.

## Active Conversion

When the Figma plugin is open, it sends heartbeat requests. The companion stays available while there is an active heartbeat or an active conversion job.

## Idle Mode

When no plugin heartbeat is active, the companion stays idle. It does not need to consume conversion capacity while nobody is using the plugin.

## Pause And Resume

Users can pause conversion from the local status page. Pausing should reject conversion requests clearly instead of falling back to a public service.

## Shutdown

The companion exits only when the user closes it, the OS stops it, or `MORPHUS_IDLE_SHUTDOWN_MS` is configured with a positive timeout.

## Development Tip

Stop the packaged companion before running the source converter, because both usually use port `3210`.
