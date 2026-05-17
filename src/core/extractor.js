/**
 * src/core/extractor.js
 * Renders HTML in headless Playwright, extracts computed styles
 * and bounding rects for every DOM element.
 */

import { chromium } from 'playwright-core';
import { existsSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { pathToFileURL } from 'url';

/**
 * @param {string} filePath - absolute or relative path to HTML file
 * @param {{ width: number, height: number }} viewport
 * @returns {{ domTree, title: string }}
 */
export async function extractFromFile(filePath, { width = 1440, height = 900 } = {}) {
  const absPath = resolve(filePath);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });

  await page.goto(pathToFileURL(absPath).href);
  const result = await extractFromPage(page);
  await browser.close();
  return result;
}

/**
 * @param {string} html
 * @param {{ width?: number, height?: number, baseUrl?: string | null }} options
 * @returns {{ domTree, title: string }}
 */
export async function extractFromHtml(html, { width = 1440, height = 900, baseUrl = null } = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  const htmlWithBase = injectBaseHref(html, normalizeBaseUrl(baseUrl));

  await page.setContent(htmlWithBase, { waitUntil: 'load' });
  const result = await extractFromPage(page);
  await browser.close();
  return result;
}

async function extractFromPage(page) {
  await stabilizePage(page);

  // Walk the full DOM and capture computed styles + rects
  const title = await page.title();
  const domTree = await page.evaluate(walkDOMInBrowser);
  return { domTree, title };
}

async function stabilizePage(page) {
  await page.waitForLoadState('networkidle');

  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));

    const animated = Array.from(document.querySelectorAll('*')).filter((el) => {
      const cs = window.getComputedStyle(el);
      return cs.animationName !== 'none' || cs.transitionDuration !== '0s';
    });
    animated.forEach((el) => el.setAttribute('data-morphus-animated', '1'));

    const style = document.createElement('style');
    style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.appendChild(style);

    document.querySelectorAll('[data-morphus-animated="1"]').forEach((el) => {
      const cs = window.getComputedStyle(el);
      if (cs.opacity === '0' && shouldForceAnimatedElementVisible(el, cs)) {
        el.style.opacity = '1';
        if (isTranslateOnlyTransform(cs.transform)) {
          el.style.transform = 'none';
        }
      }
    });

    limitPaginatedTableRows();

    function shouldForceAnimatedElementVisible(el, cs) {
      if (cs.display === 'none' || cs.visibility === 'hidden') {
        return false;
      }

      if (cs.position === 'absolute' || cs.position === 'fixed') {
        return false;
      }

      if (el.closest('[hidden], [aria-hidden="true"], [inert]')) {
        return false;
      }

      if (hasLiveOrProgressSemantics(el)) {
        return false;
      }

      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function hasLiveOrProgressSemantics(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      const role = String(el.getAttribute('role') || '').toLowerCase();
      if (role === 'progressbar' || role === 'status' || role === 'alert') {
        return true;
      }

      if (el.hasAttribute('aria-busy') || el.hasAttribute('aria-live')) {
        return true;
      }

      return Boolean(el.querySelector('progress, meter, [role="progressbar"], [aria-busy], [aria-live]'));
    }

    function isTranslateOnlyTransform(value) {
      if (!value || value === 'none') {
        return false;
      }

      const text = String(value).trim();
      const matrixMatch = text.match(/^matrix\(([^)]+)\)$/i);
      if (matrixMatch) {
        const values = matrixMatch[1]
          .split(',')
          .map((part) => parseFloat(part.trim()));
        if (values.length === 6 && values.every((number) => Number.isFinite(number))) {
          const tolerance = 0.001;
          return Math.abs(values[0] - 1) <= tolerance
            && Math.abs(values[1]) <= tolerance
            && Math.abs(values[2]) <= tolerance
            && Math.abs(values[3] - 1) <= tolerance;
        }
      }

      return /^translate(?:3d|x|y)?\(/i.test(text);
    }

    function limitPaginatedTableRows() {
      const pagers = Array.from(document.querySelectorAll('*')).filter((el) => isPaginationElement(el));

      for (const pager of pagers) {
        const pagerRect = pager.getBoundingClientRect();
        if (pagerRect.width <= 0 || pagerRect.height <= 0) {
          continue;
        }

        const container = findPaginatedDataContainer(pager, pagerRect);
        if (!container) {
          continue;
        }

        const rows = getDataRows(container).filter((row) => !pager.contains(row));
        if (rows.length < 8) {
          continue;
        }

        const cutoffY = pagerRect.bottom - 1;
        let hiddenCount = 0;
        for (const row of rows) {
          const rect = row.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            continue;
          }
          if (rect.top >= cutoffY) {
            row.setAttribute('data-morphus-paginated-row-clipped', '1');
            row.style.display = 'none';
            hiddenCount++;
          }
        }

        if (hiddenCount > 0) {
          container.setAttribute('data-morphus-paginated-preview', '1');
        }
      }
    }

    function isPaginationElement(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) {
        return false;
      }

      const identity = `${el.id || ''} ${String(el.className || '')} ${el.getAttribute('role') || ''}`.toLowerCase();
      if (/(pagination|paginator|pager|page-nav|page-control)/.test(identity)) {
        return true;
      }

      const text = normalizePaginationText(el.innerText || el.textContent || '');
      if (!text || text.length > 160) {
        return false;
      }

      return /\b(hal|page)\s*\d+\s*\/\s*\d+\b/i.test(text)
        || /\b(baris|rows?)\s+\d+\s*[–-]\s*\d+\b/i.test(text);
    }

    function findPaginatedDataContainer(pager, pagerRect) {
      let current = pager.parentElement;
      while (current && current !== document.documentElement) {
        const rows = getDataRows(current).filter((row) => !pager.contains(row));
        if (rows.length >= 8) {
          const before = rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.bottom <= pagerRect.top + 1;
          });
          const after = rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.top >= pagerRect.bottom - 1;
          });

          if (before.length >= 3 && after.length >= 1) {
            return current;
          }
        }

        current = current.parentElement;
      }

      return null;
    }

    function getDataRows(container) {
      const seen = new Set();
      const rows = [];
      const selectors = ['tr', '[role="row"]'];

      for (const selector of selectors) {
        for (const row of container.querySelectorAll(selector)) {
          if (seen.has(row) || row.closest('thead')) {
            continue;
          }
          seen.add(row);
          rows.push(row);
        }
      }

      return rows;
    }

    function normalizePaginationText(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }
  });

  await waitForCanvasPaint(page);
}

async function waitForCanvasPaint(page) {
  const canvasCount = await page.locator('canvas').count();
  if (canvasCount === 0) {
    return;
  }

  try {
    await page.waitForFunction(() => {
      const canvases = Array.from(document.querySelectorAll('canvas'))
        .filter((canvas) => {
          const rect = canvas.getBoundingClientRect();
          const cs = window.getComputedStyle(canvas);
          const opacity = parseFloat(cs.opacity);
          return rect.width > 0
            && rect.height > 0
            && cs.display !== 'none'
            && cs.visibility !== 'hidden'
            && (!Number.isFinite(opacity) || opacity > 0);
        });

      if (canvases.length === 0) {
        return true;
      }

      const now = performance.now();
      const state = window.__morphusCanvasCaptureState || {
        startedAt: now,
        lastSignature: '',
        stableCount: 0,
      };

      const snapshots = canvases.map((canvas) => captureCanvasSnapshot(canvas));
      const readableSnapshots = snapshots.filter((snapshot) => snapshot.readable);
      if (readableSnapshots.length === 0) {
        return true;
      }

      const signature = readableSnapshots.map((snapshot) => snapshot.signature).join('|');
      if (signature && signature === state.lastSignature) {
        state.stableCount += 1;
      } else {
        state.lastSignature = signature;
        state.stableCount = 0;
      }

      window.__morphusCanvasCaptureState = state;
      return state.stableCount >= 2 && now - state.startedAt >= 500;

      function captureCanvasSnapshot(canvas) {
        const width = Math.floor(canvas.width || 0);
        const height = Math.floor(canvas.height || 0);
        if (width <= 0 || height <= 0) {
          return { readable: false };
        }

        let src = '';
        try {
          src = canvas.toDataURL('image/png');
        } catch (err) {
          return { readable: false };
        }

        canvas.__morphusCanvasCaptureSrc = src;
        return {
          readable: Boolean(src && src !== 'data:,'),
          signature: `${width}x${height}:${src.length}:${hashString(src)}`,
        };
      }

      function hashString(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let index = 0; index < text.length; index++) {
          hash ^= text.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
      }
    }, null, { timeout: 2500, polling: 80 });
  } catch (err) {
    // Continue with the best available canvas state instead of failing conversion.
  }
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return null;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(baseUrl)) return baseUrl;

  const absPath = resolve(baseUrl);
  const targetPath = existsSync(absPath) && !statSync(absPath).isDirectory()
    ? dirname(absPath)
    : absPath;

  let href = pathToFileURL(targetPath).href;
  if (!href.endsWith('/')) {
    href += '/';
  }
  return href;
}

function injectBaseHref(html, baseHref) {
  if (!baseHref || /<base\s/i.test(html)) {
    return html;
  }

  const baseTag = `<base href="${escapeHtmlAttribute(baseHref)}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${baseTag}`);
  }

  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`);
  }

  return `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * This function is serialized and run inside the browser context.
 * It must be self-contained (no imports).
 */
function walkDOMInBrowser() {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT']);
  const TEXT_TAGS = new Set(['p', 'span', 'a', 'label', 'em', 'strong', 'b', 'i', 'small', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th']);
  const INLINE_TAGS = new Set(['span', 'a', 'label', 'em', 'strong', 'b', 'i', 'small', 'mark', 'sup', 'sub', 'u', 's', 'code', 'br', 'wbr']);
  const TEXT_INPUT_TYPES = new Set([
    '',
    'date',
    'datetime-local',
    'email',
    'month',
    'number',
    'password',
    'search',
    'tel',
    'text',
    'time',
    'url',
    'week',
  ]);

  function getNode(el, depth = 0) {
    if (SKIP_TAGS.has(el.tagName)) return null;

    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const csBefore = window.getComputedStyle(el, '::before');
    const csAfter = window.getComputedStyle(el, '::after');
    const tag = el.tagName.toLowerCase();
    const isSvg = tag === 'svg';
    const isImage = tag === 'img';
    const isCanvas = tag === 'canvas';

    // Skip invisible/zero-size elements
    if (rect.width === 0 && rect.height === 0 && cs.position === 'static') return null;
    if (isVisuallyHiddenElement(cs)) return null;

    const rawText = normalizeTextContent(el.innerText || el.textContent || '');
    const hasVisualBox =
      !isTransparentColor(cs.backgroundColor) ||
      cs.backgroundImage !== 'none' ||
      cs.borderStyle !== 'none' ||
      parseFloat(cs.borderTopWidth) > 0 ||
      parseFloat(cs.borderRightWidth) > 0 ||
      parseFloat(cs.borderBottomWidth) > 0 ||
      parseFloat(cs.borderLeftWidth) > 0 ||
      parseFloat(cs.paddingTop) > 0 ||
      parseFloat(cs.paddingRight) > 0 ||
      parseFloat(cs.paddingBottom) > 0 ||
      parseFloat(cs.paddingLeft) > 0 ||
      cs.boxShadow !== 'none';
    const hasOnlyInlineTextChildren = Boolean(rawText) && Array.from(el.children).length > 0 && Array.from(el.children).every((child) => isInlineTextChild(child));
    const isTextContainer = Boolean(rawText)
      && !hasVisualBox
      && !hasRenderablePseudo(csBefore)
      && !hasRenderablePseudo(csAfter)
      && canCollapseToTextContainer(el, tag, cs, hasOnlyInlineTextChildren);

    const beforeData = extractPseudoElementData(el, tag, cs, csBefore, 'before');
    const afterData = extractPseudoElementData(el, tag, cs, csAfter, 'after');
    const formControl = extractFormControlData(el, tag, cs);
    const nodeText = formControl ? null : rawText;
    const textData = nodeText ? extractTextData(el) : null;
    const svgMarkup = isSvg ? serializeSvgElement(el, rect) : null;
    const imageData = isImage
      ? extractImageData(el)
      : isCanvas
        ? extractCanvasImageData(el)
        : null;

    const children = isSvg || isImage || isCanvas || isTextContainer || formControl
      ? []
      : Array.from(el.childNodes)
          .map((child) => getChildNode(child, el, cs, depth + 1))
          .filter(Boolean);

    return {
      tag,
      id: el.id || null,
      classList: Array.from(el.classList),
      text: nodeText || null,
      textRuns: textData?.runs || [],
      isTextContainer,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      computed: extractRelevantStyles(cs),
      ...(formControl ? { formControl } : {}),
      ...(svgMarkup ? { svgMarkup } : {}),
      ...(imageData ? { imageData } : {}),
      pseudo: {
        before: beforeData,
        after: afterData,
      },
      children,
    };
  }

  function extractFormControlData(el, tag, computedStyles) {
    if (tag === 'select') {
      return extractSelectControlData(el);
    }

    if (tag !== 'input' && tag !== 'textarea') {
      return null;
    }

    const type = tag === 'input'
      ? String(el.getAttribute('type') || 'text').trim().toLowerCase()
      : 'textarea';

    if (tag === 'input' && !TEXT_INPUT_TYPES.has(type)) {
      return null;
    }

    const placeholder = normalizeFormControlText(el.getAttribute('placeholder') || '', tag === 'textarea');
    const value = type === 'password'
      ? ''
      : normalizeFormControlText(el.value || '', tag === 'textarea');

    if (!placeholder && !value) {
      return null;
    }

    const placeholderComputed = placeholder
      ? extractPlaceholderStyles(el, computedStyles)
      : null;

    return {
      type,
      value,
      placeholder,
      ...(placeholderComputed ? { placeholderComputed } : {}),
    };
  }

  function extractSelectControlData(el) {
    const selectedOptions = Array.from(el.selectedOptions || []);
    const renderedOptions = selectedOptions.length > 0
      ? selectedOptions
      : [el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null].filter(Boolean);
    const renderedText = normalizeFormControlText(
      renderedOptions
        .map((option) => option.label || option.textContent || '')
        .filter(Boolean)
        .join(el.multiple ? '\n' : ' ')
    );

    if (!renderedText) {
      return null;
    }

    const size = Number.parseInt(el.getAttribute('size') || '1', 10);
    return {
      type: 'select',
      value: renderedText,
      optionValue: renderedOptions[0] ? renderedOptions[0].value : el.value,
      hasChevron: !el.multiple && (!Number.isFinite(size) || size <= 1),
    };
  }

  function extractPlaceholderStyles(el, fallbackStyles) {
    try {
      const placeholderStyles = window.getComputedStyle(el, '::placeholder');
      if (placeholderStyles) {
        return extractRelevantStyles(placeholderStyles);
      }
    } catch (err) {}

    return extractRelevantStyles(fallbackStyles);
  }

  function extractRelevantStyles(cs) {
    return {
      display: cs.display,
      position: cs.position,
      zIndex: cs.zIndex,
      // Layout
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      flexWrap: cs.flexWrap,
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      gap: cs.gap,
      columnGap: cs.columnGap,
      rowGap: cs.rowGap,
      gridTemplateColumns: cs.gridTemplateColumns,
      gridTemplateRows: cs.gridTemplateRows,
      gridRow: cs.gridRow,
      gridColumn: cs.gridColumn,
      // Sizing
      width: cs.width,
      height: cs.height,
      minWidth: cs.minWidth,
      maxWidth: cs.maxWidth,
      minHeight: cs.minHeight,
      // Spacing
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      marginTop: cs.marginTop,
      marginRight: cs.marginRight,
      marginBottom: cs.marginBottom,
      marginLeft: cs.marginLeft,
      // Visual
      backgroundColor: cs.backgroundColor,
      backgroundImage: cs.backgroundImage,
      backgroundSize: cs.backgroundSize,
      backgroundPosition: cs.backgroundPosition,
      objectFit: cs.objectFit,
      objectPosition: cs.objectPosition,
      color: cs.color,
      opacity: cs.opacity,
      borderRadius: cs.borderRadius,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      borderTopRightRadius: cs.borderTopRightRadius,
      borderBottomRightRadius: cs.borderBottomRightRadius,
      borderBottomLeftRadius: cs.borderBottomLeftRadius,
      border: cs.border,
      borderWidth: cs.borderWidth,
      borderColor: cs.borderColor,
      borderStyle: cs.borderStyle,
      borderTopWidth: cs.borderTopWidth,
      borderRightWidth: cs.borderRightWidth,
      borderBottomWidth: cs.borderBottomWidth,
      borderLeftWidth: cs.borderLeftWidth,
      borderTopColor: cs.borderTopColor,
      borderRightColor: cs.borderRightColor,
      borderBottomColor: cs.borderBottomColor,
      borderLeftColor: cs.borderLeftColor,
      borderTopStyle: cs.borderTopStyle,
      borderRightStyle: cs.borderRightStyle,
      borderBottomStyle: cs.borderBottomStyle,
      borderLeftStyle: cs.borderLeftStyle,
      boxShadow: cs.boxShadow,
      overflow: cs.overflow,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      clipPath: cs.clipPath,
      mixBlendMode: cs.mixBlendMode,
      transform: cs.transform,
      // Typography
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
      textTransform: cs.textTransform,
      whiteSpace: cs.whiteSpace,
      textOverflow: cs.textOverflow,
      textDecoration: cs.textDecoration,
      webkitTextStrokeWidth: cs.webkitTextStrokeWidth,
      webkitTextStrokeColor: cs.webkitTextStrokeColor,
      // Positioning
      top: cs.top,
      right: cs.right,
      bottom: cs.bottom,
      left: cs.left,
      inset: cs.inset,
      // Content (for pseudo-elements)
      content: cs.content,
    };
  }

  function isVisuallyHiddenElement(cs) {
    if (!cs) {
      return true;
    }

    const opacity = parseFloat(cs.opacity);
    return cs.display === 'none'
      || cs.visibility === 'hidden'
      || (Number.isFinite(opacity) && opacity <= 0);
  }

  function extractImageData(el) {
    const src = String(el.currentSrc || el.src || el.getAttribute('src') || '').trim();
    if (!src) {
      return null;
    }

    return {
      src,
      alt: el.getAttribute('alt') || '',
      naturalWidth: Number.isFinite(el.naturalWidth) ? el.naturalWidth : 0,
      naturalHeight: Number.isFinite(el.naturalHeight) ? el.naturalHeight : 0,
    };
  }

  function extractCanvasImageData(el) {
    const width = Number(el.width) || 0;
    const height = Number(el.height) || 0;
    if (width <= 0 || height <= 0 || typeof el.toDataURL !== 'function') {
      return null;
    }

    let src = String(el.__morphusCanvasCaptureSrc || '');
    try {
      src = src || el.toDataURL('image/png');
    } catch (err) {
      return null;
    }

    if (!src || src === 'data:,') {
      return null;
    }

    return {
      src,
      alt: el.getAttribute('aria-label') || el.getAttribute('title') || '',
      naturalWidth: width,
      naturalHeight: height,
    };
  }

  function extractTextData(el) {
    const runs = [];
    const pieces = [];
    let lineIndex = 0;

    function pushText(text, styleEl) {
      const normalized = normalizeTextFragment(text);
      if (!normalized) return;
      pieces.push(normalized);
      runs.push({
        text: normalized,
        lineIndex,
        computed: extractTextRunStyles(window.getComputedStyle(styleEl)),
      });
    }

    function walkText(node, styleEl) {
      if (node.nodeType === Node.TEXT_NODE) {
        pushText(node.textContent || '', styleEl);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const element = node;
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'br') {
        pieces.push('\n');
        lineIndex++;
        return;
      }

      const nextStyleEl = element;
      for (const child of element.childNodes) {
        walkText(child, nextStyleEl);
      }
    }

    for (const child of el.childNodes) {
      walkText(child, el);
    }

    const text = pieces
      .join('')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();

    return { text, runs };
  }

  function extractTextRunStyles(cs) {
    return {
      display: cs.display,
      position: cs.position,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign,
      textTransform: cs.textTransform,
      color: cs.color,
      opacity: cs.opacity,
      textDecoration: cs.textDecoration,
      webkitTextStrokeWidth: cs.webkitTextStrokeWidth,
      webkitTextStrokeColor: cs.webkitTextStrokeColor,
    };
  }

  function serializeSvgElement(svgEl, rect) {
    const clone = svgEl.cloneNode(true);

    clone.setAttribute('xmlns', clone.getAttribute('xmlns') || 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', formatSvgNumber(rect.width));
    clone.setAttribute('height', formatSvgNumber(rect.height));
    clone.removeAttribute('opacity');
    if (clone.style) {
      clone.style.removeProperty('opacity');
    }

    inlineSvgPresentationStyles(svgEl, clone);

    return new XMLSerializer().serializeToString(clone);
  }

  function inlineSvgPresentationStyles(sourceRoot, cloneRoot) {
    const sourceElements = [sourceRoot].concat(Array.from(sourceRoot.querySelectorAll('*')));
    const cloneElements = [cloneRoot].concat(Array.from(cloneRoot.querySelectorAll('*')));

    for (let index = 0; index < sourceElements.length; index++) {
      const sourceEl = sourceElements[index];
      const cloneEl = cloneElements[index];
      if (!sourceEl || !cloneEl) continue;

      cloneEl.removeAttribute('data-morphus-animated');
      const cs = window.getComputedStyle(sourceEl);
      const isRoot = index === 0;

      setSvgPresentationAttribute(cloneEl, 'fill', cs.fill);
      setSvgPresentationAttribute(cloneEl, 'stroke', cs.stroke);
      setSvgPresentationAttribute(cloneEl, 'stroke-width', cs.strokeWidth);
      setSvgPresentationAttribute(cloneEl, 'stroke-linecap', cs.strokeLinecap);
      setSvgPresentationAttribute(cloneEl, 'stroke-linejoin', cs.strokeLinejoin);
      setSvgPresentationAttribute(cloneEl, 'stroke-miterlimit', cs.strokeMiterlimit);
      setSvgPresentationAttribute(cloneEl, 'stroke-dasharray', cs.strokeDasharray);
      setSvgPresentationAttribute(cloneEl, 'fill-rule', cs.fillRule);
      setSvgPresentationAttribute(cloneEl, 'clip-rule', cs.clipRule);
      setSvgPresentationAttribute(cloneEl, 'vector-effect', cs.vectorEffect);

      if (!isRoot) {
        setSvgPresentationAttribute(cloneEl, 'opacity', cs.opacity);
        setSvgPresentationAttribute(cloneEl, 'fill-opacity', cs.fillOpacity);
        setSvgPresentationAttribute(cloneEl, 'stroke-opacity', cs.strokeOpacity);
      }
    }
  }

  function setSvgPresentationAttribute(el, name, value) {
    if (!isUsableSvgPresentationValue(value)) {
      return;
    }

    el.setAttribute(name, normalizeSvgPresentationValue(value));
  }

  function isUsableSvgPresentationValue(value) {
    if (value === undefined || value === null) {
      return false;
    }

    const normalized = String(value).trim();
    return normalized !== '' && normalized !== 'normal' && normalized !== 'auto';
  }

  function normalizeSvgPresentationValue(value) {
    return String(value).trim();
  }

  function formatSvgNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return '1';
    }
    return String(Math.max(Math.round(number * 1000) / 1000, 1));
  }

  function getChildNode(child, parentEl, parentStyles, depth) {
    if (child.nodeType === Node.TEXT_NODE) {
      return getDirectTextNode(child, parentEl, parentStyles);
    }

    if (child.nodeType === Node.ELEMENT_NODE) {
      const node = getNode(child, depth);
      if (!node) {
        return null;
      }

      if (parentEl && parentStyles && clippingEnabled(parentStyles)) {
        const parentRect = parentEl.getBoundingClientRect();
        if (isClippedOutsideParent(node.rect, parentRect, parentStyles)) {
          return null;
        }
      }

      return node;
    }

    return null;
  }

  function getDirectTextNode(textNode, parentEl, parentStyles) {
    const normalizedText = normalizeTextFragment(textNode.textContent || '').trim();
    if (!normalizedText) {
      return null;
    }

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }

    if (parentEl && parentStyles && clippingEnabled(parentStyles)) {
      const parentRect = parentEl.getBoundingClientRect();
      if (isClippedOutsideParent(rect, parentRect, parentStyles)) {
        return null;
      }
    }

    const computed = extractRelevantStyles(parentStyles);
    computed.display = 'inline';
    computed.position = 'static';
    computed.width = `${rect.width}px`;
    computed.height = `${rect.height}px`;
    computed.minWidth = '0px';
    computed.minHeight = '0px';

    return {
      tag: 'span',
      id: null,
      classList: [],
      text: normalizedText,
      textRuns: [{
        text: normalizedText,
        lineIndex: 0,
        computed: extractTextRunStyles(parentStyles),
      }],
      isTextContainer: true,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      computed,
      pseudo: {
        before: null,
        after: null,
      },
      children: [],
    };
  }

  function normalizeTextFragment(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function isInlineTextChild(child) {
    if (!child || child.nodeType !== Node.ELEMENT_NODE) return false;
    const childTag = child.tagName.toLowerCase();
    if (!INLINE_TAGS.has(childTag)) return false;

    const childCs = window.getComputedStyle(child);
    if (childCs.position !== 'static') return false;
    if (childCs.display !== 'inline' && childCs.display !== 'contents') return false;
    return !hasVisualBoxForStyles(childCs);
  }

  function hasVisualBoxForStyles(cs) {
    return !isTransparentColor(cs.backgroundColor) ||
      cs.backgroundImage !== 'none' ||
      cs.borderStyle !== 'none' ||
      parseFloat(cs.borderTopWidth) > 0 ||
      parseFloat(cs.borderRightWidth) > 0 ||
      parseFloat(cs.borderBottomWidth) > 0 ||
      parseFloat(cs.borderLeftWidth) > 0 ||
      parseFloat(cs.paddingTop) > 0 ||
      parseFloat(cs.paddingRight) > 0 ||
      parseFloat(cs.paddingBottom) > 0 ||
      parseFloat(cs.paddingLeft) > 0 ||
      cs.boxShadow !== 'none';
  }

  function hasRenderablePseudo(cs) {
    if (!cs || cs.content === 'none' || cs.content === 'normal') {
      return false;
    }

    return parseCssContent(cs.content) !== '' || hasSupportedPseudoVisual(cs);
  }

  function isVisuallyHiddenPseudo(cs, rect = null, parentRect = null, parentStyles = null) {
    if (!cs) {
      return true;
    }

    const opacity = parseFloat(cs.opacity);
    if (cs.display === 'none' || cs.visibility === 'hidden' || (Number.isFinite(opacity) && opacity <= 0)) {
      return true;
    }

    if (hasCollapsedTransform(cs.transform)) {
      return true;
    }

    if (rect && isFullyClippedByClipPath(cs.clipPath, rect)) {
      return true;
    }

    if (rect && parentRect && parentStyles && isClippedOutsideParent(rect, parentRect, parentStyles)) {
      return true;
    }

    return false;
  }

  function hasCollapsedTransform(transformValue) {
    if (!transformValue || transformValue === 'none') {
      return false;
    }

    const scale = parseTransformScale(transformValue);
    if (!scale) {
      return false;
    }

    const tolerance = 0.001;
    return scale.x <= tolerance || scale.y <= tolerance;
  }

  function parseTransformScale(transformValue) {
    const value = String(transformValue).trim();
    const matrixMatch = value.match(/^matrix\(([^)]+)\)$/i);
    if (matrixMatch) {
      const values = parseTransformNumbers(matrixMatch[1]);
      if (values.length === 6) {
        return {
          x: Math.hypot(values[0], values[1]),
          y: Math.hypot(values[2], values[3]),
        };
      }
    }

    const matrix3dMatch = value.match(/^matrix3d\(([^)]+)\)$/i);
    if (matrix3dMatch) {
      const values = parseTransformNumbers(matrix3dMatch[1]);
      if (values.length === 16) {
        return {
          x: Math.hypot(values[0], values[1], values[2]),
          y: Math.hypot(values[4], values[5], values[6]),
        };
      }
    }

    return parseScaleFunction(value);
  }

  function parseTransformNumbers(value) {
    return String(value)
      .split(',')
      .map((part) => parseFloat(part.trim()))
      .filter((number) => Number.isFinite(number));
  }

  function parseScaleFunction(value) {
    const scaleX = value.match(/scaleX\(\s*([-+]?\d*\.?\d+)/i);
    const scaleY = value.match(/scaleY\(\s*([-+]?\d*\.?\d+)/i);
    const scale = value.match(/scale\(\s*([-+]?\d*\.?\d+)(?:\s*,\s*([-+]?\d*\.?\d+))?/i);

    if (scaleX || scaleY || scale) {
      const uniformScale = scale ? Math.abs(parseFloat(scale[1])) : 1;
      return {
        x: scaleX ? Math.abs(parseFloat(scaleX[1])) : uniformScale,
        y: scaleY ? Math.abs(parseFloat(scaleY[1])) : (scale?.[2] ? Math.abs(parseFloat(scale[2])) : uniformScale),
      };
    }

    return null;
  }

  function extractPseudoElementData(el, tag, parentStyles, pseudoStyles, pseudoType) {
    if (!hasRenderablePseudo(pseudoStyles)) {
      return null;
    }

    const content = parseCssContent(pseudoStyles.content);
    if (!content && !hasSupportedPseudoVisual(pseudoStyles)) {
      return null;
    }

    const parentRect = el.getBoundingClientRect();
    const rect = estimatePseudoTextRect(parentRect, parentStyles, pseudoStyles, pseudoType);
    const transformedRect = applyPseudoTransformRect(rect, pseudoStyles.transform);
    const finalRect = transformedRect || rect;

    if (isVisuallyHiddenPseudo(pseudoStyles, finalRect, parentRect, parentStyles)) {
      return null;
    }

    if (!content && (finalRect.width <= 0 || finalRect.height <= 0)) {
      return null;
    }

    if (finalRect.width === 0 && finalRect.height === 0) {
      return null;
    }

    return {
      name: `${buildPseudoName(el, tag)}::${pseudoType}`,
      type: content ? 'text' : 'box',
      content: content || null,
      rect: finalRect,
      fillColor: pseudoStyles.color,
      opacity: Number.isFinite(parseFloat(pseudoStyles.opacity)) ? parseFloat(pseudoStyles.opacity) : 1,
      position: pseudoStyles.position,
      zOrder: resolvePseudoZOrder(pseudoStyles, pseudoType),
      computed: extractRelevantStyles(pseudoStyles),
    };
  }

  function resolvePseudoZOrder(pseudoStyles, pseudoType) {
    const zIndex = parseFloat(pseudoStyles.zIndex);
    if (Number.isFinite(zIndex)) {
      return zIndex < 0 ? 'bottom' : 'top';
    }

    return pseudoType === 'before' ? 'bottom' : 'top';
  }

  function hasSupportedPseudoVisual(cs) {
    return !isTransparentColor(cs.backgroundColor) ||
      String(cs.backgroundImage || '').includes('linear-gradient') ||
      cs.borderStyle !== 'none' ||
      parseFloat(cs.borderTopWidth) > 0 ||
      parseFloat(cs.borderRightWidth) > 0 ||
      parseFloat(cs.borderBottomWidth) > 0 ||
      parseFloat(cs.borderLeftWidth) > 0 ||
      cs.boxShadow !== 'none';
  }

  function estimatePseudoTextRect(parentRect, parentStyles, pseudoStyles, pseudoType) {
    const width = parseCssPx(pseudoStyles.width);
    const height = parseCssPx(pseudoStyles.height) || parseCssPx(pseudoStyles.lineHeight) || parseCssPx(pseudoStyles.fontSize);
    const position = pseudoStyles.position;

    if (position === 'absolute' || position === 'fixed') {
      return estimatePositionedPseudoRect(parentRect, pseudoStyles, width, height);
    }

    if (parentStyles.display === 'flex' || parentStyles.display === 'inline-flex') {
      return estimateFlexPseudoRect(parentRect, parentStyles, width, height, pseudoType);
    }

    return {
      x: pseudoType === 'before' ? parentRect.x : parentRect.right - width,
      y: parentRect.y + Math.max((parentRect.height - height) / 2, 0),
      width,
      height,
    };
  }

  function applyPseudoTransformRect(rect, transformValue) {
    const matrix = parseCssTransformMatrix(transformValue);
    if (!matrix) {
      return rect;
    }

    const points = [
      transformPoint(matrix, rect.x, rect.y),
      transformPoint(matrix, rect.x + rect.width, rect.y),
      transformPoint(matrix, rect.x, rect.y + rect.height),
      transformPoint(matrix, rect.x + rect.width, rect.y + rect.height),
    ];

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
      x: minX,
      y: minY,
      width: Math.max(maxX - minX, 0),
      height: Math.max(maxY - minY, 0),
    };
  }

  function parseCssTransformMatrix(transformValue) {
    const value = String(transformValue || '').trim();
    if (!value || value === 'none') {
      return null;
    }

    const matrixMatch = value.match(/^matrix\(([^)]+)\)$/i);
    if (matrixMatch) {
      const values = parseTransformNumbers(matrixMatch[1]);
      if (values.length === 6) {
        return {
          a: values[0],
          b: values[1],
          c: values[2],
          d: values[3],
          e: values[4],
          f: values[5],
        };
      }
    }

    const matrix3dMatch = value.match(/^matrix3d\(([^)]+)\)$/i);
    if (matrix3dMatch) {
      const values = parseTransformNumbers(matrix3dMatch[1]);
      if (values.length === 16) {
        return {
          a: values[0],
          b: values[1],
          c: values[4],
          d: values[5],
          e: values[12],
          f: values[13],
        };
      }
    }

    return null;
  }

  function transformPoint(matrix, x, y) {
    return {
      x: (matrix.a * x) + (matrix.c * y) + matrix.e,
      y: (matrix.b * x) + (matrix.d * y) + matrix.f,
    };
  }

  function isFullyClippedByClipPath(clipPath, rect) {
    const value = String(clipPath || '').trim();
    if (!value || value === 'none') {
      return false;
    }

    const insetMatch = value.match(/^inset\((.+)\)$/i);
    if (!insetMatch) {
      return false;
    }

    const parts = splitInsetTokens(insetMatch[1]);
    const [topToken, rightToken, bottomToken, leftToken] = normalizeInsetTokens(parts);
    const top = resolveInsetValue(topToken, rect.height);
    const right = resolveInsetValue(rightToken, rect.width);
    const bottom = resolveInsetValue(bottomToken, rect.height);
    const left = resolveInsetValue(leftToken, rect.width);

    return rect.width - left - right <= 0 || rect.height - top - bottom <= 0;
  }

  function splitInsetTokens(value) {
    return String(value)
      .split(/\s+round\s+/i)[0]
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function normalizeInsetTokens(tokens) {
    if (tokens.length === 1) {
      return [tokens[0], tokens[0], tokens[0], tokens[0]];
    }
    if (tokens.length === 2) {
      return [tokens[0], tokens[1], tokens[0], tokens[1]];
    }
    if (tokens.length === 3) {
      return [tokens[0], tokens[1], tokens[2], tokens[1]];
    }
    return [tokens[0], tokens[1], tokens[2], tokens[3]];
  }

  function resolveInsetValue(token, size) {
    const value = String(token || '').trim();
    if (!value || value === 'auto') {
      return 0;
    }
    if (value.endsWith('%')) {
      const ratio = parseFloat(value);
      return Number.isFinite(ratio) ? (ratio / 100) * size : 0;
    }
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function isClippedOutsideParent(rect, parentRect, parentStyles) {
    if (!clippingEnabled(parentStyles)) {
      return false;
    }

    const intersectionWidth = Math.min(rect.x + rect.width, parentRect.x + parentRect.width) - Math.max(rect.x, parentRect.x);
    const intersectionHeight = Math.min(rect.y + rect.height, parentRect.y + parentRect.height) - Math.max(rect.y, parentRect.y);

    return intersectionWidth <= 0.5 || intersectionHeight <= 0.5;
  }

  function clippingEnabled(parentStyles) {
    if (!parentStyles) {
      return false;
    }

    return ['overflow', 'overflowX', 'overflowY'].some((prop) => {
      const value = String(parentStyles[prop] || '').toLowerCase();
      return value === 'hidden' || value === 'clip' || value === 'scroll' || value === 'auto';
    });
  }

  function estimatePositionedPseudoRect(parentRect, pseudoStyles, width, height) {
    const left = pseudoStyles.left !== 'auto' ? parseCssPx(pseudoStyles.left) : null;
    const right = pseudoStyles.right !== 'auto' ? parseCssPx(pseudoStyles.right) : null;
    const top = pseudoStyles.top !== 'auto' ? parseCssPx(pseudoStyles.top) : null;
    const bottom = pseudoStyles.bottom !== 'auto' ? parseCssPx(pseudoStyles.bottom) : null;

    return {
      x: parentRect.x + (left !== null ? left : parentRect.width - width - (right || 0)),
      y: parentRect.y + (top !== null ? top : parentRect.height - height - (bottom || 0)),
      width,
      height,
    };
  }

  function estimateFlexPseudoRect(parentRect, parentStyles, width, height, pseudoType) {
    const isRow = parentStyles.flexDirection !== 'column' && parentStyles.flexDirection !== 'column-reverse';
    const isReverse = parentStyles.flexDirection === 'row-reverse' || parentStyles.flexDirection === 'column-reverse';
    const isEnd = (pseudoType === 'after') !== isReverse;

    if (isRow) {
      return {
        x: isEnd ? parentRect.right - width : parentRect.x,
        y: alignCrossAxis(parentRect.y, parentRect.height, height, parentStyles.alignItems),
        width,
        height,
      };
    }

    return {
      x: alignCrossAxis(parentRect.x, parentRect.width, width, parentStyles.alignItems),
      y: isEnd ? parentRect.bottom - height : parentRect.y,
      width,
      height,
    };
  }

  function alignCrossAxis(start, parentSize, childSize, alignItems) {
    if (alignItems === 'center') {
      return start + Math.max((parentSize - childSize) / 2, 0);
    }
    if (alignItems === 'flex-end') {
      return start + Math.max(parentSize - childSize, 0);
    }
    return start;
  }

  function parseCssContent(value) {
    if (!value || value === 'none' || value === 'normal') return '';
    const trimmed = String(value).trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");
    }
    return trimmed;
  }

  function parseCssPx(value) {
    if (!value || value === 'auto' || value === 'normal' || value === 'none') return 0;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildPseudoName(el, tag) {
    const classPart = Array.from(el.classList || []).slice(0, 2).join('.');
    return classPart ? `${tag}.${classPart}` : tag;
  }

  function canCollapseToTextContainer(el, tag, cs, hasOnlyInlineTextChildren) {
    const hasElementChildren = el.children.length > 0;
    if (!hasElementChildren) {
      return true;
    }

    if (!hasOnlyInlineTextChildren) {
      return false;
    }

    return TEXT_TAGS.has(tag) || tag === 'div';
  }

function normalizeTextContent(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeFormControlText(value, preserveLineBreaks = false) {
  const text = String(value || '').replace(/\r/g, '');
  if (preserveLineBreaks) {
    return text.trim();
  }
  return normalizeTextContent(text);
}

function isTransparentColor(value) {
  return !value || value === 'transparent' || value === 'none' || value === 'rgba(0, 0, 0, 0)';
}

  return getNode(document.body);
}
