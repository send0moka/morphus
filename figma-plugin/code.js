/**
 * figma-plugin/code.js
 * Figma Plugin main thread - receives HTML or JSON and creates Figma nodes.
 */

const DEFAULT_CONVERTER_URL = 'http://localhost:3210';
// const DEFAULT_CONVERTER_URL = 'https://jehian-tempelhtml.hf.space';
const BENCHMARK_URL = 'https://figmaeval.vercel.app';

figma.showUI(__html__, { width: 420, height: 490 });

const DEFAULT_VIEWPORT = { name: 'desktop', label: 'Desktop', width: 1440, height: 900 };

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'BUILD') {
      await buildFromSnapshot(msg.data);
      return;
    }

    if (msg.type === 'OPEN_BENCHMARK') {
      openBenchmark();
      return;
    }

    if (msg.type === 'CONVERT_AND_BUILD') {
      await convertAndBuild(msg.payload);
    }
  } catch (err) {
    const message = formatErrorForDisplay(err);
    figma.ui.postMessage({ type: 'ERROR', message });
    console.error('[Morphus]', message, err && err.stack ? err.stack : err);
  }
};

function formatErrorForDisplay(err) {
  if (!err) {
    return 'Unknown Morphus error.';
  }
  if (err.message) {
    return err.message;
  }
  return String(err);
}

async function convertAndBuild(payload) {
  const serverUrl = payload.serverUrl || DEFAULT_CONVERTER_URL;
  const viewports = normalizePayloadViewports(payload);

  progress('Checking converter...', 1);
  await ensureConverterReady(serverUrl);

  if (viewports.length > 1) {
    await convertAndBuildViewports(serverUrl, payload, viewports);
    return;
  }

  progress('Uploading HTML to converter...', 2);
  const result = await convertViewport(serverUrl, payload, viewports[0], null);
  await buildFromSnapshot(withClientSnapshotMeta(result, payload));
}

async function convertAndBuildViewports(serverUrl, payload, viewports) {
  let nodeCount = 0;
  const styleCounts = { paint: 0, text: 0 };

  for (let index = 0; index < viewports.length; index++) {
    const viewport = viewports[index];
    const scopedProgress = (text, percent) => {
      progress(
        `${viewport.label}: ${text}`,
        scaleMultiViewportProgress(index, viewports.length, percent)
      );
    };

    scopedProgress('Uploading HTML to converter...', 2);
    const result = await convertViewport(serverUrl, payload, viewport, scopedProgress);
    const stats = await buildFromSnapshot(
      withClientSnapshotMeta(result, Object.assign({}, payload, {
        viewport,
        viewportLabel: viewport.label,
      })),
      {
        notify: false,
        postDone: false,
        progressLabel: viewport.label,
        onProgress: scopedProgress,
      }
    );

    nodeCount += stats.nodeCount;
    styleCounts.paint += stats.styles.paint;
    styleCounts.text += stats.styles.text;
  }

  progress('Done.', 100);
  figma.ui.postMessage({
    type: 'DONE',
    nodeCount,
    styles: styleCounts,
    variants: viewports.length,
  });
  figma.notify(`Morphus: ${viewports.length} viewports, ${nodeCount} nodes built`);
}

async function convertViewport(serverUrl, payload, viewport, onProgress) {
  const response = await fetch(getJobStartUrl(serverUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: payload.html,
      sourceName: payload.sourceName || 'inline.html',
      baseUrl: payload.baseUrl || null,
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
    }),
  });

  if (!response.ok) {
    let message = `Converter request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body && body.error) message = body.error;
    } catch (err) {}
    throw new Error(message);
  }

  const started = await response.json();
  if (!started || !started.jobId) {
    throw new Error('Conversion server did not return a job id.');
  }

  if (onProgress) {
    onProgress('Job queued. Rendering page...', 3);
  } else {
    progress('Job queued. Rendering page...', 3);
  }
  return waitForJob(serverUrl, started.jobId, onProgress);
}

function normalizePayloadViewports(payload) {
  const sourcePayload = payload || {};
  const rawViewports = Array.isArray(sourcePayload.viewports) && sourcePayload.viewports.length > 0
    ? sourcePayload.viewports
    : [sourcePayload.viewport || DEFAULT_VIEWPORT];

  const viewports = rawViewports
    .map((viewport, index) => normalizeViewportSpec(viewport, index))
    .filter(Boolean);

  return viewports.length > 0 ? viewports : [DEFAULT_VIEWPORT];
}

function normalizeViewportSpec(viewport, index) {
  const source = viewport || {};
  const width = Number.parseInt(source.width !== undefined ? source.width : DEFAULT_VIEWPORT.width, 10);
  const height = Number.parseInt(source.height !== undefined ? source.height : DEFAULT_VIEWPORT.height, 10);
  const name = normalizeViewportName(source.name || source.id || source.label || `viewport-${index + 1}`);
  const label = normalizeViewportLabel(source.label || source.name || source.id || `Viewport ${index + 1}`);

  return {
    name,
    label,
    width: Number.isFinite(width) && width > 0 ? width : DEFAULT_VIEWPORT.width,
    height: Number.isFinite(height) && height > 0 ? height : DEFAULT_VIEWPORT.height,
  };
}

function normalizeViewportName(value) {
  return String(value || 'viewport')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'viewport';
}

function normalizeViewportLabel(value) {
  const label = String(value || '').replace(/\s+/g, ' ').trim();
  if (!label) {
    return 'Viewport';
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function scaleMultiViewportProgress(index, total, percent) {
  const safeTotal = Math.max(total || 1, 1);
  const safePercent = Number.isFinite(percent) ? Math.max(Math.min(percent, 100), 0) : 0;
  return Math.round(((index * 100) + safePercent) / safeTotal);
}

function openBenchmark() {
  if (typeof figma.openExternal === 'function') {
    figma.openExternal(BENCHMARK_URL);
    return;
  }

  figma.ui.postMessage({
    type: 'ERROR',
    message: `Open ${BENCHMARK_URL} in your browser.`,
  });
}

async function ensureConverterReady(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  try {
    const response = await fetch(`${normalized}/health`);
    if (!response.ok) {
      throw new Error(`Health check failed (${response.status})`);
    }
  } catch (err) {
    throw new Error(`Converter is not reachable at ${normalized}. If this is the public service, wait for it to wake up and try again.`);
  }
}

async function buildFromSnapshot(data, options = {}) {
  const figmaTree = data.figmaTree || [];
  const warnings = data.warnings || [];
  const styleNamespace = resolveStyleNamespace(data);
  const viewportLabel = options.viewportLabel || (data.meta && data.meta.viewportLabel) || '';

  for (const warning of warnings) {
    reportProgress(options, `Warning: ${warning}`);
  }

  await ensureCurrentPageLoaded();

  reportProgress(options, 'Pre-loading fonts...', 91);
  await preloadFonts(figmaTree);

  reportProgress(options, 'Creating local styles...', 94);
  const styleRegistry = await createLocalStylesFromTree(figmaTree, styleNamespace);

  reportProgress(options, 'Building nodes...', 96);
  let nodeCount = 0;
  const page = figma.currentPage;

  for (const nodeSpec of figmaTree) {
    const node = await buildNode(nodeSpec, 'NONE', styleRegistry);
    if (node) {
      if (viewportLabel) {
        node.name = `${viewportLabel} - ${node.name}`;
      }
      page.appendChild(node);
      nodeCount++;
    }
  }

  layoutTopLevelNodes(page);

  reportProgress(options, 'Done.', 100);

  const stats = { nodeCount: nodeCount, styles: styleRegistry.counts };
  if (options.postDone !== false) {
    figma.ui.postMessage({ type: 'DONE', nodeCount: nodeCount, styles: styleRegistry.counts });
  }
  if (options.notify !== false) {
    figma.notify(`Morphus: ${nodeCount} nodes, ${styleRegistry.counts.paint + styleRegistry.counts.text} styles synced`);
  }
  return stats;
}

async function ensureCurrentPageLoaded() {
  if (!figma.currentPage || typeof figma.currentPage.loadAsync !== 'function') {
    return;
  }

  try {
    await figma.currentPage.loadAsync();
  } catch (err) {}
}

function progress(text, percent) {
  figma.ui.postMessage({ type: 'PROGRESS', text: text, percent: percent });
}

function reportProgress(options, text, percent) {
  if (options && typeof options.onProgress === 'function') {
    options.onProgress(text, percent);
    return;
  }
  progress(options && options.progressLabel ? `${options.progressLabel}: ${text}` : text, percent);
}

function withClientSnapshotMeta(snapshot, payload) {
  const result = snapshot || {};
  const meta = Object.assign({}, result.meta || {});
  const title = normalizeDocumentTitle(meta.title) || extractTitleFromHtml(payload && payload.html);

  if (title) {
    meta.title = title;
  }

  if (payload && payload.viewportLabel) {
    meta.viewportLabel = payload.viewportLabel;
  }
  if (payload && payload.viewport) {
    meta.viewport = {
      width: payload.viewport.width,
      height: payload.viewport.height,
    };
  }

  return Object.assign({}, result, { meta });
}

function resolveStyleNamespace(snapshot) {
  const meta = snapshot && snapshot.meta ? snapshot.meta : {};
  const title = normalizeDocumentTitle(meta.title || meta.documentTitle || meta.pageTitle);
  if (!title) {
    return DEFAULT_STYLE_NAMESPACE;
  }
  return sanitizeStyleSegment(title);
}

function extractTitleFromHtml(html) {
  const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return '';
  }
  return normalizeDocumentTitle(decodeHtmlEntities(match[1].replace(/<[^>]*>/g, ' ')));
}

function normalizeDocumentTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (match, code) => {
      const number = Number.parseInt(code, 10);
      return isValidCodePoint(number) ? String.fromCodePoint(number) : match;
    })
    .replace(/&#x([a-fA-F\d]+);/g, (match, code) => {
      const number = Number.parseInt(code, 16);
      return isValidCodePoint(number) ? String.fromCodePoint(number) : match;
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function isValidCodePoint(number) {
  return Number.isFinite(number) && number >= 0 && number <= 0x10ffff;
}

// Font pre-loading

async function preloadFonts(nodes) {
  const availableByFamily = await listAvailableFontsByFamily();
  const cache = {};

  async function resolveFontName(font) {
    const fallback = { family: 'Inter', style: 'Regular' };
    const requested = normalizeFontName(font) || fallback;
    const key = JSON.stringify(requested);

    if (cache[key]) {
      return cache[key];
    }

    cache[key] = loadBestAvailableFont(requested, availableByFamily)
      .catch(function () {
        return fallback;
      });

    return cache[key];
  }

  await resolveFontName({ family: 'Inter', style: 'Regular' });

  for (const node of nodes) {
    await normalizeNodeFonts(node, resolveFontName);
  }
}

async function normalizeNodeFonts(node, resolveFontName) {
  if (node.type === 'TEXT') {
    node.fontName = await resolveFontName(node.fontName || { family: 'Inter', style: 'Regular' });
  } else if (node.fontName) {
    node.fontName = await resolveFontName(node.fontName);
  }

  const textRuns = node.textRuns || [];
  for (let index = 0; index < textRuns.length; index++) {
    if (textRuns[index] && textRuns[index].fontName) {
      textRuns[index].fontName = await resolveFontName(textRuns[index].fontName);
    }
  }

  const children = node.children || [];
  for (let index = 0; index < children.length; index++) {
    await normalizeNodeFonts(children[index], resolveFontName);
  }
}

async function listAvailableFontsByFamily() {
  try {
    const fonts = await figma.listAvailableFontsAsync();
    const byFamily = {};

    for (let index = 0; index < fonts.length; index++) {
      const raw = fonts[index];
      const font = raw && raw.fontName ? raw.fontName : raw;
      if (!font || !font.family || !font.style) {
        continue;
      }

      if (!byFamily[font.family]) {
        byFamily[font.family] = [];
      }

      byFamily[font.family].push({
        family: font.family,
        style: font.style,
      });
    }

    return byFamily;
  } catch (err) {
    return {};
  }
}

async function loadBestAvailableFont(requested, availableByFamily) {
  const candidates = buildFontCandidateList(requested, availableByFamily);

  for (let index = 0; index < candidates.length; index++) {
    try {
      await figma.loadFontAsync(candidates[index]);
      return candidates[index];
    } catch (err) {}
  }

  const fallback = { family: 'Inter', style: 'Regular' };
  await figma.loadFontAsync(fallback);
  return fallback;
}

function buildFontCandidateList(requested, availableByFamily) {
  const candidates = [];
  const families = [requested.family, 'Inter'];

  for (let familyIndex = 0; familyIndex < families.length; familyIndex++) {
    const family = families[familyIndex];
    const pool = availableByFamily[family] || [];
    if (!pool.length) {
      continue;
    }

    const exact = findExactFont(pool, requested.style);
    if (exact) {
      pushUniqueFont(candidates, exact);
    }

    const bestMatch = findClosestFont(pool, requested.style);
    if (bestMatch) {
      pushUniqueFont(candidates, bestMatch);
    }

    const italicMatch = findExactFont(pool, 'Italic');
    if (italicMatch) {
      pushUniqueFont(candidates, italicMatch);
    }

    const regularMatch = findExactFont(pool, 'Regular');
    if (regularMatch) {
      pushUniqueFont(candidates, regularMatch);
    }
  }

  pushUniqueFont(candidates, { family: 'Inter', style: 'Regular' });
  return candidates;
}

function pushUniqueFont(target, font) {
  const key = JSON.stringify(font);
  for (let index = 0; index < target.length; index++) {
    if (JSON.stringify(target[index]) === key) {
      return;
    }
  }
  target.push(font);
}

function findExactFont(pool, style) {
  for (let index = 0; index < pool.length; index++) {
    if (pool[index].style === style) {
      return pool[index];
    }
  }
  return null;
}

function findClosestFont(pool, requestedStyle) {
  if (!pool.length) {
    return null;
  }

  const targetItalic = isItalicStyle(requestedStyle);
  const sameItalic = [];
  for (let index = 0; index < pool.length; index++) {
    if (isItalicStyle(pool[index].style) === targetItalic) {
      sameItalic.push(pool[index]);
    }
  }

  const candidates = sameItalic.length ? sameItalic : pool;
  let best = candidates[0];
  let bestScore = fontDistance(requestedStyle, candidates[0].style);

  for (let index = 1; index < candidates.length; index++) {
    const score = fontDistance(requestedStyle, candidates[index].style);
    if (score < bestScore) {
      best = candidates[index];
      bestScore = score;
    }
  }

  return best;
}

function fontDistance(targetStyle, candidateStyle) {
  const italicPenalty = isItalicStyle(targetStyle) === isItalicStyle(candidateStyle) ? 0 : 500;
  return Math.abs(fontWeightFromStyle(targetStyle) - fontWeightFromStyle(candidateStyle)) + italicPenalty;
}

function fontWeightFromStyle(style) {
  const normalized = String(style || '').replace(/\s+Italic$/i, '').trim();
  const map = {
    Thin: 100,
    ExtraLight: 200,
    Light: 300,
    Regular: 400,
    Medium: 500,
    SemiBold: 600,
    Bold: 700,
    ExtraBold: 800,
    Black: 900,
  };

  return map[normalized] || 400;
}

function isItalicStyle(style) {
  return /italic/i.test(String(style || ''));
}

function normalizeFontName(font) {
  if (!font || !font.family) {
    return null;
  }

  return {
    family: font.family,
    style: font.style || 'Regular',
  };
}

// Local style creation

const DEFAULT_STYLE_NAMESPACE = 'Morphus';

async function createLocalStylesFromTree(nodes, styleNamespace = DEFAULT_STYLE_NAMESPACE) {
  const catalog = buildLocalStyleCatalog(nodes || [], styleNamespace);
  const paintByKey = {};
  const textByKey = {};

  const localPaintStyles = await getLocalStylesSafe('paint');
  const localTextStyles = await getLocalStylesSafe('text');
  pruneGeneratedStyles(localPaintStyles, catalog.paintStyles, styleNamespace);
  pruneGeneratedStyles(localTextStyles, catalog.textStyles, styleNamespace);

  if (typeof figma.createPaintStyle === 'function') {
    for (const def of catalog.paintStyles) {
      const styleId = ensurePaintStyle(def, localPaintStyles);
      if (styleId) {
        paintByKey[def.key] = styleId;
      }
    }
  }

  if (typeof figma.createTextStyle === 'function') {
    for (const def of catalog.textStyles) {
      const styleId = await ensureTextStyle(def, localTextStyles);
      if (styleId) {
        textByKey[def.key] = styleId;
      }
    }
  }

  return {
    paint: paintByKey,
    text: textByKey,
    counts: {
      paint: Object.keys(paintByKey).length,
      text: Object.keys(textByKey).length,
    },
  };
}

function buildLocalStyleCatalog(nodes, styleNamespace = DEFAULT_STYLE_NAMESPACE) {
  const paintMap = {};
  const textMap = {};

  function walk(spec) {
    if (!spec) {
      return;
    }

    const seenPaintKeys = new Set();
    const seenTextKeys = new Set();

    collectPaintDefinition(paintMap, spec.fills, getPaintUsage(spec, 'fill'), seenPaintKeys);
    collectPaintDefinition(paintMap, spec.strokes, getPaintUsage(spec, 'stroke'), seenPaintKeys);

    if (spec.type === 'TEXT') {
      collectTextDefinition(textMap, spec, seenTextKeys);

      const textRuns = spec.textRuns || [];
      for (let index = 0; index < textRuns.length; index++) {
        const run = textRuns[index];
        collectTextDefinition(textMap, run, seenTextKeys);
        collectPaintDefinition(paintMap, run && run.fills, 'text fill', seenPaintKeys);
        collectPaintDefinition(paintMap, run && run.strokes, 'text stroke', seenPaintKeys);
      }
    }

    const children = spec.children || [];
    for (let index = 0; index < children.length; index++) {
      walk(children[index]);
    }
  }

  for (let index = 0; index < nodes.length; index++) {
    walk(nodes[index]);
  }

  const paintStyles = Object.keys(paintMap).map((key) => paintMap[key]);
  const textStyles = Object.keys(textMap).map((key) => textMap[key]);
  const reusablePaintStyles = paintStyles.filter(isReusableLocalStyleDefinition);
  const reusableTextStyles = textStyles.filter(isReusableLocalStyleDefinition);

  assignPaintStyleNames(reusablePaintStyles, styleNamespace);
  assignTextStyleNames(reusableTextStyles, styleNamespace);

  return { paintStyles: reusablePaintStyles, textStyles: reusableTextStyles };
}

function collectPaintDefinition(map, paints, usage, seenKeys = null) {
  const key = makePaintStyleKey(paints);
  if (!key) {
    return;
  }

  if (!map[key]) {
    map[key] = {
      key,
      paints: cloneValue(paints),
      usages: {},
      count: 0,
    };
  }

  map[key].usages[usage] = (map[key].usages[usage] || 0) + 1;
  if (!seenKeys || !seenKeys.has(key)) {
    map[key].count++;
    if (seenKeys) {
      seenKeys.add(key);
    }
  }
}

function collectTextDefinition(map, spec, seenKeys = null) {
  const style = normalizeTextStyleInput(spec);
  if (!style) {
    return;
  }

  const key = makeTextStyleKey(style);
  if (!map[key]) {
    map[key] = {
      key,
      count: 0,
      fontName: style.fontName,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textCase: style.textCase,
    };
  }

  if (!seenKeys || !seenKeys.has(key)) {
    map[key].count++;
    if (seenKeys) {
      seenKeys.add(key);
    }
  }
}

function isReusableLocalStyleDefinition(def) {
  return Boolean(def && def.count > 1);
}

function pruneGeneratedStyles(localStyles, defs, styleNamespace = DEFAULT_STYLE_NAMESPACE) {
  if (!Array.isArray(localStyles) || localStyles.length === 0) {
    return;
  }

  const keep = new Set();
  for (let index = 0; index < (defs || []).length; index++) {
    const def = defs[index];
    if (def && def.name) {
      keep.add(def.name);
    }
  }

  for (let index = 0; index < localStyles.length; index++) {
    const style = localStyles[index];
    if (!style || !style.name) {
      continue;
    }

    if (!style.name.startsWith(`${styleNamespace} / `)) {
      continue;
    }

    if (keep.has(style.name)) {
      continue;
    }

    try {
      if (typeof style.remove === 'function') {
        style.remove();
      }
    } catch (err) {}
  }
}

function getPaintUsage(spec, kind) {
  if (kind === 'stroke') {
    return spec && spec.type === 'TEXT' ? 'text stroke' : 'border';
  }

  return spec && spec.type === 'TEXT' ? 'text fill' : 'background fill';
}

function makePaintStyleKey(paints) {
  if (!Array.isArray(paints) || paints.length === 0) {
    return null;
  }

  if (!isStylablePaintList(paints) || paints.every(isFullyTransparentPaint)) {
    return null;
  }

  const parts = [];
  for (let index = 0; index < paints.length; index++) {
    parts.push(normalizePaintForKey(paints[index]));
  }
  return `paint:${parts.join('|')}`;
}

function isStylablePaintList(paints) {
  for (let index = 0; index < paints.length; index++) {
    const paint = paints[index];
    if (!paint || paint.visible === false) {
      continue;
    }
    if (paint.type !== 'SOLID' && !isGradientPaint(paint)) {
      return false;
    }
  }
  return true;
}

function normalizePaintForKey(paint) {
  if (!paint) {
    return 'none';
  }

  if (paint.type === 'SOLID') {
    const color = paint.color || {};
    return [
      'solid',
      roundStyleNumber(color.r || 0, 4),
      roundStyleNumber(color.g || 0, 4),
      roundStyleNumber(color.b || 0, 4),
      roundStyleNumber(getPaintAlpha(paint), 4),
    ].join(':');
  }

  const stops = paint.gradientStops || [];
  const stopParts = [];
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index] || {};
    const color = stop.color || {};
    stopParts.push([
      roundStyleNumber(stop.position || 0, 4),
      roundStyleNumber(color.r || 0, 4),
      roundStyleNumber(color.g || 0, 4),
      roundStyleNumber(color.b || 0, 4),
      roundStyleNumber(color.a === undefined ? 1 : color.a, 4),
    ].join(','));
  }

  return `${paint.type}:${stopParts.join(';')}:${shortHash(JSON.stringify(paint.gradientTransform || []))}`;
}

function normalizeTextStyleInput(spec) {
  if (!spec || !spec.fontName || !spec.fontName.family || !spec.fontSize) {
    return null;
  }

  return {
    fontName: normalizeFontName(spec.fontName),
    fontSize: roundStyleNumber(spec.fontSize, 2),
    lineHeight: normalizeLineHeightForStyle(spec.lineHeight),
    letterSpacing: normalizeLetterSpacingForStyle(spec.letterSpacing),
    textCase: spec.textCase || 'ORIGINAL',
  };
}

function makeTextStyleKey(style) {
  return [
    'text',
    style.fontName.family,
    style.fontName.style,
    style.fontSize,
    normalizeLineHeightKey(style.lineHeight),
    normalizeLetterSpacingKey(style.letterSpacing),
    style.textCase || 'ORIGINAL',
  ].join('|');
}

function normalizeLineHeightForStyle(lineHeight) {
  if (!lineHeight || !lineHeight.unit) {
    return { unit: 'AUTO' };
  }

  if (lineHeight.unit === 'AUTO') {
    return { unit: 'AUTO' };
  }

  return {
    unit: lineHeight.unit,
    value: roundStyleNumber(lineHeight.value || 0, 2),
  };
}

function normalizeLetterSpacingForStyle(letterSpacing) {
  if (!letterSpacing || !letterSpacing.unit) {
    return { unit: 'PIXELS', value: 0 };
  }

  return {
    unit: letterSpacing.unit,
    value: roundStyleNumber(letterSpacing.value || 0, 2),
  };
}

function normalizeLineHeightKey(lineHeight) {
  if (!lineHeight || lineHeight.unit === 'AUTO') {
    return 'AUTO';
  }
  return `${lineHeight.unit}:${roundStyleNumber(lineHeight.value || 0, 2)}`;
}

function normalizeLetterSpacingKey(letterSpacing) {
  if (!letterSpacing) {
    return 'PIXELS:0';
  }
  return `${letterSpacing.unit}:${roundStyleNumber(letterSpacing.value || 0, 2)}`;
}

function assignPaintStyleNames(defs, styleNamespace = DEFAULT_STYLE_NAMESPACE) {
  defs.sort((a, b) => {
    const aName = buildPaintStyleBaseName(a);
    const bName = buildPaintStyleBaseName(b);
    if (aName !== bName) return aName.localeCompare(bName);
    if (b.count !== a.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });

  const used = {};
  for (let index = 0; index < defs.length; index++) {
    const def = defs[index];
    const baseName = `${styleNamespace} / ${buildPaintStyleBaseName(def)}`;
    def.name = makeUniqueStyleName(baseName, getPaintStyleSuffix(def), used);
    def.description = buildPaintStyleDescription(def);
  }
}

function assignTextStyleNames(defs, styleNamespace = DEFAULT_STYLE_NAMESPACE) {
  defs.sort((a, b) => {
    const aScale = getTypographyScale(a);
    const bScale = getTypographyScale(b);
    if (aScale.order !== bScale.order) return aScale.order - bScale.order;
    if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
    return a.key.localeCompare(b.key);
  });

  const used = {};
  for (let index = 0; index < defs.length; index++) {
    const def = defs[index];
    const scale = getTypographyScale(def);
    const baseName = `${styleNamespace} / Typography / ${scale.role} / ${scale.size} / ${getFontStyleLabel(def.fontName.style)}`;
    def.name = makeUniqueStyleName(baseName, getTextStyleSuffix(def), used);
    def.description = buildTextStyleDescription(def);
  }
}

function makeUniqueStyleName(baseName, suffix, used) {
  let name = baseName;
  if (used[name]) {
    name = `${baseName} / ${sanitizeStyleSegment(suffix)}`;
  }

  let counter = 2;
  const root = name;
  while (used[name]) {
    name = `${root} ${counter}`;
    counter++;
  }

  used[name] = true;
  return name;
}

function buildPaintStyleBaseName(def) {
  const paints = def.paints || [];
  if (paints.length === 1 && paints[0] && paints[0].type === 'SOLID') {
    const info = getSolidPaintInfo(paints[0]);
    const base = `Color / ${info.family} / ${info.shade}`;
    return info.alpha < 0.995 ? `${base} / Alpha ${info.alphaPercent}` : base;
  }

  if (paints.length === 1 && isGradientPaint(paints[0])) {
    const gradient = getGradientPaintInfo(paints[0]);
    return `Color / Gradient / ${gradient.kind} / ${gradient.name}`;
  }

  return `Color / Composite / ${paints.length} Fills`;
}

function buildPaintStyleDescription(def) {
  return `Generated by Morphus from HTML. ${describePaintList(def.paints)} Used by ${describeUsage(def.usages)}.`;
}

function buildTextStyleDescription(def) {
  return `Generated by Morphus from HTML. ${def.fontName.family} ${def.fontName.style}, ${def.fontSize}px, ${formatLineHeight(def.lineHeight)}, ${formatLetterSpacing(def.letterSpacing)}.`;
}

function getPaintStyleSuffix(def) {
  const paints = def.paints || [];
  if (paints.length === 1 && paints[0] && paints[0].type === 'SOLID') {
    return getSolidPaintInfo(paints[0]).hex.replace('#', '');
  }
  return shortHash(def.key).toUpperCase();
}

function getTextStyleSuffix(def) {
  return `${def.fontName.family} ${def.fontName.style} ${shortHash(def.key).toUpperCase()}`;
}

function getTypographyScale(def) {
  const size = Number(def.fontSize) || 16;
  const tracking = Math.abs(Number(def.letterSpacing && def.letterSpacing.value) || 0);
  const isLabel = size <= 16 && (def.textCase === 'UPPER' || tracking >= 0.75);

  if (isLabel) {
    if (size >= 15) return { role: 'Label', size: 'LG', order: 300 };
    if (size >= 13) return { role: 'Label', size: 'MD', order: 310 };
    return { role: 'Label', size: 'SM', order: 320 };
  }

  if (size >= 96) return { role: 'Display', size: '2XL', order: 10 };
  if (size >= 72) return { role: 'Display', size: 'XL', order: 20 };
  if (size >= 56) return { role: 'Display', size: 'LG', order: 30 };
  if (size >= 44) return { role: 'Display', size: 'MD', order: 40 };
  if (size >= 36) return { role: 'Heading', size: '2XL', order: 100 };
  if (size >= 30) return { role: 'Heading', size: 'XL', order: 110 };
  if (size >= 24) return { role: 'Heading', size: 'LG', order: 120 };
  if (size >= 20) return { role: 'Heading', size: 'MD', order: 130 };
  if (size >= 18) return { role: 'Body', size: 'LG', order: 200 };
  if (size >= 16) return { role: 'Body', size: 'MD', order: 210 };
  if (size >= 14) return { role: 'Body', size: 'SM', order: 220 };
  return { role: 'Body', size: 'XS', order: 230 };
}

function getFontStyleLabel(style) {
  const normalized = String(style || 'Regular').trim();
  if (/^italic$/i.test(normalized)) {
    return 'Regular Italic';
  }
  return normalized.replace(/\s+/g, ' ');
}

function describeUsage(usages) {
  const labels = Object.keys(usages || {}).sort();
  if (labels.length === 0) {
    return 'generated layers';
  }

  const parts = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    parts.push(`${label} (${usages[label]})`);
  }
  return parts.join(', ');
}

function describePaintList(paints) {
  if (!paints || paints.length === 0) {
    return 'No paints.';
  }

  if (paints.length === 1 && paints[0].type === 'SOLID') {
    const info = getSolidPaintInfo(paints[0]);
    const alpha = info.alpha < 0.995 ? ` at ${info.alphaPercent}% alpha` : '';
    return `${info.hex}${alpha}.`;
  }

  if (paints.length === 1 && isGradientPaint(paints[0])) {
    const info = getGradientPaintInfo(paints[0]);
    return `${info.kind} gradient, ${info.name}.`;
  }

  return `${paints.length} layered fills.`;
}

function getGradientPaintInfo(paint) {
  const kind = String(paint.type || 'GRADIENT').replace('GRADIENT_', '').toLowerCase();
  const titleKind = titleCase(kind.replace(/_/g, ' '));
  const stops = paint.gradientStops || [];
  const first = stops[0] ? getColorStopName(stops[0]) : 'Start';
  const last = stops[stops.length - 1] ? getColorStopName(stops[stops.length - 1]) : 'End';
  return {
    kind: titleKind,
    name: `${first} to ${last}`,
  };
}

function getColorStopName(stop) {
  const color = stop.color || {};
  const alpha = color.a === undefined ? 1 : color.a;
  if (alpha <= 0.01) {
    return 'Transparent';
  }

  const info = getColorInfo({
    r: color.r || 0,
    g: color.g || 0,
    b: color.b || 0,
    alpha,
  });
  return `${info.family} ${info.shade}`;
}

function getSolidPaintInfo(paint) {
  const color = paint.color || {};
  return getColorInfo({
    r: color.r || 0,
    g: color.g || 0,
    b: color.b || 0,
    alpha: getPaintAlpha(paint),
  });
}

function getColorInfo(color) {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  return {
    family: getColorFamily(hsl),
    shade: getColorShade(hsl.l),
    hex: rgbToHex(color.r, color.g, color.b),
    alpha: color.alpha,
    alphaPercent: Math.round((color.alpha || 0) * 100),
  };
}

function getColorFamily(hsl) {
  if (hsl.s < 0.08) {
    return 'Neutral';
  }

  const hue = hsl.h;
  if (hue < 18 || hue >= 345) return 'Red';
  if (hue < 38) return 'Orange';
  if (hue < 55) return 'Gold';
  if (hue < 70) return 'Yellow';
  if (hue < 95) return 'Lime';
  if (hue < 155) return 'Green';
  if (hue < 185) return 'Teal';
  if (hue < 205) return 'Cyan';
  if (hue < 245) return 'Blue';
  if (hue < 265) return 'Indigo';
  if (hue < 285) return 'Violet';
  if (hue < 315) return 'Purple';
  if (hue < 345) return 'Pink';
  return 'Neutral';
}

function getColorShade(lightness) {
  if (lightness >= 0.97) return '0';
  if (lightness >= 0.93) return '50';
  if (lightness >= 0.86) return '100';
  if (lightness >= 0.76) return '200';
  if (lightness >= 0.66) return '300';
  if (lightness >= 0.56) return '400';
  if (lightness >= 0.46) return '500';
  if (lightness >= 0.36) return '600';
  if (lightness >= 0.28) return '700';
  if (lightness >= 0.20) return '800';
  if (lightness >= 0.12) return '900';
  return '950';
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }

  return { h, s, l };
}

function rgbToHex(r, g, b) {
  const values = [r, g, b].map((value) => {
    const intValue = Math.max(0, Math.min(255, Math.round(value * 255)));
    return intValue.toString(16).padStart(2, '0');
  });
  return `#${values.join('').toUpperCase()}`;
}

function getPaintAlpha(paint) {
  const color = paint && paint.color ? paint.color : {};
  const paintOpacity = paint && paint.opacity !== undefined ? paint.opacity : 1;
  const colorAlpha = color.a !== undefined ? color.a : 1;
  return roundStyleNumber(paintOpacity * colorAlpha, 4);
}

function isGradientPaint(paint) {
  return Boolean(paint && typeof paint.type === 'string' && paint.type.indexOf('GRADIENT_') === 0);
}

function isFullyTransparentPaint(paint) {
  if (!paint || paint.visible === false) {
    return true;
  }

  if (paint.type === 'SOLID') {
    return getPaintAlpha(paint) <= 0.001;
  }

  if (isGradientPaint(paint)) {
    const stops = paint.gradientStops || [];
    if (stops.length === 0) {
      return false;
    }
    return stops.every((stop) => {
      const color = stop && stop.color ? stop.color : {};
      return (color.a === undefined ? 1 : color.a) <= 0.001;
    });
  }

  return false;
}

async function getLocalStylesSafe(kind) {
  try {
    if (kind === 'paint') {
      if (typeof figma.getLocalPaintStylesAsync === 'function') {
        return await figma.getLocalPaintStylesAsync();
      }
      if (typeof figma.getLocalPaintStyles === 'function') {
        return figma.getLocalPaintStyles();
      }
    }

    if (kind === 'text') {
      if (typeof figma.getLocalTextStylesAsync === 'function') {
        return await figma.getLocalTextStylesAsync();
      }
      if (typeof figma.getLocalTextStyles === 'function') {
        return figma.getLocalTextStyles();
      }
    }
  } catch (err) {}

  return [];
}

function ensurePaintStyle(def, localStyles) {
  try {
    let style = findLocalStyleByName(localStyles, def.name);
    if (!style) {
      style = figma.createPaintStyle();
      localStyles.push(style);
    }

    style.name = def.name;
    style.paints = cloneValue(def.paints);
    if ('description' in style) {
      style.description = def.description;
    }
    return style.id;
  } catch (err) {
    return null;
  }
}

async function ensureTextStyle(def, localStyles) {
  try {
    await figma.loadFontAsync(def.fontName);

    let style = findLocalStyleByName(localStyles, def.name);
    if (!style) {
      style = figma.createTextStyle();
      localStyles.push(style);
    }

    style.name = def.name;
    style.fontName = def.fontName;
    style.fontSize = def.fontSize;
    style.lineHeight = cloneValue(def.lineHeight);
    style.letterSpacing = cloneValue(def.letterSpacing);
    try {
      style.textCase = def.textCase || 'ORIGINAL';
    } catch (err) {}
    if ('description' in style) {
      style.description = def.description;
    }
    return style.id;
  } catch (err) {
    return null;
  }
}

function findLocalStyleByName(styles, name) {
  for (let index = 0; index < styles.length; index++) {
    if (styles[index] && styles[index].name === name) {
      return styles[index];
    }
  }
  return null;
}

async function applyPaintStyleIds(node, spec, styleRegistry) {
  if (!styleRegistry) {
    return;
  }

  const fillStyleId = getPaintStyleIdForPaints(styleRegistry, spec.fills);
  if (fillStyleId) {
    await setNodeFillStyleId(node, fillStyleId);
  }

  const strokeStyleId = getPaintStyleIdForPaints(styleRegistry, spec.strokes);
  if (strokeStyleId) {
    await setNodeStrokeStyleId(node, strokeStyleId);
  }
}

async function applyTextStyleIds(text, spec, runs, styleRegistry) {
  if (!styleRegistry || !text.characters) {
    return;
  }

  const length = text.characters.length;
  const baseTextStyleId = getTextStyleIdForSpec(styleRegistry, spec);
  if (baseTextStyleId) {
    await setRangeTextStyleId(text, 0, length, baseTextStyleId);
  }

  const baseFillStyleId = getPaintStyleIdForPaints(styleRegistry, spec.fills);
  if (baseFillStyleId) {
    await setRangeFillStyleId(text, 0, length, baseFillStyleId);
  }

  const baseStrokeStyleId = getPaintStyleIdForPaints(styleRegistry, spec.strokes);
  if (baseStrokeStyleId) {
    await setRangeStrokeStyleId(text, 0, length, baseStrokeStyleId);
  }

  const textRuns = runs || [];
  for (let index = 0; index < textRuns.length; index++) {
    const run = textRuns[index];
    if (!run) {
      continue;
    }

    const start = Number.isFinite(run.start) ? run.start : 0;
    const end = Number.isFinite(run.end) ? run.end : start + String(run.text || '').length;
    if (end <= start) {
      continue;
    }

    const runTextStyleId = getTextStyleIdForSpec(styleRegistry, run);
    if (runTextStyleId) {
      await setRangeTextStyleId(text, start, end, runTextStyleId);
    }

    const runFillStyleId = getPaintStyleIdForPaints(styleRegistry, run.fills);
    if (runFillStyleId) {
      await setRangeFillStyleId(text, start, end, runFillStyleId);
    }

    const runStrokeStyleId = getPaintStyleIdForPaints(styleRegistry, run.strokes);
    if (runStrokeStyleId) {
      await setRangeStrokeStyleId(text, start, end, runStrokeStyleId);
    }
  }
}

function getPaintStyleIdForPaints(styleRegistry, paints) {
  const key = makePaintStyleKey(paints);
  return key && styleRegistry.paint ? styleRegistry.paint[key] : null;
}

function getTextStyleIdForSpec(styleRegistry, spec) {
  const style = normalizeTextStyleInput(spec);
  if (!style) {
    return null;
  }
  const key = makeTextStyleKey(style);
  return styleRegistry.text ? styleRegistry.text[key] : null;
}

async function setNodeFillStyleId(node, styleId) {
  try {
    if (typeof node.setFillStyleIdAsync === 'function') {
      await node.setFillStyleIdAsync(styleId);
    } else {
      node.fillStyleId = styleId;
    }
  } catch (err) {}
}

async function setNodeStrokeStyleId(node, styleId) {
  try {
    if (typeof node.setStrokeStyleIdAsync === 'function') {
      await node.setStrokeStyleIdAsync(styleId);
    } else {
      node.strokeStyleId = styleId;
    }
  } catch (err) {}
}

async function setRangeTextStyleId(text, start, end, styleId) {
  try {
    if (start === 0 && end === text.characters.length && typeof text.setTextStyleIdAsync === 'function') {
      await text.setTextStyleIdAsync(styleId);
    } else if (typeof text.setRangeTextStyleIdAsync === 'function') {
      await text.setRangeTextStyleIdAsync(start, end, styleId);
    } else if (start === 0 && end === text.characters.length) {
      text.textStyleId = styleId;
    }
  } catch (err) {}
}

async function setRangeFillStyleId(text, start, end, styleId) {
  try {
    if (start === 0 && end === text.characters.length && typeof text.setFillStyleIdAsync === 'function') {
      await text.setFillStyleIdAsync(styleId);
    } else if (typeof text.setRangeFillStyleIdAsync === 'function') {
      await text.setRangeFillStyleIdAsync(start, end, styleId);
    } else if (start === 0 && end === text.characters.length) {
      text.fillStyleId = styleId;
    }
  } catch (err) {}
}

async function setRangeStrokeStyleId(text, start, end, styleId) {
  try {
    if (start === 0 && end === text.characters.length && typeof text.setStrokeStyleIdAsync === 'function') {
      await text.setStrokeStyleIdAsync(styleId);
    } else if (typeof text.setRangeStrokeStyleIdAsync === 'function') {
      await text.setRangeStrokeStyleIdAsync(start, end, styleId);
    } else if (start === 0 && end === text.characters.length) {
      text.strokeStyleId = styleId;
    }
  } catch (err) {}
}

function formatLineHeight(lineHeight) {
  if (!lineHeight || lineHeight.unit === 'AUTO') {
    return 'auto line height';
  }
  return `${lineHeight.value}${lineHeight.unit === 'PIXELS' ? 'px' : '%'} line height`;
}

function formatLetterSpacing(letterSpacing) {
  if (!letterSpacing) {
    return '0px tracking';
  }
  const unit = letterSpacing.unit === 'PERCENT' ? '%' : 'px';
  return `${letterSpacing.value}${unit} tracking`;
}

function titleCase(value) {
  return String(value || '').replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

function sanitizeStyleSegment(value) {
  return String(value || 'Style')
    .replace(/[\/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Style';
}

function roundStyleNumber(value, precision) {
  const factor = Math.pow(10, precision);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function shortHash(value) {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6);
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

// Node builder

async function buildNode(spec, parentLayoutMode, styleRegistry) {
  if (spec.type === 'IMAGE' || spec._image) {
    return await buildImageNode(spec, parentLayoutMode, styleRegistry);
  }
  if (spec.type === 'SVG' || spec._svgMarkup) {
    return await buildSvgNode(spec, parentLayoutMode, styleRegistry);
  }
  if (spec.type === 'TEXT') {
    return await buildTextNode(spec, parentLayoutMode, styleRegistry);
  }
  return buildFrameNode(spec, parentLayoutMode, styleRegistry);
}

async function buildImageNode(spec, parentLayoutMode, styleRegistry) {
  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.x = spec.x || 0;
  frame.y = spec.y || 0;
  frame.resize(Math.max(spec.width || 1, 1), Math.max(spec.height || 1, 1));
  frame.fills = [];
  frame.strokes = [];

  const imagePaint = createImageFillPaint(spec);
  if (imagePaint) {
    frame.fills = [imagePaint];
  } else if (spec.fills && spec.fills.length > 0) {
    frame.fills = spec.fills;
  }

  if (spec.opacity !== undefined) frame.opacity = spec.opacity;
  if (spec.layoutPositioning) {
    try {
      frame.layoutPositioning = spec.layoutPositioning;
    } catch (err) {}
  }
  applyChildLayoutSizing(frame, spec);
  if (spec.clipsContent !== undefined) frame.clipsContent = spec.clipsContent;
  if (spec.cornerRadius !== undefined) frame.cornerRadius = spec.cornerRadius;
  if (spec.topLeftRadius !== undefined) {
    frame.topLeftRadius = spec.topLeftRadius;
    frame.topRightRadius = spec.topRightRadius || 0;
    frame.bottomRightRadius = spec.bottomRightRadius || 0;
    frame.bottomLeftRadius = spec.bottomLeftRadius || 0;
  }
  if (spec.strokes && spec.strokes.length > 0) {
    frame.strokes = spec.strokes;
    frame.strokeWeight = spec.strokeWeight || 1;
    frame.strokeAlign = spec.strokeAlign || 'INSIDE';
    if (spec.strokeTopWeight !== undefined) frame.strokeTopWeight = spec.strokeTopWeight;
    if (spec.strokeRightWeight !== undefined) frame.strokeRightWeight = spec.strokeRightWeight;
    if (spec.strokeBottomWeight !== undefined) frame.strokeBottomWeight = spec.strokeBottomWeight;
    if (spec.strokeLeftWeight !== undefined) frame.strokeLeftWeight = spec.strokeLeftWeight;
  }
  if (spec.effects && spec.effects.length > 0) {
    applyFrameEffects(frame, spec.effects);
  }
  if (spec.blendMode) {
    try {
      frame.blendMode = spec.blendMode;
    } catch (err) {}
  }

  return frame;
}

function createImageFillPaint(spec) {
  if (!figma.createImage || !spec || !spec._image || !spec._image.src) {
    return null;
  }

  try {
    const bytes = decodeImageBytes(spec._image.src);
    if (!bytes || bytes.length === 0) {
      return null;
    }

    const image = figma.createImage(bytes);
    return {
      type: 'IMAGE',
      imageHash: image.hash,
      scaleMode: mapObjectFitToImageScaleMode(spec._objectFit),
    };
  } catch (err) {
    return null;
  }
}

function decodeImageBytes(src) {
  const source = String(src || '').trim();
  const dataUri = source.match(/^data:([^;,]+)?((?:;[^,]*)?),(.*)$/i);
  if (!dataUri) {
    return null;
  }

  const meta = dataUri[2] || '';
  const payload = dataUri[3] || '';
  if (meta.toLowerCase().includes(';base64')) {
    return decodeBase64Bytes(payload);
  }

  return encodeUtf8Bytes(decodeURIComponent(payload));
}

function decodeBase64Bytes(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/\s+/g, '')
    .replace(/=+$/g, '');
  const bytes = [];
  let buffer = 0;
  let bitCount = 0;

  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    const next = alphabet.indexOf(char);
    if (next < 0) {
      continue;
    }

    buffer = (buffer << 6) | next;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

function encodeUtf8Bytes(value) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(String(value || ''));
  }

  const bytes = [];
  const text = String(value || '');
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >> 18));
      bytes.push(0x80 | ((codePoint >> 12) & 0x3f));
      bytes.push(0x80 | ((codePoint >> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function mapObjectFitToImageScaleMode(objectFit) {
  const fit = String(objectFit || '').toLowerCase();
  if (fit === 'contain' || fit === 'scale-down' || fit === 'none') {
    return 'FIT';
  }
  if (fit === 'fill') {
    return 'FILL';
  }
  return 'FILL';
}

async function buildSvgNode(spec, parentLayoutMode, styleRegistry) {
  if (typeof figma.createNodeFromSvg !== 'function' || !spec._svgMarkup) {
    return buildFrameNode(Object.assign({}, spec, { type: 'FRAME', children: [] }), parentLayoutMode, styleRegistry);
  }

  try {
    const node = figma.createNodeFromSvg(spec._svgMarkup);
    node.name = spec.name;
    node.x = spec.x || 0;
    node.y = spec.y || 0;
    resizeSceneNode(node, Math.max(spec.width || 1, 1), Math.max(spec.height || 1, 1));

    if (spec.opacity !== undefined) {
      node.opacity = spec.opacity;
    }
    if (spec.layoutPositioning) {
      try {
        node.layoutPositioning = spec.layoutPositioning;
      } catch (err) {}
    }
    applyChildLayoutSizing(node, spec);
    if (spec.blendMode) {
      try {
        node.blendMode = spec.blendMode;
      } catch (err) {}
    }

    return node;
  } catch (err) {
    return buildFrameNode(Object.assign({}, spec, { type: 'FRAME', children: [] }), parentLayoutMode, styleRegistry);
  }
}

function resizeSceneNode(node, width, height) {
  if (!node) {
    return;
  }

  if (typeof node.resize === 'function') {
    node.resize(width, height);
    return;
  }

  if (typeof node.resizeWithoutConstraints === 'function') {
    node.resizeWithoutConstraints(width, height);
  }
}

function applyChildLayoutSizing(node, spec) {
  if (!node || !spec) {
    return;
  }

  if (spec.layoutSizingHorizontal) {
    try {
      node.layoutSizingHorizontal = spec.layoutSizingHorizontal;
    } catch (err) {}
  }
  if (spec.layoutSizingVertical) {
    try {
      node.layoutSizingVertical = spec.layoutSizingVertical;
    } catch (err) {}
  }
}

async function buildTextNode(spec, parentLayoutMode, styleRegistry) {
  const textRuns = getAlignedTextRuns(spec);

  if (hasOutlineRuns(textRuns)) {
    return await buildMixedTextGroup(spec, styleRegistry);
  }

  const text = figma.createText();
  applyBaseTextProps(text, spec);
  applyTextRunStyles(text, textRuns);
  await applyTextStyleIds(text, spec, textRuns, styleRegistry);
  applyTextDecorations(text, spec, textRuns);
  applyTextSizing(text, spec, parentLayoutMode);
  applyChildLayoutSizing(text, spec);
  return text;
}

async function buildMixedTextGroup(spec, styleRegistry) {
  const textRuns = getAlignedTextRuns(spec);
  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.x = spec.x || 0;
  frame.y = spec.y || 0;
  frame.resize(Math.max(spec.width || 1, 1), Math.max(spec.height || 1, 1));
  frame.fills = [];
  frame.strokes = [];
  frame.clipsContent = false;
  applyChildLayoutSizing(frame, spec);

  const baseText = figma.createText();
  applyBaseTextProps(baseText, Object.assign({}, spec, { x: 0, y: 0 }));
  applyTextRunStyles(baseText, textRuns);
  await applyTextStyleIds(baseText, Object.assign({}, spec, { x: 0, y: 0 }), textRuns, styleRegistry);
  applyTextDecorations(baseText, spec, textRuns);
  applyTextSizing(baseText, Object.assign({}, spec, { x: 0, y: 0 }));
  frame.appendChild(baseText);

  const outlineRuns = textRuns.filter((run) => run && run.strokes && run.strokes.length > 0);
  for (const run of outlineRuns) {
    const overlay = figma.createText();
    applyBaseTextProps(overlay, {
      name: spec.name + ' / outline',
      characters: run.text,
      x: 0,
      y: estimateRunYOffset(spec, run),
      width: spec.width,
      height: spec.height,
      fontName: run.fontName || spec.fontName,
      fontSize: run.fontSize || spec.fontSize,
      lineHeight: run.lineHeight || spec.lineHeight,
      letterSpacing: run.letterSpacing || spec.letterSpacing,
      textAlignHorizontal: spec.textAlignHorizontal,
      textCase: run.textCase || spec.textCase,
      fills: run.fills || [],
      strokes: run.strokes || [],
      strokeWeight: run.strokeWeight || 1,
      opacity: spec.opacity,
    });
    await applyTextStyleIds(overlay, {
      name: spec.name + ' / outline',
      characters: run.text,
      x: 0,
      y: estimateRunYOffset(spec, run),
      width: spec.width,
      height: spec.height,
      fontName: run.fontName || spec.fontName,
      fontSize: run.fontSize || spec.fontSize,
      lineHeight: run.lineHeight || spec.lineHeight,
      letterSpacing: run.letterSpacing || spec.letterSpacing,
      textAlignHorizontal: spec.textAlignHorizontal,
      textCase: run.textCase || spec.textCase,
      fills: run.fills || [],
      strokes: run.strokes || [],
      strokeWeight: run.strokeWeight || 1,
      opacity: spec.opacity,
    }, [], styleRegistry);
    applyTextSizing(overlay, { width: spec.width, height: spec.height });
    frame.appendChild(overlay);
  }

  return frame;
}

function applyBaseTextProps(text, spec) {
  text.name = spec.name;
  text.x = spec.x || 0;
  text.y = spec.y || 0;

  const fontName = spec.fontName || { family: 'Inter', style: 'Regular' };
  try {
    text.fontName = fontName;
  } catch (err) {}

  text.characters = spec.characters || '';
  if (spec.fontSize) text.fontSize = spec.fontSize;
  if (spec.fills) text.fills = spec.fills;
  if (spec.opacity !== undefined) text.opacity = spec.opacity;
  if (spec.lineHeight) text.lineHeight = spec.lineHeight;
  if (spec.letterSpacing) text.letterSpacing = spec.letterSpacing;
  if (spec.textAlignHorizontal) text.textAlignHorizontal = spec.textAlignHorizontal;
  if (spec.textAlignVertical) text.textAlignVertical = spec.textAlignVertical;
  if (spec.textCase) text.textCase = spec.textCase;
  applyTextDecorationProps(text, spec);
  if (spec.strokes) {
    text.strokes = spec.strokes;
    text.strokeWeight = spec.strokeWeight || 1;
  }
  if (spec.textTruncation) {
    try {
      text.textTruncation = spec.textTruncation;
      if (spec.textTruncation === 'ENDING') {
        text.maxLines = 1;
      }
    } catch (err) {}
  }
}

function applyTextRunStyles(text, runs) {
  if (!runs || runs.length === 0) return;

  for (const run of runs) {
    const start = Number.isFinite(run.start) ? run.start : 0;
    const end = Number.isFinite(run.end) ? run.end : start + (run.text || '').length;
    if (end <= start) continue;

    if (run.fontName) {
      try { text.setRangeFontName(start, end, run.fontName); } catch (err) {}
    }
    if (run.fontSize) {
      try { text.setRangeFontSize(start, end, run.fontSize); } catch (err) {}
    }
    if (run.fills) {
      try { text.setRangeFills(start, end, run.fills); } catch (err) {}
    }
    if (run.lineHeight) {
      try { text.setRangeLineHeight(start, end, run.lineHeight); } catch (err) {}
    }
    if (run.letterSpacing) {
      try { text.setRangeLetterSpacing(start, end, run.letterSpacing); } catch (err) {}
    }
    if (run.textCase) {
      try { text.setRangeTextCase(start, end, run.textCase); } catch (err) {}
    }
  }
}

function applyTextDecorationProps(text, spec) {
  if (!text || !spec) return;
  if (spec.textDecoration) {
    try { text.textDecoration = spec.textDecoration; } catch (err) {}
  }
  if (spec.textDecorationStyle) {
    try { text.textDecorationStyle = spec.textDecorationStyle; } catch (err) {}
  }
  if (spec.textDecorationColor) {
    try { text.textDecorationColor = spec.textDecorationColor; } catch (err) {}
  }
  if (spec.textDecorationThickness) {
    try { text.textDecorationThickness = spec.textDecorationThickness; } catch (err) {}
  }
}

function applyTextDecorations(text, spec, runs) {
  applyTextDecorationProps(text, spec);

  const textRuns = runs || [];
  for (const run of textRuns) {
    const start = Number.isFinite(run.start) ? run.start : 0;
    const end = Number.isFinite(run.end) ? run.end : start + (run.text || '').length;
    if (end <= start) continue;
    applyRangeTextDecorationProps(text, start, end, run);
  }
}

function applyRangeTextDecorationProps(text, start, end, run) {
  if (!text || !run || end <= start) return;
  if (run.textDecoration) {
    try { text.setRangeTextDecoration(start, end, run.textDecoration); } catch (err) {}
  }
  if (run.textDecorationStyle) {
    try { text.setRangeTextDecorationStyle(start, end, run.textDecorationStyle); } catch (err) {}
  }
  if (run.textDecorationColor) {
    try { text.setRangeTextDecorationColor(start, end, run.textDecorationColor); } catch (err) {}
  }
  if (run.textDecorationThickness) {
    try { text.setRangeTextDecorationThickness(start, end, run.textDecorationThickness); } catch (err) {}
  }
}

function applyTextSizing(text, spec, parentLayoutMode) {
  if (!spec.width) return;
  try {
    if (spec.textTruncation === 'ENDING') {
      text.textAutoResize = 'NONE';
      text.resize(Math.max(spec.width, 1), Math.max(spec.height || 1, 1));
      return;
    }

    if (spec.whiteSpace === 'nowrap') {
      text.textAutoResize = 'WIDTH_AND_HEIGHT';
      return;
    }

    if (hasExplicitLineBreaks(spec.characters)) {
      if (shouldPreserveTextWidthForAlignment(spec, parentLayoutMode)) {
        text.textAutoResize = 'HEIGHT';
        text.resize(Math.max(spec.width, 1), Math.max(spec.height || 1, 1));
        return;
      }
      text.textAutoResize = 'WIDTH_AND_HEIGHT';
      return;
    }

    if (hasFixedTextBoxAlignment(spec)) {
      text.textAutoResize = 'NONE';
      text.resize(Math.max(spec.width, 1), Math.max(spec.height || 1, 1));
      return;
    }

    if (shouldAutoSizeSingleLineText(spec, parentLayoutMode)) {
      text.textAutoResize = 'WIDTH_AND_HEIGHT';
      return;
    }

    text.textAutoResize = 'HEIGHT';
    text.resize(Math.max(spec.width, 1), Math.max(spec.height || 1, 1));
  } catch (err) {}
}

function hasExplicitLineBreaks(characters) {
  return String(characters || '').includes('\n');
}

function shouldPreserveTextWidthForAlignment(spec, parentLayoutMode) {
  if (parentLayoutMode && parentLayoutMode !== 'NONE') {
    return false;
  }

  const align = String(spec.textAlignHorizontal || '').toUpperCase();
  return align === 'CENTER' || align === 'RIGHT';
}

function hasFixedTextBoxAlignment(spec) {
  return spec.textAlignVertical && spec.textAlignVertical !== 'TOP';
}

function shouldAutoSizeSingleLineText(spec, parentLayoutMode) {
  if (!isRenderedSingleLineText(spec)) {
    return false;
  }

  if (parentLayoutMode && parentLayoutMode !== 'NONE') {
    return true;
  }

  if (isTightSingleLineTextBox(spec)) {
    return true;
  }

  const align = String(spec.textAlignHorizontal || 'LEFT').toUpperCase();
  return align === 'LEFT';
}

function isTightSingleLineTextBox(spec) {
  const width = pickNumber(spec.width, 0);
  const estimatedTextWidth = estimateSingleLineTextWidth(spec);
  if (width <= 0 || estimatedTextWidth <= 0) {
    return false;
  }

  return width <= estimatedTextWidth * 1.75;
}

function estimateSingleLineTextWidth(spec) {
  const text = String(spec.characters || '').replace(/\s+/g, ' ').trim();
  const fontSize = pickNumber(spec.fontSize, 16);
  if (!text || fontSize <= 0) {
    return 0;
  }

  let emWidth = 0;
  for (let index = 0; index < text.length; index++) {
    emWidth += estimateGlyphEmWidth(text[index]);
  }

  const tracking = Math.max(getLetterSpacingPx(spec.letterSpacing, fontSize), 0);
  return (emWidth * fontSize) + (tracking * Math.max(text.length - 1, 0));
}

function estimateGlyphEmWidth(character) {
  if (/\s/.test(character)) return 0.33;
  if (/[ilI1|.,:;!]/.test(character)) return 0.34;
  if (/[mwMW@#%&]/.test(character)) return 0.82;
  if (/[A-Z0-9]/.test(character)) return 0.62;
  return 0.56;
}

function getLetterSpacingPx(letterSpacing, fontSize) {
  if (!letterSpacing) {
    return 0;
  }

  if (typeof letterSpacing === 'number') {
    return letterSpacing;
  }

  if (letterSpacing.unit === 'PIXELS') {
    return Number(letterSpacing.value) || 0;
  }

  if (letterSpacing.unit === 'PERCENT') {
    return (fontSize * (Number(letterSpacing.value) || 0)) / 100;
  }

  return 0;
}

function isRenderedSingleLineText(spec) {
  const characters = String(spec.characters || '').trim();
  if (!characters || hasExplicitLineBreaks(characters)) {
    return false;
  }

  const height = pickNumber(spec.height, 0);
  const lineHeight = getLineHeightPx(spec.lineHeight, spec.fontSize || 16);
  if (height <= 0 || lineHeight <= 0) {
    return false;
  }

  return height <= Math.max(lineHeight * 1.4, lineHeight + 4);
}

async function buildFrameNode(spec, parentLayoutMode, styleRegistry) {
  const preparedLayout = getPreparedPageLayout(spec);
  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.resize(
    Math.max(spec.width || 100, 1),
    Math.max((spec.height || 100) + preparedLayout.flowOffset, 1)
  );
  frame.x = spec.x || 0;
  frame.y = spec.y || 0;

  if (spec.fills && spec.fills.length > 0) frame.fills = spec.fills;
  else frame.fills = [];

  if (spec.opacity !== undefined) frame.opacity = spec.opacity;
  applyChildLayoutSizing(frame, spec);

  if (spec.paddingTop !== undefined) frame.paddingTop = spec.paddingTop;
  if (spec.paddingRight !== undefined) frame.paddingRight = spec.paddingRight;
  if (spec.paddingBottom !== undefined) frame.paddingBottom = spec.paddingBottom;
  if (spec.paddingLeft !== undefined) frame.paddingLeft = spec.paddingLeft;

  if (spec.layoutMode && spec.layoutMode !== 'NONE') {
    frame.layoutMode = spec.layoutMode;
    if (spec.primaryAxisAlignItems) frame.primaryAxisAlignItems = spec.primaryAxisAlignItems;
    if (spec.counterAxisAlignItems) frame.counterAxisAlignItems = spec.counterAxisAlignItems;
    if (spec.itemSpacing !== undefined) frame.itemSpacing = spec.itemSpacing;
    if (spec.layoutWrap) {
      try {
        frame.layoutWrap = spec.layoutWrap;
      } catch (err) {}
    }
    if (spec.counterAxisSpacing !== undefined) {
      try {
        frame.counterAxisSpacing = spec.counterAxisSpacing;
      } catch (err) {}
    }
  }

  if (spec._gridStrategy) {
    applyGridStrategy(frame, spec._gridStrategy);
  }

  if (spec.clipsContent !== undefined) frame.clipsContent = spec.clipsContent;
  if (spec.cornerRadius !== undefined) frame.cornerRadius = spec.cornerRadius;
  if (spec.topLeftRadius !== undefined) {
    frame.topLeftRadius = spec.topLeftRadius;
    frame.topRightRadius = spec.topRightRadius || 0;
    frame.bottomRightRadius = spec.bottomRightRadius || 0;
    frame.bottomLeftRadius = spec.bottomLeftRadius || 0;
  }
  if (spec.strokes && spec.strokes.length > 0) {
    frame.strokes = spec.strokes;
    frame.strokeWeight = spec.strokeWeight || 1;
    frame.strokeAlign = spec.strokeAlign || 'INSIDE';
    if (spec.strokeTopWeight !== undefined) frame.strokeTopWeight = spec.strokeTopWeight;
    if (spec.strokeRightWeight !== undefined) frame.strokeRightWeight = spec.strokeRightWeight;
    if (spec.strokeBottomWeight !== undefined) frame.strokeBottomWeight = spec.strokeBottomWeight;
    if (spec.strokeLeftWeight !== undefined) frame.strokeLeftWeight = spec.strokeLeftWeight;
  }
  if (spec.effects && spec.effects.length > 0) {
    applyFrameEffects(frame, spec.effects);
  }
  if (spec.blendMode) {
    try {
      frame.blendMode = spec.blendMode;
    } catch (err) {}
  }
  if (spec._backgroundPattern) {
    applyBackgroundPattern(frame, spec._backgroundPattern);
  }

  await applyPaintStyleIds(frame, spec, styleRegistry);

  const childSpecs = preparedLayout.children;
  for (const childSpec of childSpecs) {
    const child = await buildNode(childSpec, frame.layoutMode || 'NONE', styleRegistry);
    if (child) {
      frame.appendChild(child);
      if (childSpec.layoutPositioning === 'ABSOLUTE' && frame.layoutMode !== 'NONE') {
        try {
          child.layoutPositioning = 'ABSOLUTE';
        } catch (err) {}
      }
    }
  }

  if (frame.layoutMode && frame.layoutMode !== 'NONE') {
    applySmartAutoLayoutSizing(frame, spec, spec._gridStrategy || null);
  }
  if (spec._hoverSpec) {
    return buildComponentWithVariants(frame, spec._hoverSpec);
  }

  return frame;
}

function getPreparedChildSpecs(spec) {
  return getPreparedPageLayout(spec).children;
}

function getPreparedPageLayout(spec) {
  const children = Array.isArray(spec.children) ? spec.children : [];
  if (!spec || !spec._pageLayout || children.length === 0) {
    return { children, flowOffset: 0 };
  }

  const headerBottom = getPageHeaderBottom(children);
  if (headerBottom <= 0) {
    return { children, flowOffset: 0 };
  }

  const firstFlowTop = getFirstFlowTop(children);
  if (firstFlowTop === null) {
    return { children, flowOffset: 0 };
  }

  const flowOffset = Math.max(headerBottom - firstFlowTop, 0);
  if (flowOffset === 0) {
    return { children, flowOffset: 0 };
  }

  const prepared = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (isFlowPageChild(child)) {
      prepared.push(cloneSpecWithYOffset(child, flowOffset));
    } else {
      prepared.push(child);
    }
  }

  return { children: prepared, flowOffset };
}

function getPageHeaderBottom(children) {
  let bottom = 0;
  let foundHeader = false;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!isHeaderRoleSpec(child)) {
      continue;
    }

    const childBottom = getSpecBottom(child);
    if (!foundHeader || childBottom > bottom) {
      bottom = childBottom;
    }
    foundHeader = true;
  }

  return foundHeader ? bottom : 0;
}

function getFirstFlowTop(children) {
  let top = null;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!isFlowPageChild(child)) {
      continue;
    }

    const childTop = Number.isFinite(child.y) ? child.y : 0;
    if (top === null || childTop < top) {
      top = childTop;
    }
  }

  return top;
}

function isHeaderRoleSpec(spec) {
  return Boolean(spec && spec._role === 'header');
}

function isFlowPageChild(spec) {
  if (!spec || isHeaderRoleSpec(spec) || spec._isPseudo) {
    return false;
  }

  return spec.layoutPositioning !== 'ABSOLUTE';
}

function getSpecBottom(spec) {
  const top = Number.isFinite(spec.y) ? spec.y : 0;
  const height = Number.isFinite(spec.height) ? spec.height : 0;
  return top + height;
}

function cloneSpecWithYOffset(spec, offset) {
  return Object.assign({}, spec, {
    y: (Number.isFinite(spec.y) ? spec.y : 0) + offset,
  });
}

function applyGridStrategy(frame, strategy) {
  if (strategy.layoutMode) {
    frame.layoutMode = strategy.layoutMode;
  }
  if (strategy.primaryAxisSizingMode) {
    frame.primaryAxisSizingMode = strategy.primaryAxisSizingMode;
  }
  if (strategy.counterAxisSizingMode) {
    frame.counterAxisSizingMode = strategy.counterAxisSizingMode;
  }
  if (strategy.itemSpacing !== undefined) {
    frame.itemSpacing = strategy.itemSpacing;
  }
  if (strategy.layoutWrap) {
    try {
      frame.layoutWrap = strategy.layoutWrap;
    } catch (err) {}
  }
  if (strategy.counterAxisSpacing !== undefined) {
    try {
      frame.counterAxisSpacing = strategy.counterAxisSpacing;
    } catch (err) {}
  }
}

function applyFrameEffects(frame, effects) {
  try {
    frame.effects = getSupportedFrameEffects(effects);
  } catch (err) {
    frame.effects = getLegacyFrameEffects(effects);
  }
}

function getSupportedFrameEffects(effects) {
  if (!Array.isArray(effects) || effects.length === 0) {
    return [];
  }

  return effects;
}

function getLegacyFrameEffects(effects) {
  if (!Array.isArray(effects) || effects.length === 0) {
    return [];
  }

  const supported = [];
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index];
    if (!effect || effect.spread === undefined) {
      supported.push(effect);
      continue;
    }

    const copy = Object.assign({}, effect);
    delete copy.spread;
    supported.push(copy);
  }
  return supported;
}

function applySmartAutoLayoutSizing(frame, spec, strategy) {
  if (!frame || !frame.layoutMode || frame.layoutMode === 'NONE') {
    return;
  }

  const sourceSpec = spec || {};
  const sourceStrategy = strategy || {};
  const layoutMode = frame.layoutMode;
  const renderedWidth = Number.isFinite(sourceSpec.width) ? sourceSpec.width : frame.width;
  const renderedHeight = Number.isFinite(sourceSpec.height) ? sourceSpec.height : frame.height;
  const sizing = determineAutoLayoutSizing({
    layoutMode,
    width: renderedWidth,
    height: renderedHeight,
    paddingTop: pickNumber(sourceSpec.paddingTop, frame.paddingTop),
    paddingRight: pickNumber(sourceSpec.paddingRight, frame.paddingRight),
    paddingBottom: pickNumber(sourceSpec.paddingBottom, frame.paddingBottom),
    paddingLeft: pickNumber(sourceSpec.paddingLeft, frame.paddingLeft),
    itemSpacing: pickNumber(sourceSpec.itemSpacing, frame.itemSpacing),
    primaryAxisAlignItems: frame.primaryAxisAlignItems || sourceSpec.primaryAxisAlignItems,
    counterAxisAlignItems: frame.counterAxisAlignItems || sourceSpec.counterAxisAlignItems,
    fills: sourceSpec.fills || [],
    strokes: sourceSpec.strokes || [],
    effects: sourceSpec.effects || [],
    clipsContent: sourceSpec.clipsContent,
    backgroundPattern: sourceSpec._backgroundPattern || null,
    children: Array.isArray(sourceSpec.children) ? sourceSpec.children : [],
  });

  const primaryMode = sourceStrategy.primaryAxisSizingMode || sourceSpec.primaryAxisSizingMode || (sizing.primaryFixed ? 'FIXED' : null);
  const counterMode = sourceStrategy.counterAxisSizingMode || sourceSpec.counterAxisSizingMode || (sizing.counterFixed ? 'FIXED' : null);

  if (primaryMode) {
    try {
      frame.primaryAxisSizingMode = primaryMode;
    } catch (err) {}
    if (layoutMode === 'HORIZONTAL') {
      try {
        frame.layoutSizingHorizontal = primaryMode;
      } catch (err) {}
    } else if (layoutMode === 'VERTICAL') {
      try {
        frame.layoutSizingVertical = primaryMode;
      } catch (err) {}
    }
  }

  if (counterMode) {
    try {
      frame.counterAxisSizingMode = counterMode;
    } catch (err) {}
    if (layoutMode === 'HORIZONTAL') {
      try {
        frame.layoutSizingVertical = counterMode;
      } catch (err) {}
    } else if (layoutMode === 'VERTICAL') {
      try {
        frame.layoutSizingHorizontal = counterMode;
      } catch (err) {}
    }
  }

  if (primaryMode || counterMode) {
    try {
      frame.resize(
        Math.max(renderedWidth, 1),
        Math.max(renderedHeight, 1)
      );
    } catch (err) {}
  }

  applyChildLayoutSizing(frame, sourceSpec);
}

function determineAutoLayoutSizing(spec) {
  const children = getFlowChildren(spec.children);
  if (!children.length) {
    return {
      primaryFixed: hasVisibleFrameSurface(spec) && hasMeaningfulFreeSpace(spec, children, 'primary'),
      counterFixed: false,
    };
  }

  return {
    primaryFixed: shouldFixAxis(spec, children, 'primary'),
    counterFixed: shouldFixAxis(spec, children, 'counter'),
  };
}

function shouldFixAxis(spec, children, axisRole) {
  const layoutMode = spec.layoutMode;
  const axis = axisRole === 'primary'
    ? layoutMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL'
    : layoutMode === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL';

  const renderedSize = axis === 'HORIZONTAL' ? pickNumber(spec.width, 0) : pickNumber(spec.height, 0);
  const contentSize = measureAutoLayoutContentSize(spec, children, axis);
  const freeSpace = renderedSize - contentSize;
  const tolerance = 2;

  if (freeSpace <= tolerance) {
    return false;
  }

  const align = axisRole === 'primary'
    ? String(spec.primaryAxisAlignItems || 'MIN')
    : String(spec.counterAxisAlignItems || 'MIN');
  const hasSurface = hasVisibleFrameSurface(spec);

  if (axisRole === 'primary') {
    if (align === 'CENTER' || align === 'MAX') {
      return true;
    }
    if (align === 'SPACE_BETWEEN') {
      return children.length > 1 || hasSurface;
    }
    return hasSurface;
  }

  if (align === 'CENTER' || align === 'MAX' || align === 'STRETCH') {
    return true;
  }

  return false;
}

function hasMeaningfulFreeSpace(spec, children, axisRole) {
  const layoutMode = spec.layoutMode;
  const axis = axisRole === 'primary'
    ? layoutMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL'
    : layoutMode === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL';
  const renderedSize = axis === 'HORIZONTAL' ? pickNumber(spec.width, 0) : pickNumber(spec.height, 0);
  const contentSize = measureAutoLayoutContentSize(spec, children, axis);
  return renderedSize - contentSize > 2;
}

function measureAutoLayoutContentSize(spec, children, axis) {
  const startPadding = axis === 'HORIZONTAL' ? pickNumber(spec.paddingLeft, 0) : pickNumber(spec.paddingTop, 0);
  const endPadding = axis === 'HORIZONTAL' ? pickNumber(spec.paddingRight, 0) : pickNumber(spec.paddingBottom, 0);
  const spacing = pickNumber(spec.itemSpacing, 0);

  let total = startPadding + endPadding;
  let previousCount = 0;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!child || child.layoutPositioning === 'ABSOLUTE' || child._isPseudo) {
      continue;
    }

    const childSize = axis === 'HORIZONTAL'
      ? pickNumber(child.width, 0)
      : pickNumber(child.height, 0);
    total += childSize;
    previousCount++;
  }

  if (previousCount > 1) {
    total += spacing * (previousCount - 1);
  }

  return total;
}

function hasVisibleFrameSurface(spec) {
  const sourceSpec = spec || {};
  return hasVisiblePaints(sourceSpec.fills)
    || hasVisiblePaints(sourceSpec.strokes)
    || (Array.isArray(sourceSpec.effects) && sourceSpec.effects.length > 0)
    || sourceSpec.clipsContent === true
    || Boolean(sourceSpec._backgroundPattern || sourceSpec.backgroundPattern);
}

function hasVisiblePaints(paints) {
  if (!Array.isArray(paints) || paints.length === 0) {
    return false;
  }

  for (let index = 0; index < paints.length; index++) {
    const paint = paints[index];
    if (paint && paint.visible !== false && !isFullyTransparentPaint(paint)) {
      return true;
    }
  }
  return false;
}

function getFlowChildren(children) {
  if (!Array.isArray(children) || children.length === 0) {
    return [];
  }

  const flow = [];
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    if (!child || child.layoutPositioning === 'ABSOLUTE' || child._isPseudo) {
      continue;
    }
    flow.push(child);
  }
  return flow;
}

function pickNumber(primary, fallback) {
  return Number.isFinite(primary) ? primary : Number.isFinite(fallback) ? fallback : 0;
}

function buildComponentWithVariants(defaultFrame, hoverSpec) {
  try {
    const component = figma.createComponent();
    component.name = hoverSpec.componentName || defaultFrame.name;
    component.resize(defaultFrame.width, defaultFrame.height);
    component.x = defaultFrame.x;
    component.y = defaultFrame.y;

    copyFramePresentationProps(defaultFrame, component);

    for (const child of Array.from(defaultFrame.children)) {
      component.appendChild(child);
    }

    defaultFrame.remove();
    return component;
  } catch (err) {
    return defaultFrame;
  }
}

function copyFramePresentationProps(source, target) {
  copyNodeProp(source, target, 'fills');
  copyNodeProp(source, target, 'strokes');
  copyNodeProp(source, target, 'strokeWeight');
  copyNodeProp(source, target, 'strokeAlign');
  copyNodeProp(source, target, 'strokeTopWeight');
  copyNodeProp(source, target, 'strokeRightWeight');
  copyNodeProp(source, target, 'strokeBottomWeight');
  copyNodeProp(source, target, 'strokeLeftWeight');
  copyNodeProp(source, target, 'effects');
  copyNodeProp(source, target, 'opacity');
  copyNodeProp(source, target, 'clipsContent');
  copyNodeProp(source, target, 'cornerRadius');
  copyNodeProp(source, target, 'topLeftRadius');
  copyNodeProp(source, target, 'topRightRadius');
  copyNodeProp(source, target, 'bottomRightRadius');
  copyNodeProp(source, target, 'bottomLeftRadius');
  copyNodeProp(source, target, 'paddingTop');
  copyNodeProp(source, target, 'paddingRight');
  copyNodeProp(source, target, 'paddingBottom');
  copyNodeProp(source, target, 'paddingLeft');
  copyNodeProp(source, target, 'layoutMode');
  copyNodeProp(source, target, 'primaryAxisAlignItems');
  copyNodeProp(source, target, 'counterAxisAlignItems');
  copyNodeProp(source, target, 'itemSpacing');
  copyNodeProp(source, target, 'layoutWrap');
  copyNodeProp(source, target, 'counterAxisSpacing');
  copyNodeProp(source, target, 'primaryAxisSizingMode');
  copyNodeProp(source, target, 'counterAxisSizingMode');
  copyNodeProp(source, target, 'layoutSizingHorizontal');
  copyNodeProp(source, target, 'layoutSizingVertical');
}

function copyNodeProp(source, target, prop) {
  if (source[prop] === undefined) {
    return;
  }

  try {
    target[prop] = source[prop];
  } catch (err) {}
}

function applyBackgroundPattern(frame, pattern) {
  if (!pattern || pattern.kind !== 'grid') {
    return;
  }

  const layer = figma.createFrame();
  layer.name = `${frame.name} / pattern`;
  layer.x = 0;
  layer.y = 0;
  layer.resize(frame.width, frame.height);
  layer.fills = [];
  layer.strokes = [];
  layer.clipsContent = true;

  const cellWidth = Math.max(pattern.cellWidth || 1, 1);
  const cellHeight = Math.max(pattern.cellHeight || 1, 1);
  const strokeWeight = Math.max(pattern.strokeWeight || 1, 1);
  const paint = pattern.paint ? [pattern.paint] : [];

  for (let x = 0; x < frame.width; x += cellWidth) {
    const line = figma.createFrame();
    line.name = 'grid-v';
    line.x = x;
    line.y = 0;
    line.resize(strokeWeight, frame.height);
    line.fills = paint;
    line.strokes = [];
    layer.appendChild(line);
  }

  for (let y = 0; y < frame.height; y += cellHeight) {
    const line = figma.createFrame();
    line.name = 'grid-h';
    line.x = 0;
    line.y = y;
    line.resize(frame.width, strokeWeight);
    line.fills = paint;
    line.strokes = [];
    layer.appendChild(line);
  }

  frame.appendChild(layer);
}

function layoutTopLevelNodes(page) {
  let xOffset = 0;
  for (const node of page.children) {
    if (node.x === 0 && xOffset > 0) {
      node.x = xOffset + 40;
    }
    xOffset = node.x + node.width;
  }
}

function hasOutlineRuns(value) {
  const runs = Array.isArray(value) ? value : (value.textRuns || []);
  return Boolean(runs.some((run) => run && run.strokes && run.strokes.length > 0));
}

function getAlignedTextRuns(spec) {
  return alignTextRuns(String(spec.characters || ''), spec.textRuns || []);
}

function estimateRunYOffset(spec, run) {
  const lineHeight = getLineHeightPx(run.lineHeight || spec.lineHeight, run.fontSize || spec.fontSize || 16);
  return Math.max((run.lineIndex || 0) * lineHeight, 0);
}

function getLineHeightPx(lineHeight, fontSize) {
  if (!lineHeight) return fontSize;
  if (lineHeight.unit === 'PIXELS') return lineHeight.value || fontSize;
  if (lineHeight.unit === 'PERCENT') return (fontSize * (lineHeight.value || 100)) / 100;
  return fontSize;
}

function alignTextRuns(characters, runs) {
  const source = normalizeWhitespaceForSearch(characters);
  const aligned = [];
  let searchIndex = 0;

  for (const run of runs) {
    if (!run || !run.text) continue;

    const normalizedText = normalizeWhitespaceForSearch(run.text).text;
    if (!normalizedText) continue;

    let startIndex = source.text.indexOf(normalizedText, searchIndex);
    if (startIndex < 0) {
      startIndex = source.text.indexOf(normalizedText);
    }
    if (startIndex < 0) {
      continue;
    }

    const endIndex = startIndex + normalizedText.length;
    const start = source.map[startIndex] !== undefined ? source.map[startIndex] : 0;
    const end = (source.map[endIndex - 1] !== undefined ? source.map[endIndex - 1] : (characters.length - 1)) + 1;

    var pushRun = Object.assign({}, run, { start: start, end: end, text: characters.slice(start, end) || run.text });
    aligned.push(pushRun);
    searchIndex = endIndex;
  }

  return aligned;
}

function normalizeWhitespaceForSearch(value) {
  const text = String(value || '');
  let result = '';
  const map = [];
  let pendingWhitespaceIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (/\s/.test(char)) {
      if (pendingWhitespaceIndex < 0) {
        pendingWhitespaceIndex = i;
      }
      continue;
    }

    if (pendingWhitespaceIndex >= 0 && result.length > 0) {
      result += ' ';
      map.push(pendingWhitespaceIndex);
      pendingWhitespaceIndex = -1;
    }

    result += char;
    map.push(i);
  }

  return { text: result, map };
}

async function waitForJob(serverUrl, jobId, onProgress) {
  const statusUrl = getJobStatusUrl(serverUrl, jobId);
  let lastMessage = '';
  let lastPercent = -1;

  while (true) {
    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`Failed to read conversion status (${response.status})`);
    }

    const status = await response.json();
    const percent = typeof status.progress === 'number' ? status.progress : undefined;
    const message = status.message || 'Converting HTML...';

    if (message !== lastMessage || percent !== lastPercent) {
      if (onProgress) {
        onProgress(message, percent);
      } else {
        progress(message, percent);
      }
      lastMessage = message;
      lastPercent = percent;
    }

    if (status.state === 'done') {
      return status.result;
    }

    if (status.state === 'error') {
      throw new Error(status.error || 'Conversion failed.');
    }

    await sleep(500);
  }
}

function getJobStartUrl(serverUrl) {
  return `${normalizeServerUrl(serverUrl)}/jobs`;
}

function getJobStatusUrl(serverUrl, jobId) {
  return `${normalizeServerUrl(serverUrl)}/jobs/${jobId}`;
}

function normalizeServerUrl(serverUrl) {
  const clean = (serverUrl || DEFAULT_CONVERTER_URL).replace(/\/+$/, '');
  if (clean.endsWith('/convert')) {
    return clean.slice(0, -'/convert'.length);
  }
  if (clean.endsWith('/jobs')) {
    return clean.slice(0, -'/jobs'.length);
  }
  return clean;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
