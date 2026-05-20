#!/usr/bin/env node
/**
 * Starts Morphus Converter as a local companion server.
 *
 * This entrypoint is used by the macOS/Windows portable launchers. It sets
 * local-safe defaults before loading the regular HTTP server.
 */

import { spawn } from 'node:child_process';

setDefaultEnv('HOST', 'localhost');
setDefaultEnv('MORPHUS_PORT', '3210');
setDefaultEnv('MORPHUS_LOCAL_MODE', '1');
setDefaultEnv('MORPHUS_MAX_CONCURRENT_JOBS', '1');
setDefaultEnv('MORPHUS_MAX_QUEUED_JOBS', '12');
setDefaultEnv('MORPHUS_IDLE_SHUTDOWN_MS', '90000');
setDefaultEnv('MORPHUS_RENDER_TIMEOUT_MS', '120000');
setDefaultEnv('MORPHUS_JOB_TIMEOUT_MS', '150000');

const statusUrl = `http://localhost:${process.env.MORPHUS_PORT || '3210'}/`;

if (process.env.MORPHUS_OPEN_STATUS_PAGE === '1') {
  const timer = setTimeout(() => {
    openExternal(statusUrl);
  }, 800);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
}

await import('./server.js');

function setDefaultEnv(name, value) {
  if (!process.env[name]) {
    process.env[name] = value;
  }
}

function openExternal(url) {
  const command = getOpenCommand(url);
  if (!command) {
    return;
  }

  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    // Opening the status page is only a convenience; the server can run without it.
  }
}

function getOpenCommand(url) {
  if (process.platform === 'darwin') {
    return { file: 'open', args: [url] };
  }
  if (process.platform === 'win32') {
    return { file: 'cmd', args: ['/c', 'start', '', url] };
  }
  if (process.platform === 'linux') {
    return { file: 'xdg-open', args: [url] };
  }
  return null;
}
