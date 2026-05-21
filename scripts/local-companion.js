#!/usr/bin/env node
/**
 * Starts Morphus Converter as a local companion server.
 *
 * This entrypoint is used by the macOS/Windows portable launchers. It sets
 * local-safe defaults before loading the regular HTTP server.
 */

import { spawn } from 'node:child_process';
import { get } from 'node:http';

setDefaultEnv('HOST', 'localhost');
setDefaultEnv('MORPHUS_PORT', '3210');
setDefaultEnv('MORPHUS_LOCAL_MODE', '1');
setDefaultEnv('MORPHUS_MAX_CONCURRENT_JOBS', '1');
setDefaultEnv('MORPHUS_MAX_QUEUED_JOBS', '12');
setDefaultEnv('MORPHUS_IDLE_SHUTDOWN_MS', '0');
setDefaultEnv('MORPHUS_RENDER_TIMEOUT_MS', '120000');
setDefaultEnv('MORPHUS_JOB_TIMEOUT_MS', '150000');

const statusUrl = `http://localhost:${process.env.MORPHUS_PORT || '3210'}/`;
const healthUrl = `${statusUrl}health`;

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

async function main() {
  if (process.env.MORPHUS_OPEN_STATUS_PAGE === '1') {
    if (await isServerAlreadyRunning(healthUrl)) {
      openExternal(statusUrl);
      process.exit(0);
    }

    const timer = setTimeout(() => {
      openExternal(statusUrl);
    }, 800);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  await import('./server.js');
}

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

function isServerAlreadyRunning(url) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const request = get(url, (response) => {
      response.resume();
      settle(response.statusCode >= 200 && response.statusCode < 500);
    });

    request.setTimeout(400, () => {
      request.destroy();
      settle(false);
    });
    request.on('error', () => settle(false));
  });
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
