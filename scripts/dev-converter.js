#!/usr/bin/env node
/**
 * Starts the converter from this working tree for fast local testing.
 *
 * Unlike the packaged launcher, this always tries to bind localhost:3210 so
 * changes in src/ are used immediately. If the port is already taken, stop the
 * packaged Morphus Converter first.
 */

import { spawn } from 'node:child_process';

setDefaultEnv('HOST', 'localhost');
setDefaultEnv('MORPHUS_PORT', '3210');
setDefaultEnv('MORPHUS_LOCAL_MODE', '1');
setDefaultEnv('MORPHUS_MAX_CONCURRENT_JOBS', '1');
setDefaultEnv('MORPHUS_MAX_QUEUED_JOBS', '12');
setDefaultEnv('MORPHUS_IDLE_SHUTDOWN_MS', '0');
setDefaultEnv('MORPHUS_RENDER_TIMEOUT_MS', '120000');
setDefaultEnv('MORPHUS_JOB_TIMEOUT_MS', '150000');
setDefaultEnv('MORPHUS_INSTALL_WEB_FONTS', '1');

const statusUrl = `http://localhost:${process.env.MORPHUS_PORT || '3210'}/`;
const timer = setTimeout(() => openExternal(statusUrl), 800);
if (typeof timer.unref === 'function') {
  timer.unref();
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
    // Opening the status page is only a convenience.
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
