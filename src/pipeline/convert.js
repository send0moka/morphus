/**
 * Shared Morphus conversion pipeline.
 * Reused by the CLI and the local HTTP bridge for the Figma plugin.
 */

import { extractFromFile, extractFromHtml } from '../core/extractor.js';
import { installWebFontsForDom } from '../core/web-fonts.js';
import { resolveFonts } from '../figma/font-resolver.js';
import { sortByZIndex } from '../figma/z-index-sorter.js';
import { buildFigmaTree } from '../figma/mapper.js';

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

/**
 * @param {string} inputPath
 * @param {ConvertOptions} options
 */
export async function convertHtmlFile(inputPath, options = {}) {
  const viewport = normalizeViewport(options.viewport);
  return convertWithExtractor({
    extractor: () => extractFromFile(inputPath, viewport),
    source: inputPath,
    viewport,
    onProgress: options.onProgress,
  });
}

/**
 * @param {string} html
 * @param {ConvertHtmlOptions} options
 */
export async function convertHtmlString(html, options = {}) {
  const viewport = normalizeViewport(options.viewport);
  return convertWithExtractor({
    extractor: () => extractFromHtml(html, {
      ...viewport,
      baseUrl: options.baseUrl ?? null,
    }),
    source: options.sourceName ?? 'inline.html',
    viewport,
    baseUrl: options.baseUrl ?? null,
    onProgress: options.onProgress,
  });
}

async function convertWithExtractor({ extractor, source, viewport, baseUrl = null, onProgress = null }) {
  progress(onProgress, 5, 'Extracting page...');
  const { domTree, title, webFonts } = await extractor();

  progress(onProgress, 74, 'Installing web fonts...');
  const fontInstallation = await installWebFontsForDom(domTree, webFonts);
  progress(onProgress, 78, 'Resolving fonts...');
  const fontMap = await resolveFonts(domTree);
  progress(onProgress, 86, 'Building Figma tree...');
  const sorted = sortByZIndex(domTree);
  const figmaTree = buildFigmaTree(sorted, { fontMap });
  const documentTitle = normalizeDocumentTitle(title);
  progress(onProgress, 90, 'Snapshot ready. Sending to Figma...');

  return {
    version: '0.1.0',
    meta: {
      source,
      ...(documentTitle ? { title: documentTitle } : {}),
      viewport,
      ...(baseUrl ? { baseUrl } : {}),
      ...getFontInstallMeta(fontInstallation),
    },
    warnings: [],
    figmaTree,
  };
}

function getFontInstallMeta(summary) {
  if (!summary || !summary.enabled) {
    return {};
  }

  const installed = [...(summary.installed || []), ...(summary.reused || [])]
    .map((font) => ({
      family: font.family,
      style: font.style,
    }));

  if (!installed.length && !(summary.errors || []).length) {
    return {};
  }

  return {
    webFonts: {
      installed,
      errors: (summary.errors || []).map((error) => ({
        family: error.family,
        style: error.style,
        message: error.message,
      })),
    },
  };
}

function normalizeDocumentTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

function progress(onProgress, percent, message) {
  if (typeof onProgress === 'function') {
    onProgress(percent, message);
  }
}

function normalizeViewport(viewport = {}) {
  const width = Number.parseInt(viewport.width ?? DEFAULT_VIEWPORT.width, 10);
  const height = Number.parseInt(viewport.height ?? DEFAULT_VIEWPORT.height, 10);

  return {
    width: Number.isFinite(width) ? width : DEFAULT_VIEWPORT.width,
    height: Number.isFinite(height) ? height : DEFAULT_VIEWPORT.height,
  };
}

/**
 * @typedef {{ viewport?: { width?: number, height?: number } }} ConvertOptions
 * @typedef {ConvertOptions & { sourceName?: string, baseUrl?: string | null }} ConvertHtmlOptions
 */
