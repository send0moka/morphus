#!/usr/bin/env node
/**
 * Builds a portable Morphus Converter package for the current OS.
 *
 * Run this on macOS to produce the .app package, and on Windows to produce
 * the portable Windows folder. Playwright browsers are platform-specific, so
 * this script intentionally packages only the OS it is running on.
 */

import { createWriteStream } from 'node:fs';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { get } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'out', 'local-app');
const NODE_VERSION = (process.env.MORPHUS_LOCAL_NODE_VERSION || process.versions.node).replace(/^v/, '');
const PACKAGE = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const PLAYWRIGHT_VERSION = normalizeVersion(
  PACKAGE.devDependencies?.playwright
    || PACKAGE.dependencies?.playwright
    || PACKAGE.dependencies?.['playwright-core']
    || '1.60.0'
);

const target = getCurrentTarget();
const arch = normalizeArch(process.arch);

await main();

async function main() {
  if (!target) {
    throw new Error(`Unsupported platform for local app packaging: ${process.platform}`);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const name = target === 'macos'
    ? `Morphus Converter macOS ${arch}`
    : `Morphus Converter Windows ${arch}`;
  const stageDir = resolve(OUT_DIR, `${slug(name)}-stage`);
  const releaseDir = resolve(OUT_DIR, name);

  rmSync(stageDir, { recursive: true, force: true });
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  const layout = createLayout(stageDir, target);
  mkdirSync(layout.appDir, { recursive: true });
  mkdirSync(layout.runtimeDir, { recursive: true });

  copyAppSources(layout.appDir);
  installProductionDependencies(layout.appDir);
  installChromium(layout.appDir);

  await installNodeRuntime(layout.runtimeDir);
  writeLauncher(layout);
  writePackageReadme(layout.readmeDir || layout.packageRoot, target);

  renameStage(stageDir, releaseDir);
  createArchive(releaseDir, name, target);

  console.log(`Built ${releaseDir}`);
}

function getCurrentTarget() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return null;
}

function createLayout(stageDir, currentTarget) {
  if (currentTarget === 'macos') {
    const appRoot = join(stageDir, 'Morphus Converter.app');
    const contentsDir = join(appRoot, 'Contents');
    const resourcesDir = join(contentsDir, 'Resources');
    return {
      target: currentTarget,
      packageRoot: appRoot,
      readmeDir: stageDir,
      contentsDir,
      resourcesDir,
      appDir: join(resourcesDir, 'app'),
      runtimeDir: join(resourcesDir, 'node'),
      launcherPath: join(contentsDir, 'MacOS', 'Morphus Converter'),
      plistPath: join(contentsDir, 'Info.plist'),
    };
  }

  return {
    target: currentTarget,
    packageRoot: stageDir,
    appDir: join(stageDir, 'app'),
    runtimeDir: join(stageDir, '.runtime', 'node'),
    launcherPath: join(stageDir, 'Morphus Converter.vbs'),
    debugLauncherPath: join(stageDir, 'Morphus Converter Debug.cmd'),
  };
}

function copyAppSources(appDir) {
  const entries = [
    'package.json',
    'package-lock.json',
    'scripts',
    'src',
  ];

  for (const entry of entries) {
    const from = resolve(ROOT, entry);
    const to = join(appDir, entry);
    cpSync(from, to, {
      recursive: true,
      filter: (source) => !shouldSkipCopiedPath(source),
    });
  }
}

function shouldSkipCopiedPath(source) {
  const normalized = source.replace(/\\/g, '/');
  return /\/scripts\/build-local-app\.js$/.test(normalized);
}

function installProductionDependencies(appDir) {
  run(npmCommand(), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: appDir,
  });
}

function installChromium(appDir) {
  const browsersDir = join(appDir, 'browsers');
  mkdirSync(browsersDir, { recursive: true });

  run(npxCommand(), ['--yes', `playwright@${PLAYWRIGHT_VERSION}`, 'install', 'chromium'], {
    cwd: appDir,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersDir,
    },
  });
}

async function installNodeRuntime(runtimeDir) {
  const archiveName = getNodeArchiveName();
  const archivePath = join(OUT_DIR, '.cache', archiveName);
  const extractDir = join(OUT_DIR, '.cache', archiveName.replace(/\.(tar\.gz|zip)$/i, ''));
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${archiveName}`;

  mkdirSync(dirname(archivePath), { recursive: true });

  if (!existsSync(archivePath)) {
    console.log(`Downloading ${url}`);
    await download(url, archivePath);
  }

  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  run('tar', ['-xf', archivePath, '-C', extractDir]);

  const extractedRoot = findSingleDirectory(extractDir);
  copyDirectoryContents(extractedRoot, runtimeDir);
}

function getNodeArchiveName() {
  const platformName = target === 'windows' ? 'win' : 'darwin';
  const extension = target === 'windows' ? 'zip' : 'tar.gz';
  return `node-v${NODE_VERSION}-${platformName}-${arch}.${extension}`;
}

function writeLauncher(layout) {
  if (layout.target === 'macos') {
    mkdirSync(dirname(layout.launcherPath), { recursive: true });
    writeFileSync(layout.plistPath, getMacInfoPlist(), 'utf8');
    writeFileSync(layout.launcherPath, getMacLauncher(), 'utf8');
    chmodSync(layout.launcherPath, 0o755);
    return;
  }

  writeFileSync(layout.launcherPath, getWindowsBackgroundLauncher(), 'utf8');
  writeFileSync(layout.debugLauncherPath, getWindowsDebugLauncher(), 'utf8');
}

function getMacInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>Morphus Converter</string>
  <key>CFBundleIdentifier</key>
  <string>com.morphus.converter</string>
  <key>CFBundleName</key>
  <string>Morphus Converter</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${PACKAGE.version || '0.1.0'}</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
}

function getMacLauncher() {
  return `#!/bin/sh
set -eu

RESOURCES="$(cd "$(dirname "$0")/../Resources" && pwd)"
export HOST="localhost"
export MORPHUS_PORT="3210"
export MORPHUS_LOCAL_MODE="1"
export MORPHUS_OPEN_STATUS_PAGE="1"
export MORPHUS_IDLE_SHUTDOWN_MS="0"
export PLAYWRIGHT_BROWSERS_PATH="$RESOURCES/app/browsers"

exec "$RESOURCES/node/bin/node" "$RESOURCES/app/scripts/local-companion.js"
`;
}

function getWindowsBackgroundLauncher() {
  return `Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

Set env = shell.Environment("PROCESS")
env("HOST") = "localhost"
env("MORPHUS_PORT") = "3210"
env("MORPHUS_LOCAL_MODE") = "1"
env("MORPHUS_OPEN_STATUS_PAGE") = "1"
env("MORPHUS_IDLE_SHUTDOWN_MS") = "0"
env("PLAYWRIGHT_BROWSERS_PATH") = root & "\\app\\browsers"

nodePath = root & "\\.runtime\\node\\node.exe"
scriptPath = root & "\\app\\scripts\\local-companion.js"
command = Quote(nodePath) & " " & Quote(scriptPath)

shell.Run command, 0, False

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
`;
}

function getWindowsDebugLauncher() {
  return `@echo off
setlocal
set "ROOT=%~dp0"
set "HOST=localhost"
set "MORPHUS_PORT=3210"
set "MORPHUS_LOCAL_MODE=1"
set "MORPHUS_OPEN_STATUS_PAGE=1"
set "MORPHUS_IDLE_SHUTDOWN_MS=0"
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%app\\browsers"

"%ROOT%.runtime\\node\\node.exe" "%ROOT%app\\scripts\\local-companion.js"
if errorlevel 1 (
  echo.
  echo Morphus Converter stopped with an error.
  pause
)
`;
}

function writePackageReadme(packageRoot, currentTarget) {
  const text = currentTarget === 'macos'
    ? `Morphus Converter for macOS
============================

1. Move "Morphus Converter.app" to Applications or keep it in this folder.
2. Open "Morphus Converter.app".
3. If macOS blocks the app, right-click it and choose Open.
4. Open the Morphus Figma plugin. The plugin will use http://localhost:3210 automatically.
5. When the plugin is closed, Morphus Converter stays idle in the background.
6. To pause conversion, open http://localhost:3210 and click "Shut Down Converter".
7. To enable conversion again, click "Run Converter" on the same status page.

This package includes its own Node runtime and Chromium browser. Users do not need to install Node.js.
`
    : `Morphus Converter for Windows
=============================

1. Open "Morphus Converter.vbs". Windows may show this as "Morphus Converter" if file extensions are hidden.
2. A browser status page opens at http://localhost:3210. The converter runs in the background without a Command Prompt window.
3. Open the Morphus Figma plugin. The plugin will use http://localhost:3210 automatically.
4. When the plugin is closed, Morphus Converter stays idle in the background.
5. To pause conversion, open http://localhost:3210 and click "Shut Down Converter".
6. To enable conversion again, click "Run Converter" on the same status page.
7. If the background launcher is blocked, open "Morphus Converter Debug.cmd" to see the converter logs.

This package includes its own Node runtime and Chromium browser. Users do not need to install Node.js.
`;

  writeFileSync(join(packageRoot, 'README.txt'), text, 'utf8');
}

function renameStage(stageDir, releaseDir) {
  mkdirSync(releaseDir, { recursive: true });
  for (const inner of readdirSync(stageDir)) {
    cpSync(join(stageDir, inner), join(releaseDir, inner), { recursive: true });
  }
  rmSync(stageDir, { recursive: true, force: true });
}

function createArchive(releaseDir, name, currentTarget) {
  const zipPath = resolve(OUT_DIR, `${name}.zip`);
  rmSync(zipPath, { force: true });

  if (currentTarget === 'macos') {
    run('ditto', ['-c', '-k', '--sequesterRsrc', releaseDir, zipPath], {
      cwd: dirname(releaseDir),
    });
    console.log(`Created ${zipPath}`);
    return;
  }

  run('powershell', [
    '-NoProfile',
    '-Command',
    [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      `[System.IO.Compression.ZipFile]::CreateFromDirectory(${quotePowerShell(releaseDir)}, ${quotePowerShell(zipPath)}, [System.IO.Compression.CompressionLevel]::Optimal, $false);`,
    ].join(' '),
  ]);
  console.log(`Created ${zipPath}`);
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`);
  const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
  const result = isWindowsScript
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [command, ...args].map(quoteCmdArg).join(' ')], {
        stdio: 'inherit',
        ...options,
      })
    : spawnSync(command, args, {
        stdio: 'inherit',
        ...options,
      });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function download(url, targetPath) {
  return new Promise((resolveDownload, rejectDownload) => {
    const file = createWriteStream(targetPath);
    get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        rmSync(targetPath, { force: true });
        download(response.headers.location, targetPath).then(resolveDownload, rejectDownload);
        return;
      }

      if (response.statusCode !== 200) {
        file.close();
        rmSync(targetPath, { force: true });
        rejectDownload(new Error(`Download failed (${response.statusCode}): ${url}`));
        return;
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(resolveDownload);
      });
    }).on('error', (error) => {
      file.close();
      rmSync(targetPath, { force: true });
      rejectDownload(error);
    });
  });
}

function findSingleDirectory(parent) {
  const entries = readdirSync(parent)
    .map((entry) => join(parent, entry))
    .filter((entry) => statSync(entry).isDirectory());

  if (entries.length !== 1) {
    throw new Error(`Expected one extracted directory in ${parent}, found ${entries.length}.`);
  }

  return entries[0];
}

function copyDirectoryContents(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    cpSync(join(from, entry), join(to, entry), { recursive: true });
  }
}

function normalizeArch(value) {
  if (value === 'x64') return 'x64';
  if (value === 'arm64') return 'arm64';
  throw new Error(`Unsupported CPU architecture: ${value}`);
}

function normalizeVersion(value) {
  return String(value || '').replace(/^[^\d]*/, '') || '1.60.0';
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteCmdArg(value) {
  const text = String(value);
  if (!/[\s&()^|<>"]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}
