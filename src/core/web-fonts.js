import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { createFont, woff2 } from 'fonteditor-core';
import { walk } from './dom-tree.js';
import { WEIGHT_MAP } from '../utils/units.js';

const FONT_RESPONSE_TYPES = new Set(['font', 'other']);
const FONT_EXTENSIONS = new Set(['ttf', 'otf', 'woff', 'woff2']);
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

let woff2InitPromise = null;

export function createWebFontCollector(page) {
  const stylesheetPromises = [];
  const fontPromises = [];

  page.on('response', (response) => {
    const request = response.request();
    const headers = response.headers();
    const contentType = headers['content-type'] || '';
    const url = response.url();

    if (isStylesheetResponse(request, contentType, url)) {
      stylesheetPromises.push(response.text()
        .then((text) => ({ url, text }))
        .catch(() => null));
    }

    if (isFontResponse(request, contentType, url)) {
      fontPromises.push(response.body()
        .then((buffer) => ({
          url,
          buffer: Buffer.from(buffer),
          contentType,
          format: detectFontFormat(Buffer.from(buffer), url, contentType),
        }))
        .catch(() => null));
    }
  });

  return {
    async collectFromPage() {
      const [stylesheetResponses, fontResponses, pageFaces] = await Promise.all([
        Promise.all(stylesheetPromises),
        Promise.all(fontPromises),
        collectFontFacesFromPage(page),
      ]);

      const faces = [];
      for (const item of stylesheetResponses) {
        if (!item || !item.text) continue;
        faces.push(...extractFontFacesFromCss(item.text, item.url));
      }
      faces.push(...pageFaces);

      return {
        faces: dedupeFontFaces(faces),
        fontResponses: dedupeFontResponses(fontResponses.filter(Boolean)),
      };
    },
  };
}

export async function installWebFontsForDom(domTree, webFonts, options = {}) {
  const enabled = options.enabled ?? shouldInstallWebFonts();
  const summary = {
    enabled,
    supported: isFontInstallSupported(),
    installed: [],
    reused: [],
    skipped: [],
    errors: [],
  };

  if (!enabled || !summary.supported || !webFonts || !Array.isArray(webFonts.faces)) {
    return summary;
  }

  const requests = collectNeededFontRequests(domTree);
  const tasks = buildInstallTasks(requests, webFonts.faces);
  if (!tasks.length) {
    return summary;
  }

  const responseByUrl = new Map();
  for (const response of webFonts.fontResponses || []) {
    if (response && response.url && response.buffer) {
      responseByUrl.set(response.url, response);
    }
  }

  const target = getFontInstallTarget();
  mkdirSync(target.dir, { recursive: true });

  for (const task of tasks) {
    try {
      const source = await loadFontSource(task.face, responseByUrl);
      if (!source) {
        summary.skipped.push({ family: task.family, style: task.styleName, reason: 'source-unavailable' });
        continue;
      }

      const prepared = await prepareInstallableFont(source.buffer, {
        format: source.format,
        family: task.family,
        styleName: task.styleName,
      });
      if (!prepared) {
        summary.skipped.push({ family: task.family, style: task.styleName, reason: 'unsupported-format' });
        continue;
      }

      const hash = sha256(prepared.buffer).slice(0, 12);
      const fileName = `Morphus-${safeFileSegment(task.family)}-${safeFileSegment(task.styleName)}-${hash}.${prepared.extension}`;
      const fontPath = join(target.dir, fileName);
      const wasAlreadyPresent = existsSync(fontPath) && sha256(readFileSync(fontPath)) === sha256(prepared.buffer);

      if (!wasAlreadyPresent) {
        writeFileSync(fontPath, prepared.buffer);
      }

      if (target.platform === 'windows' && process.env.MORPHUS_SKIP_FONT_REGISTRATION !== '1') {
        registerWindowsFont(fontPath, task, prepared.extension);
      }

      const entry = {
        family: task.family,
        style: task.styleName,
        sourceUrl: source.url,
      };
      if (wasAlreadyPresent) {
        summary.reused.push(entry);
      } else {
        summary.installed.push(entry);
      }
    } catch (error) {
      summary.errors.push({
        family: task.family,
        style: task.styleName,
        message: error && error.message ? error.message : String(error),
      });
    }
  }

  return summary;
}

export function shouldInstallWebFonts() {
  const value = process.env.MORPHUS_INSTALL_WEB_FONTS;
  if (value !== undefined && value !== '') {
    return /^(1|true|yes|on)$/i.test(value);
  }

  return process.env.MORPHUS_LOCAL_MODE === '1' && process.env.NODE_ENV !== 'test';
}

export function extractFontFacesFromCss(cssText, baseUrl = '') {
  const text = stripCssComments(String(cssText || ''));
  const blocks = findFontFaceBlocks(text);
  const faces = [];

  for (const block of blocks) {
    const declarations = parseCssDeclarations(block);
    const family = unquoteCssValue(declarations['font-family']);
    const sources = parseFontSources(declarations.src, baseUrl);
    if (!family || sources.length === 0) {
      continue;
    }

    faces.push({
      family,
      style: normalizeFontStyle(declarations['font-style']),
      weight: normalizeFontWeightRange(declarations['font-weight']),
      stretch: declarations['font-stretch'] || '',
      unicodeRange: declarations['unicode-range'] || '',
      sources,
    });
  }

  return faces;
}

function isStylesheetResponse(request, contentType, url) {
  return request.resourceType() === 'stylesheet'
    || /\btext\/css\b/i.test(contentType)
    || /\.css(?:[?#]|$)/i.test(url);
}

function isFontResponse(request, contentType, url) {
  const resourceType = request.resourceType();
  const extension = getUrlExtension(url);
  return FONT_RESPONSE_TYPES.has(resourceType) && FONT_EXTENSIONS.has(extension)
    || /\bfont\//i.test(contentType)
    || /\bapplication\/(?:font|x-font|vnd\.ms-fontobject)/i.test(contentType)
    || FONT_EXTENSIONS.has(extension);
}

async function collectFontFacesFromPage(page) {
  try {
    const rules = await page.evaluate(() => {
      const result = [];

      function walkRules(ruleList, baseUrl) {
        for (const rule of Array.from(ruleList || [])) {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const style = rule.style;
            result.push({
              baseUrl,
              family: style.getPropertyValue('font-family'),
              style: style.getPropertyValue('font-style'),
              weight: style.getPropertyValue('font-weight'),
              stretch: style.getPropertyValue('font-stretch'),
              unicodeRange: style.getPropertyValue('unicode-range'),
              src: style.getPropertyValue('src'),
            });
            continue;
          }

          if (rule.cssRules) {
            walkRules(rule.cssRules, baseUrl);
          }
        }
      }

      for (const sheet of Array.from(document.styleSheets || [])) {
        try {
          walkRules(sheet.cssRules, sheet.href || document.baseURI);
        } catch (error) {
          // Cross-origin CSS can block cssRules access. Network response parsing covers most of it.
        }
      }

      return result;
    });

    return rules
      .map((rule) => ({
        family: unquoteCssValue(rule.family),
        style: normalizeFontStyle(rule.style),
        weight: normalizeFontWeightRange(rule.weight),
        stretch: rule.stretch || '',
        unicodeRange: rule.unicodeRange || '',
        sources: parseFontSources(rule.src, rule.baseUrl),
      }))
      .filter((face) => face.family && face.sources.length > 0);
  } catch (error) {
    return [];
  }
}

function dedupeFontFaces(faces) {
  const seen = new Set();
  const result = [];
  for (const face of faces) {
    const sourceKey = face.sources.map((source) => source.url).join(',');
    const key = [
      normalizeFamilyKey(face.family),
      face.style,
      face.weight.min,
      face.weight.max,
      sourceKey,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(face);
  }
  return result;
}

function dedupeFontResponses(responses) {
  const seen = new Set();
  const result = [];
  for (const response of responses) {
    if (!response || !response.url || seen.has(response.url)) continue;
    seen.add(response.url);
    result.push(response);
  }
  return result;
}

function collectNeededFontRequests(domTree) {
  const requests = new Map();

  walk(domTree, (node) => {
    addFontRequest(requests, node.computed);

    for (const run of node.textRuns || []) {
      addFontRequest(requests, run.computed);
    }

    for (const pseudo of [node.pseudo?.before, node.pseudo?.after]) {
      addFontRequest(requests, pseudo?.computed);
    }
  });

  return Array.from(requests.values());
}

function addFontRequest(requests, computed) {
  if (!computed || !computed.fontFamily) {
    return;
  }

  const stack = getFontFamilyStack(computed.fontFamily);
  const family = stack.find((name) => !GENERIC_FONT_FAMILIES.has(name.toLowerCase()));
  if (!family) {
    return;
  }

  const weight = normalizeRequestWeight(computed.fontWeight);
  const style = normalizeFontStyle(computed.fontStyle);
  const styleName = getFigmaStyleName(weight, style);
  const key = `${normalizeFamilyKey(family)}|${weight}|${style}`;
  if (!requests.has(key)) {
    requests.set(key, { family, weight, style, styleName });
  }
}

function buildInstallTasks(requests, faces) {
  const tasks = [];
  const seen = new Set();

  for (const request of requests) {
    const face = findMatchingFace(request, faces);
    if (!face) {
      continue;
    }

    const key = `${normalizeFamilyKey(request.family)}|${request.styleName}|${face.sources.map((source) => source.url).join(',')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tasks.push({ ...request, face });
  }

  return tasks;
}

function findMatchingFace(request, faces) {
  const requestFamily = normalizeFamilyKey(request.family);
  const exact = faces.find((face) => {
    return normalizeFamilyKey(face.family) === requestFamily
      && face.style === request.style
      && request.weight >= face.weight.min
      && request.weight <= face.weight.max;
  });
  if (exact) {
    return exact;
  }

  return faces.find((face) => {
    return normalizeFamilyKey(face.family) === requestFamily
      && face.style === request.style;
  }) || null;
}

async function loadFontSource(face, responseByUrl) {
  for (const source of face.sources) {
    const response = responseByUrl.get(source.url);
    if (response && response.buffer) {
      return {
        url: source.url,
        buffer: response.buffer,
        format: source.format || response.format,
      };
    }
  }

  for (const source of face.sources) {
    const downloaded = await downloadFontSource(source);
    if (downloaded) {
      return downloaded;
    }
  }

  return null;
}

async function downloadFontSource(source) {
  if (!source || !source.url) {
    return null;
  }

  if (source.url.startsWith('data:')) {
    const buffer = bufferFromDataUrl(source.url);
    return buffer ? { url: source.url, buffer, format: source.format || detectFontFormat(buffer, source.url, '') } : null;
  }

  if (source.url.startsWith('file:')) {
    const path = new URL(source.url);
    const buffer = readFileSync(path);
    return { url: source.url, buffer, format: source.format || detectFontFormat(buffer, source.url, '') };
  }

  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36',
    },
  });
  if (!response.ok) {
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    url: source.url,
    buffer,
    format: source.format || detectFontFormat(buffer, source.url, response.headers.get('content-type') || ''),
  };
}

async function prepareInstallableFont(buffer, { format, family, styleName }) {
  const sourceFormat = format || detectFontFormat(buffer, '', '');
  if (!sourceFormat || !FONT_EXTENSIONS.has(sourceFormat)) {
    return null;
  }

  if (sourceFormat === 'woff2') {
    await ensureWoff2Ready();
  }

  const font = createFont(buffer, {
    type: sourceFormat,
    hinting: true,
    kerning: true,
    inflate: sourceFormat === 'woff' ? (data) => inflateSync(data) : undefined,
  });

  patchFontNames(font, family, styleName);

  if (sourceFormat === 'otf') {
    return {
      buffer: Buffer.from(font.write({ type: 'ttf', hinting: true, kerning: true })),
      extension: 'ttf',
    };
  }

  if (sourceFormat === 'ttf') {
    return {
      buffer: Buffer.from(font.write({ type: 'ttf', hinting: true, kerning: true })),
      extension: 'ttf',
    };
  }

  return {
    buffer: Buffer.from(font.write({ type: 'ttf', hinting: true, kerning: true })),
    extension: 'ttf',
  };
}

function patchFontNames(font, family, styleName) {
  const data = font.get();
  if (!data.name) {
    data.name = {};
  }

  const postScriptName = `${family}-${styleName}`.replace(/[^A-Za-z0-9-]+/g, '');
  data.name.fontFamily = family;
  data.name.fontSubFamily = styleName;
  data.name.fullName = `${family} ${styleName}`;
  data.name.postScriptName = postScriptName || `MorphusFont-${sha256(Buffer.from(family + styleName)).slice(0, 8)}`;
  data.name.uniqueSubFamily = `Morphus;${data.name.postScriptName}`;
}

function ensureWoff2Ready() {
  if (!woff2InitPromise) {
    woff2InitPromise = woff2.init();
  }
  return woff2InitPromise;
}

function getFontInstallTarget() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return {
      platform: 'windows',
      dir: process.env.MORPHUS_WINDOWS_FONT_DIR || join(base, 'Microsoft', 'Windows', 'Fonts'),
    };
  }

  return {
    platform: 'macos',
    dir: process.env.MORPHUS_MACOS_FONT_DIR || join(homedir(), 'Library', 'Fonts'),
  };
}

function isFontInstallSupported() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function registerWindowsFont(fontPath, task, extension) {
  const registryKind = extension === 'otf' ? 'OpenType' : 'TrueType';
  const valueName = `${task.family} ${task.styleName} (${registryKind})`;
  const command = [
    '$ErrorActionPreference = "Stop";',
    '$fontKey = "HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";',
    'New-Item -Path $fontKey -Force | Out-Null;',
    `New-ItemProperty -Path $fontKey -Name ${quotePowerShell(valueName)} -Value ${quotePowerShell(fontPath)} -PropertyType String -Force | Out-Null;`,
    'Add-Type -TypeDefinition "using System; using System.Runtime.InteropServices; public static class NativeMethods { [DllImport(`"user32.dll`", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult); }";',
    '$result = [UIntPtr]::Zero;',
    '[NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x001D, [UIntPtr]::Zero, [IntPtr]::Zero, 0x0002, 1000, [ref]$result) | Out-Null;',
  ].join(' ');

  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    const message = result.stderr || result.stdout || 'Windows font registration failed.';
    throw new Error(message.trim());
  }
}

function detectFontFormat(buffer, url, contentType) {
  if (buffer && buffer.length >= 4) {
    const signature = buffer.subarray(0, 4).toString('latin1');
    if (signature === 'wOF2') return 'woff2';
    if (signature === 'wOFF') return 'woff';
    if (signature === 'OTTO') return 'otf';
    if (signature === '\x00\x01\x00\x00' || signature === 'true') return 'ttf';
  }

  if (/woff2/i.test(contentType)) return 'woff2';
  if (/woff/i.test(contentType)) return 'woff';
  if (/opentype|otf/i.test(contentType)) return 'otf';
  if (/truetype|ttf/i.test(contentType)) return 'ttf';

  return getUrlExtension(url);
}

function getUrlExtension(url) {
  try {
    const pathname = new URL(url, 'http://localhost/').pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  } catch (error) {
    return '';
  }
}

function parseFontSources(src, baseUrl) {
  const value = String(src || '');
  const sources = [];
  const urlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*(['"]?)(.*?)\3\s*\))?/gi;
  let match;

  while ((match = urlPattern.exec(value))) {
    const rawUrl = match[2];
    const format = normalizeFontFormat(match[4]) || getUrlExtension(rawUrl);
    const resolved = resolveCssUrl(rawUrl, baseUrl);
    if (!resolved) continue;
    sources.push({ url: resolved, format });
  }

  return sources;
}

function normalizeFontFormat(value) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'woff2') return 'woff2';
  if (normalized === 'woff') return 'woff';
  if (normalized === 'truetype' || normalized === 'ttf') return 'ttf';
  if (normalized === 'opentype' || normalized === 'otf') return 'otf';
  return '';
}

function resolveCssUrl(rawUrl, baseUrl) {
  const value = String(rawUrl || '').trim();
  if (!value || /^local\(/i.test(value)) {
    return '';
  }
  if (/^data:/i.test(value)) {
    return value;
  }
  try {
    return new URL(value, baseUrl || 'http://localhost/').href;
  } catch (error) {
    return '';
  }
}

function findFontFaceBlocks(cssText) {
  const blocks = [];
  const pattern = /@font-face\s*\{/gi;
  let match;

  while ((match = pattern.exec(cssText))) {
    let index = pattern.lastIndex;
    let depth = 1;
    let quote = '';

    for (; index < cssText.length; index++) {
      const char = cssText[index];
      const previous = cssText[index - 1];

      if (quote) {
        if (char === quote && previous !== '\\') {
          quote = '';
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (depth === 0) {
        blocks.push(cssText.slice(pattern.lastIndex, index));
        pattern.lastIndex = index + 1;
        break;
      }
    }
  }

  return blocks;
}

function parseCssDeclarations(block) {
  const declarations = {};
  for (const declaration of splitCssDeclarations(block)) {
    const colonIndex = declaration.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    const name = declaration.slice(0, colonIndex).trim().toLowerCase();
    const value = declaration.slice(colonIndex + 1).trim();
    if (name && value) {
      declarations[name] = value;
    }
  }
  return declarations;
}

function splitCssDeclarations(block) {
  const result = [];
  let current = '';
  let quote = '';
  let parenDepth = 0;

  for (let index = 0; index < block.length; index++) {
    const char = block[index];
    const previous = block[index - 1];

    if (quote) {
      current += char;
      if (char === quote && previous !== '\\') {
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') parenDepth++;
    if (char === ')') parenDepth = Math.max(parenDepth - 1, 0);

    if (char === ';' && parenDepth === 0) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    result.push(current);
  }

  return result;
}

function stripCssComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '');
}

function unquoteCssValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function getFontFamilyStack(cssFamily) {
  return String(cssFamily || '')
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function normalizeFamilyKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeFontStyle(value) {
  const style = String(value || 'normal').toLowerCase();
  return style.includes('italic') || style.includes('oblique') ? 'italic' : 'normal';
}

function normalizeRequestWeight(value) {
  const text = String(value || '400').toLowerCase();
  if (text.includes('bold')) return 700;
  if (text.includes('normal')) return 400;
  const match = text.match(/\d+/);
  const number = match ? Number.parseInt(match[0], 10) : 400;
  return clampWeight(number);
}

function normalizeFontWeightRange(value) {
  const text = String(value || '400').toLowerCase();
  if (text.includes('bold')) {
    return { min: 700, max: 700 };
  }
  if (text.includes('normal')) {
    return { min: 400, max: 400 };
  }

  const numbers = Array.from(text.matchAll(/\d+/g)).map((match) => clampWeight(Number.parseInt(match[0], 10)));
  if (numbers.length >= 2) {
    return { min: Math.min(numbers[0], numbers[1]), max: Math.max(numbers[0], numbers[1]) };
  }
  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0] };
  }
  return { min: 400, max: 400 };
}

function clampWeight(value) {
  if (!Number.isFinite(value)) return 400;
  return Math.min(Math.max(Math.round(value / 100) * 100, 100), 900);
}

function getFigmaStyleName(weight, style) {
  const base = WEIGHT_MAP[clampWeight(weight)] || 'Regular';
  if (style === 'italic') {
    return base === 'Regular' ? 'Italic' : `${base} Italic`;
  }
  return base;
}

function bufferFromDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i);
  if (!match) {
    return null;
  }
  const data = decodeURIComponent(match[3] || '');
  return match[2] ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf8');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeFileSegment(value) {
  return String(value || 'font')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'font';
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
