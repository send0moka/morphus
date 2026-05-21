#!/usr/bin/env node
/**
 * Builds a portable Morphus Converter package for the current OS.
 *
 * Run this on macOS to produce the .dmg package, and on Windows to produce
 * a self-extracting .exe package. Playwright browsers are platform-specific, so
 * this script intentionally packages only the OS it is running on.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
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
import { build as esbuild } from 'esbuild';

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
const INCLUDE_BROWSER = getBooleanEnv('MORPHUS_BUNDLE_BROWSER', false);
const WINDOWS_SFX_MARKER = '\n--MORPHUS-CONVERTER-WINDOWS-SFX-PAYLOAD-v1-6F733B9D8A5B4E49--\n';

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

  await bundleAppSources(layout.appDir);
  if (INCLUDE_BROWSER) {
    installChromium(layout.appDir);
  }

  await installNodeRuntime(layout.runtimeDir);
  writeLauncher(layout);
  writePackageReadme(layout.readmeDir || layout.packageRoot, target);

  renameStage(stageDir, releaseDir);
  await createPackage(releaseDir, name, target);

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
    launcherPath: join(stageDir, 'Morphus Converter.exe'),
    debugLauncherPath: join(stageDir, 'Morphus Converter Debug.cmd'),
  };
}

async function bundleAppSources(appDir) {
  const outfile = join(appDir, 'local-companion.cjs');
  await esbuild({
    entryPoints: [resolve(ROOT, 'scripts', 'local-companion.js')],
    outfile,
    bundle: true,
    platform: 'node',
    target: `node${NODE_VERSION.split('.')[0]}`,
    format: 'cjs',
    minify: true,
    sourcemap: false,
    logLevel: 'info',
    external: [
      // Playwright resolves browser metadata relative to its package root.
      'playwright-core',
    ],
  });

  writeFileSync(join(appDir, 'package.json'), JSON.stringify({
    name: 'morphus-converter-runtime',
    version: PACKAGE.version || '0.1.0',
    private: true,
    type: 'commonjs',
    dependencies: {
      'playwright-core': PACKAGE.dependencies?.['playwright-core'] || `^${PLAYWRIGHT_VERSION}`,
    },
  }, null, 2), 'utf8');

  copyRuntimeDependency('playwright-core', appDir);
}

function copyRuntimeDependency(packageName, appDir) {
  const sourceDir = resolve(ROOT, 'node_modules', packageName);
  if (!existsSync(sourceDir)) {
    throw new Error(`Missing dependency ${packageName}. Run npm ci before building the package.`);
  }

  const targetDir = join(appDir, 'node_modules', packageName);
  cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => !shouldSkipRuntimeDependencyPath(source),
  });
}

function shouldSkipRuntimeDependencyPath(source) {
  const normalized = source.replace(/\\/g, '/');
  return /\/\.github(\/|$)/.test(normalized)
    || /\/docs(\/|$)/.test(normalized)
    || /\/types(\/|$)/.test(normalized)
    || /\/.*\.(md|markdown|map)$/i.test(normalized);
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
  copyNodeRuntime(extractedRoot, runtimeDir);
}

function copyNodeRuntime(extractedRoot, runtimeDir) {
  mkdirSync(runtimeDir, { recursive: true });
  if (target === 'windows') {
    cpSync(join(extractedRoot, 'node.exe'), join(runtimeDir, 'node.exe'));
  } else {
    const binDir = join(runtimeDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const nodePath = join(binDir, 'node');
    cpSync(join(extractedRoot, 'bin', 'node'), nodePath);
    chmodSync(nodePath, 0o755);
  }

  const licensePath = join(extractedRoot, 'LICENSE');
  if (existsSync(licensePath)) {
    cpSync(licensePath, join(runtimeDir, 'LICENSE'));
  }
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

  compileWindowsLauncher(layout);
  writeFileSync(layout.debugLauncherPath, getWindowsDebugLauncher(), 'utf8');
}

function compileWindowsLauncher(layout) {
  const sourcePath = join(OUT_DIR, '.cache', 'windows-launcher.cs');
  mkdirSync(dirname(sourcePath), { recursive: true });
  rmSync(layout.launcherPath, { force: true });
  writeFileSync(sourcePath, getWindowsLauncherSource(), 'utf8');
  run('powershell', [
    '-NoProfile',
    '-Command',
    [
      `$source = Get-Content -LiteralPath ${quotePowerShell(sourcePath)} -Raw;`,
      'Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms',
      `-OutputAssembly ${quotePowerShell(layout.launcherPath)} -OutputType WindowsApplication;`,
    ].join(' '),
  ]);
}

function getWindowsLauncherSource() {
  return `using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Program
{
  [STAThread]
  private static int Main()
  {
    try
    {
      string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
      SetEnv("HOST", "localhost");
      SetEnv("MORPHUS_PORT", "3210");
      SetEnv("MORPHUS_LOCAL_MODE", "1");
      SetEnv("MORPHUS_OPEN_STATUS_PAGE", "1");
      SetEnv("MORPHUS_IDLE_SHUTDOWN_MS", "0");
      ${getWindowsBrowserEnv()}

      string nodePath = Path.Combine(root, ".runtime", "node", "node.exe");
      string scriptPath = Path.Combine(root, "app", "local-companion.cjs");
      if (!File.Exists(nodePath) || !File.Exists(scriptPath))
      {
        MessageBox.Show("Morphus Converter files are incomplete. Please extract the package again.", "Morphus Converter", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
      }

      ProcessStartInfo startInfo = new ProcessStartInfo();
      startInfo.FileName = nodePath;
      startInfo.Arguments = QuoteArg(scriptPath);
      startInfo.WorkingDirectory = Path.Combine(root, "app");
      startInfo.UseShellExecute = false;
      startInfo.CreateNoWindow = true;
      startInfo.WindowStyle = ProcessWindowStyle.Hidden;
      Process.Start(startInfo);
      return 0;
    }
    catch (Exception error)
    {
      MessageBox.Show(error.Message, "Morphus Converter", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }

  private static void SetEnv(string name, string value)
  {
    Environment.SetEnvironmentVariable(name, value, EnvironmentVariableTarget.Process);
  }

  private static string QuoteArg(string value)
  {
    return "\\\"" + value.Replace("\\\"", "\\\\\\\"") + "\\\"";
  }
}
`;
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
${getMacBrowserEnv()}

exec "$RESOURCES/node/bin/node" "$RESOURCES/app/local-companion.cjs"
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
${getWindowsDebugBrowserEnv()}

"%ROOT%.runtime\\node\\node.exe" "%ROOT%app\\local-companion.cjs"
if errorlevel 1 (
  echo.
  echo Morphus Converter stopped with an error.
  pause
)
`;
}

function getMacBrowserEnv() {
  if (INCLUDE_BROWSER) {
    return 'export PLAYWRIGHT_BROWSERS_PATH="$RESOURCES/app/browsers"';
  }
  return `export MORPHUS_BROWSER_CHANNEL="${getDefaultBrowserChannel()}"`;
}

function getWindowsBrowserEnv() {
  if (INCLUDE_BROWSER) {
    return 'SetEnv("PLAYWRIGHT_BROWSERS_PATH", Path.Combine(root, "app", "browsers"));';
  }
  return `SetEnv("MORPHUS_BROWSER_CHANNEL", "${getDefaultBrowserChannel()}");`;
}

function getWindowsDebugBrowserEnv() {
  if (INCLUDE_BROWSER) {
    return 'set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%app\\browsers"';
  }
  return `set "MORPHUS_BROWSER_CHANNEL=${getDefaultBrowserChannel()}"`;
}

function getDefaultBrowserChannel() {
  return target === 'windows' ? 'msedge' : 'chrome';
}

function writePackageReadme(packageRoot, currentTarget) {
  const runtimeText = getRuntimeReadmeText(currentTarget);
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

${runtimeText}
`
    : `Morphus Converter for Windows
=============================

1. Open "Morphus Converter.exe". Windows may show this as "Morphus Converter" if file extensions are hidden.
2. A browser status page opens at http://localhost:3210. The converter runs in the background without a Command Prompt window.
3. Open the Morphus Figma plugin. The plugin will use http://localhost:3210 automatically.
4. When the plugin is closed, Morphus Converter stays idle in the background.
5. To pause conversion, open http://localhost:3210 and click "Shut Down Converter".
6. To enable conversion again, click "Run Converter" on the same status page.
7. If the background launcher is blocked, open "Morphus Converter Debug.cmd" to see the converter logs.

${runtimeText}
`;

  writeFileSync(join(packageRoot, 'README.txt'), text, 'utf8');
}

function getRuntimeReadmeText(currentTarget) {
  if (INCLUDE_BROWSER) {
    return 'This package includes its own Node runtime and Chromium browser. Users do not need to install Node.js.';
  }

  if (currentTarget === 'windows') {
    return 'This slim package includes its own Node runtime and uses the Microsoft Edge browser already included with Windows. Users do not need to install Node.js.';
  }

  return 'This slim package includes its own Node runtime and uses an installed Google Chrome browser. Users do not need to install Node.js.';
}

function renameStage(stageDir, releaseDir) {
  renameSync(stageDir, releaseDir);
}

async function createPackage(releaseDir, name, currentTarget) {
  if (currentTarget === 'macos') {
    const dmgPath = resolve(OUT_DIR, `${name}.dmg`);
    rmSync(dmgPath, { force: true });
    run('hdiutil', [
      'create',
      '-volname', 'Morphus Converter',
      '-srcfolder', releaseDir,
      '-ov',
      '-format', 'UDZO',
      dmgPath,
    ]);
    console.log(`Created ${dmgPath}`);
    return;
  }

  const oldZipPath = resolve(OUT_DIR, `${name}.zip`);
  rmSync(oldZipPath, { force: true });

  const payloadZipPath = join(OUT_DIR, '.cache', `${slug(name)}-payload.zip`);
  const exePath = resolve(OUT_DIR, `${name}.exe`);
  rmSync(payloadZipPath, { force: true });
  rmSync(exePath, { force: true });
  run('powershell', [
    '-NoProfile',
    '-Command',
    [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      `[System.IO.Compression.ZipFile]::CreateFromDirectory(${quotePowerShell(releaseDir)}, ${quotePowerShell(payloadZipPath)}, [System.IO.Compression.CompressionLevel]::Optimal, $false);`,
    ].join(' '),
  ]);
  await createWindowsSelfExtractingPackage(payloadZipPath, exePath, name);
  console.log(`Created ${exePath}`);
}

async function createWindowsSelfExtractingPackage(payloadZipPath, exePath, name) {
  const payloadSha256 = await sha256File(payloadZipPath);
  const sourcePath = join(OUT_DIR, '.cache', 'windows-self-extractor.cs');
  const stubPath = join(OUT_DIR, '.cache', 'windows-self-extractor.exe');
  const installSubdir = `${slug(name)}-v${slug(PACKAGE.version || '0.0.0')}-${payloadSha256.slice(0, 12)}`;

  writeFileSync(sourcePath, getWindowsSelfExtractorSource({ payloadSha256, installSubdir }), 'utf8');
  rmSync(stubPath, { force: true });
  run('powershell', [
    '-NoProfile',
    '-Command',
    [
      `$source = Get-Content -LiteralPath ${quotePowerShell(sourcePath)} -Raw;`,
      'Add-Type -TypeDefinition $source',
      '-ReferencedAssemblies System.Windows.Forms,System.IO.Compression.FileSystem,System.IO.Compression',
      `-OutputAssembly ${quotePowerShell(stubPath)} -OutputType WindowsApplication;`,
    ].join(' '),
  ]);

  copyFileSync(stubPath, exePath);
  appendFileSync(exePath, WINDOWS_SFX_MARKER, 'utf8');
  await appendFileFromPath(exePath, payloadZipPath);
}

function getWindowsSelfExtractorSource({ payloadSha256, installSubdir }) {
  return `using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Windows.Forms;

internal static class Program
{
  private const string PayloadMarker = ${csharpString(WINDOWS_SFX_MARKER)};
  private const string PayloadSha256 = ${csharpString(payloadSha256)};
  private const string InstallSubdir = ${csharpString(installSubdir)};

  [STAThread]
  private static int Main()
  {
    try
    {
      string installDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Morphus Converter",
        InstallSubdir
      );
      string launcherPath = Path.Combine(installDir, "Morphus Converter.exe");
      string stampPath = Path.Combine(installDir, ".payload.sha256");

      if (!IsInstalled(launcherPath, stampPath))
      {
        InstallPayload(installDir, stampPath);
      }

      ProcessStartInfo startInfo = new ProcessStartInfo();
      startInfo.FileName = launcherPath;
      startInfo.WorkingDirectory = installDir;
      startInfo.UseShellExecute = false;
      startInfo.CreateNoWindow = true;
      startInfo.WindowStyle = ProcessWindowStyle.Hidden;
      Process.Start(startInfo);
      return 0;
    }
    catch (Exception error)
    {
      MessageBox.Show(error.Message, "Morphus Converter", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return 1;
    }
  }

  private static bool IsInstalled(string launcherPath, string stampPath)
  {
    if (!File.Exists(launcherPath) || !File.Exists(stampPath))
    {
      return false;
    }

    try
    {
      return File.ReadAllText(stampPath).Trim().Equals(PayloadSha256, StringComparison.OrdinalIgnoreCase);
    }
    catch
    {
      return false;
    }
  }

  private static void InstallPayload(string installDir, string stampPath)
  {
    string tempDir = Path.Combine(Path.GetTempPath(), "MorphusConverter-" + PayloadSha256.Substring(0, 12));
    string payloadZipPath = Path.Combine(tempDir, "payload.zip");

    if (Directory.Exists(tempDir))
    {
      Directory.Delete(tempDir, true);
    }
    Directory.CreateDirectory(tempDir);

    WritePayloadZip(Application.ExecutablePath, payloadZipPath);

    if (Directory.Exists(installDir))
    {
      Directory.Delete(installDir, true);
    }
    Directory.CreateDirectory(installDir);

    ZipFile.ExtractToDirectory(payloadZipPath, installDir);
    File.WriteAllText(stampPath, PayloadSha256);

    try
    {
      Directory.Delete(tempDir, true);
    }
    catch
    {
    }
  }

  private static void WritePayloadZip(string selfPath, string payloadZipPath)
  {
    byte[] fileBytes = File.ReadAllBytes(selfPath);
    byte[] markerBytes = Encoding.UTF8.GetBytes(PayloadMarker);
    int markerIndex = LastIndexOf(fileBytes, markerBytes);
    if (markerIndex < 0)
    {
      throw new InvalidOperationException("Morphus Converter payload was not found. Please download the Windows EXE again.");
    }

    int payloadOffset = markerIndex + markerBytes.Length;
    byte[] payloadBytes = new byte[fileBytes.Length - payloadOffset];
    Buffer.BlockCopy(fileBytes, payloadOffset, payloadBytes, 0, payloadBytes.Length);
    File.WriteAllBytes(payloadZipPath, payloadBytes);
  }

  private static int LastIndexOf(byte[] source, byte[] pattern)
  {
    for (int index = source.Length - pattern.Length; index >= 0; index--)
    {
      bool matched = true;
      for (int patternIndex = 0; patternIndex < pattern.Length; patternIndex++)
      {
        if (source[index + patternIndex] != pattern[patternIndex])
        {
          matched = false;
          break;
        }
      }

      if (matched)
      {
        return index;
      }
    }

    return -1;
  }
}
`;
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

function normalizeArch(value) {
  if (value === 'x64') return 'x64';
  if (value === 'arm64') return 'arm64';
  throw new Error(`Unsupported CPU architecture: ${value}`);
}

function normalizeVersion(value) {
  return String(value || '').replace(/^[^\d]*/, '') || '1.60.0';
}

function getBooleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(value);
}

function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const input = createReadStream(path);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', rejectHash);
    input.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function appendFileFromPath(targetPath, sourcePath) {
  return new Promise((resolveAppend, rejectAppend) => {
    const input = createReadStream(sourcePath);
    const output = createWriteStream(targetPath, { flags: 'a' });
    let settled = false;

    function settle(error) {
      if (settled) return;
      settled = true;
      if (error) {
        rejectAppend(error);
      } else {
        resolveAppend();
      }
    }

    input.on('error', settle);
    output.on('error', settle);
    output.on('finish', () => settle());
    input.pipe(output);
  });
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function csharpString(value) {
  return JSON.stringify(String(value));
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
