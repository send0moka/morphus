/**
 * src/figma/mapper.js
 * Converts the annotated DOM tree (with z-index) into
 * a Figma node tree JSON that the Figma plugin can execute.
 *
 * Output format: array of FigmaNode instructions
 * that the plugin reads and calls figma.create* for each.
 */

import {
  mapFlexLayout,
  mapPadding,
  mapOverflow,
  mapBorderRadius,
  mapBackgroundColor,
  mapBorder,
  mapBoxShadow,
  mapDropShadowFilter,
  mapTypography,
  mapTextStroke,
  shouldTruncateText,
  parseGradientLayers,
  splitCssLayers,
} from './css-to-figma.js';
import { cssColorToFigma, solidPaint as colorSolidPaint } from '../utils/color.js';
import { parsePx } from '../utils/units.js';

/**
 * @param {{ annotated: object, sortedFlat: object[] }} sorted
 * @param {{ pseudoElements, gridStrategies, hoverSpecs, fontMap }} extras
 * @returns {FigmaNode[]}
 */
export function buildFigmaTree({ annotated }, { pseudoElements = [], gridStrategies = {}, hoverSpecs = {}, fontMap = {} } = {}) {
  attachPseudoElements(annotated, pseudoElements);
  const normalizedRoot = normalizeRootStructure(annotated);

  // Build the main node tree
  return [buildNode(normalizedRoot, null, { fontMap, gridStrategies, hoverSpecs, surfaceFills: [] }, '0')];
}

function buildNode(node, parentContext, ctx, path) {
  const { computed, rect, tag, text, textRuns = [], children = [], classList, isTextContainer, _pageLayout, _role, svgMarkup, imageData } = node;

  let liIndex;
  if (tag === 'li' && parentContext?.sourceNode?.children) {
    const siblings = parentContext.sourceNode.children.filter(c => c.tag === 'li');
    const idx = siblings.indexOf(node);
    if (idx !== -1) {
      liIndex = idx + 1;
    }
  }
  const rawResolvedRect = resolveRenderedRect(node, parentContext);
  const parentResolvedRect = parentContext?.resolvedRect ?? null;
  const isLeafText = Boolean(text) && children.length === 0;
  const isText = isLeafText && Boolean(isTextContainer);
  const tableCellTextTruncationContext = getTableCellTextTruncationContext(node, parentContext, rawResolvedRect);
  const inheritedTextTruncationContext = tableCellTextTruncationContext || getInheritedTextTruncationContext(parentContext);
  const resolvedRect = isText && inheritedTextTruncationContext
    ? clampRectToTextTruncationContext(rawResolvedRect, inheritedTextTruncationContext)
    : rawResolvedRect;
  const isSvg = tag === 'svg' && Boolean(svgMarkup);
  const isImage = Boolean(imageData?.src) && (tag === 'img' || tag === 'canvas');
  const isAbsolute = isAbsoluteLikeNode(node) || node._layoutPositioning === 'ABSOLUTE';
  const childLayoutSizing = mapChildLayoutSizing(node, parentContext, resolvedRect);

  const transform = computed.transform || 'none';
  let { rotation } = parseRotationAndScale(transform);

  const writingMode = computed.writingMode || 'horizontal-tb';
  const isVerticalWritingMode = writingMode.startsWith('vertical-');

  let unrotatedWidth = resolvedRect.width;
  let unrotatedHeight = resolvedRect.height;

  if (isVerticalWritingMode && Math.abs(rotation) <= 0.01) {
    rotation = -90;
    unrotatedWidth = resolvedRect.offsetHeight || resolvedRect.height;
    unrotatedHeight = resolvedRect.offsetWidth || resolvedRect.width;
  } else if (Math.abs(rotation) > 0.01) {
    if (resolvedRect.offsetWidth && resolvedRect.offsetHeight) {
      unrotatedWidth = resolvedRect.offsetWidth;
      unrotatedHeight = resolvedRect.offsetHeight;
    } else if (Math.abs(Math.abs(rotation) - 90) < 5) {
      unrotatedWidth = resolvedRect.height;
      unrotatedHeight = resolvedRect.width;
    }
  }

  let figmaX = resolvedRect.x - (parentResolvedRect?.x ?? 0);
  let figmaY = resolvedRect.y - (parentResolvedRect?.y ?? 0);

  if (Math.abs(rotation) > 0.01) {
    const rad = (rotation * Math.PI) / 180;
    const cosVal = Math.cos(rad);
    const sinVal = Math.sin(rad);

    const cx = resolvedRect.x + resolvedRect.width / 2;
    const cy = resolvedRect.y + resolvedRect.height / 2;

    const absoluteFigmaX = cx - (unrotatedWidth / 2) * cosVal + (unrotatedHeight / 2) * sinVal;
    const absoluteFigmaY = cy - (unrotatedWidth / 2) * sinVal - (unrotatedHeight / 2) * cosVal;

    figmaX = absoluteFigmaX - (parentResolvedRect?.x ?? 0);
    figmaY = absoluteFigmaY - (parentResolvedRect?.y ?? 0);
  }

  const base = {
    id: buildStableId(tag, classList, path),
    name: buildName(tag, classList),
    type: isSvg ? 'SVG' : isImage ? 'IMAGE' : (isText && text ? 'TEXT' : 'FRAME'),
    x: Math.round(figmaX),
    y: Math.round(figmaY),
    width: Math.round(unrotatedWidth),
    height: Math.round(unrotatedHeight),
    ...(Math.abs(rotation) > 0.01 ? { rotation: roundFloat(rotation, 2) } : {}),
    ...(isAbsolute ? { layoutPositioning: 'ABSOLUTE' } : {}),
    ...childLayoutSizing,
  };

  if (isSvg) {
    return {
      ...base,
      _svgMarkup: svgMarkup,
      opacity: roundFloat(parseFloat(computed.opacity ?? 1)),
      ...(computed.mixBlendMode && computed.mixBlendMode !== 'normal' ? {
        blendMode: computed.mixBlendMode.toUpperCase().replace(/-/g, '_'),
      } : {}),
    };
  }

  if (isImage) {
    return {
      ...base,
      _image: imageData,
      opacity: roundFloat(parseFloat(computed.opacity ?? 1)),
      ...mapBorderRadius(computed, rect),
      ...mapBorder(computed),
      effects: mapVisualEffects(computed),
      ...(computed.mixBlendMode && computed.mixBlendMode !== 'normal' ? {
        blendMode: computed.mixBlendMode.toUpperCase().replace(/-/g, '_'),
      } : {}),
      ...(computed.objectFit ? { _objectFit: computed.objectFit } : {}),
      ...(computed.objectPosition ? { _objectPosition: computed.objectPosition } : {}),
    };
  }

  if (base.type === 'TEXT') {
    const typography = mapTypography(computed, ctx.fontMap, parentContext?.sourceNode?.computed);
    if (inheritedTextTruncationContext && !typography.textTruncation) {
      typography.textTruncation = 'ENDING';
    }

    const textNode = {
      ...base,
      characters: text,
      ...typography,
      ...mapFlexTextAlignment(computed),
      ...mapTextStroke(computed),
      textRuns: buildTextRuns(textRuns, ctx.fontMap),
      opacity: roundFloat(parseFloat(computed.opacity ?? 1)),
    };

    if (parentContext?.sourceNode?.tag === 'li' && parentContext?.parentLayout?.layoutMode === 'HORIZONTAL') {
      textNode._forceAutoWidth = true;
    }

    return textNode;
  }

  // Frame node
  const isGrid = computed.display === 'grid';
  const isFlex = computed.display === 'flex' || computed.display === 'inline-flex';
  const isInlineBlock = computed.display === 'inline-block';
  const flexLayoutInfo = isFlex ? getRenderableFlexLayout(node) : null;

  let layout = isFlex
    ? flexLayoutInfo?.layout
    : isInlineBlock
      ? getRenderableInlineLayout(node)
      : null;

  if (!layout && tag === 'li' && (node.pseudo?.before || node.pseudoChildren?.some(p => p.name && (p.name === 'before' || p.name.endsWith('::before'))))) {
    const children = Array.isArray(node.children) ? node.children.filter(Boolean) : [];
    const hasOnlyInlineOrSimpleChildren = children.every(child => 
      child.tag === 'span' || 
      child.tag === 'a' || 
      child.tag === 'code' || 
      child.tag === 'strong' || 
      child.tag === 'em' ||
      child.tag === 'i' ||
      child.tag === 'b' ||
      child.tag === 'u' ||
      child.tag === 'small' ||
      child.tag === 'p' ||
      child.isTextContainer ||
      !child.tag
    );

    if (hasOnlyInlineOrSimpleChildren) {
      layout = {
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 12,
      };
    }
  }
  const flexAutoMarginLayout = isFlex ? getFlexAutoMarginLayoutOverride(node, layout) : null;
  const nativeControlLayout = getNativeControlLayout(node);

  // Check if a grid strategy was provided for this element
  const gridClass = classList?.find(c => ctx.gridStrategies?.[`.${c}`]);
  const gridStrategy = gridClass ? ctx.gridStrategies[`.${gridClass}`] : null;

  // Check hover spec
  const hoverClass = classList?.find(c => ctx.hoverSpecs?.[`.${c}`]);
  const hoverSpec = hoverClass ? ctx.hoverSpecs[`.${hoverClass}`] : null;

  // Background fills
  let fills = mapBackgroundColor(computed);
  const backgroundPattern = detectBackgroundPattern(computed);

  // Handle supported CSS gradient layers in backgroundImage.
  if (!backgroundPattern && computed.backgroundImage) {
    try {
      fills.push(...parseGradientLayers(computed.backgroundImage, rect));
    } catch { /* skip malformed gradients */ }
  }

  if (fills.length === 0 && isPaginationNode(node) && Array.isArray(parentContext?.surfaceFills) && parentContext.surfaceFills.length > 0) {
    fills = clonePaints(parentContext.surfaceFills);
  }

  const nextSurfaceFills = fills.length > 0 ? clonePaints(fills) : (parentContext?.surfaceFills || []);

  const frameNode = {
    ...base,
    ...(_pageLayout ? { _pageLayout: true } : {}),
    ...(_role ? { _role } : {}),
    fills,
    ...mapPadding(computed),
    ...mapOverflow(computed),
    ...mapBorderRadius(computed, rect),
    ...mapBorder(computed),
    effects: mapVisualEffects(computed),
    opacity: roundFloat(parseFloat(computed.opacity ?? 1)),
    ...(layout || {}),
    ...(flexAutoMarginLayout || {}),
    ...(nativeControlLayout || {}),
    ...(computed.mixBlendMode && computed.mixBlendMode !== 'normal' ? {
      blendMode: computed.mixBlendMode.toUpperCase().replace(/-/g, '_'),
    } : {}),
  };

  if (layout && tag === 'li') {
    const pseudoBefore = node.pseudo?.before || node.pseudoChildren?.find(p => p.name === 'before' || p.name?.endsWith('::before'));
    const isAbsolutePseudo = pseudoBefore?.computed?.position === 'absolute';
    if (isAbsolutePseudo) {
      const originalPaddingLeft = frameNode.paddingLeft || 0;
      frameNode.paddingLeft = Math.max(0, originalPaddingLeft - 24);
    }
  }

  if (_pageLayout || tag === 'body') {
    frameNode.clipsContent = true;
  }

  // Apply grid strategy when a renderable fallback is available
  const renderableGridStrategy = isGrid ? getRenderableGridStrategy(node, gridStrategy) : null;
  if (renderableGridStrategy) {
    frameNode._gridStrategy = renderableGridStrategy;
    frameNode._gridNotes = gridStrategy.notes;
  }

  // Attach hover spec for Figma plugin to create variants
  if (hoverSpec) {
    frameNode._hoverSpec = hoverSpec;
  }
  if (backgroundPattern) {
    frameNode._backgroundPattern = backgroundPattern;
  }

  // Recurse
  const childNodes = [];
  const childTextTruncationContext = getChildTextTruncationContext(node, resolvedRect, inheritedTextTruncationContext);

  if (isLeafText) {
    const textNode = buildEmbeddedTextNode(node, ctx, `${path}.text`, resolvedRect, 'text', childTextTruncationContext);
    if (parentContext?.sourceNode?.tag === 'li' && parentContext?.parentLayout?.layoutMode === 'HORIZONTAL') {
      textNode._forceAutoWidth = true;
    }
    childNodes.push(textNode);
  }

  const controlTextNode = buildFormControlTextNode(node, ctx, `${path}.control`, resolvedRect, childTextTruncationContext);
  if (controlTextNode) {
    childNodes.push(controlTextNode);
  }
  childNodes.push(...buildFormControlDecorationNodes(node, `${path}.control`));

  const pseudoChildren = (node.pseudoChildren || []).concat(getNativePseudoChildren(node));
  const mergeablePseudoBackgrounds = [];
  const renderablePseudoChildren = [];

  for (const pseudo of pseudoChildren) {
    if (shouldMergePseudoIntoParent(node, pseudo)) {
      mergeablePseudoBackgrounds.push(...buildMergedPseudoBackgrounds(pseudo));
      continue;
    }
    renderablePseudoChildren.push(pseudo);
  }

  const pseudoBefore = renderablePseudoChildren
    .filter((pseudo) => pseudo.zOrder !== 'top')
    .map((pseudo, index) => buildPseudoNode(pseudo, `${path}.pseudo.${index}`, ctx, {
      participatesInLayout: shouldPseudoParticipateInParentLayout(node, pseudo, layout),
      liIndex,
    }))
    .filter(Boolean);
  const pseudoTop = renderablePseudoChildren
    .filter((pseudo) => pseudo.zOrder === 'top')
    .map((pseudo, index) => buildPseudoNode(pseudo, `${path}.pseudoTop.${index}`, ctx, {
      participatesInLayout: shouldPseudoParticipateInParentLayout(node, pseudo, layout),
      liIndex,
    }))
    .filter(Boolean);

  const orderedChildren = getOrderedFlowChildren(children, node);
  const builtChildPairs = orderedChildren
    .map((child, index) => ({
      source: child,
      built: buildNode(child, {
          sourceRect: rect,
          resolvedRect,
          sourceNode: node,
          textTruncationContext: childTextTruncationContext,
          surfaceFills: nextSurfaceFills,
          parentLayout: layout,
        }, ctx, `${path}.${index}`),
    }))
    .filter((pair) => Boolean(pair.built));

  frameNode.children = pseudoBefore
    .concat(childNodes)
    .concat(withFlexAutoMarginGroups(node, builtChildPairs, layout, path))
    .concat(pseudoTop);

  if (mergeablePseudoBackgrounds.length > 0) {
    frameNode.fills = frameNode.fills.concat(mergeablePseudoBackgrounds);
  }

  return frameNode;
}

function mapChildLayoutSizing(node, parentContext, resolvedRect) {
  const parentNode = parentContext?.sourceNode;
  const parentComputed = parentNode?.computed;

  if (parentNode?.tag === 'li' && parentContext?.parentLayout?.layoutMode === 'HORIZONTAL') {
    const isPseudo = node._isPseudo || node.name === 'before' || node.name === 'after' || node.name?.startsWith('[pseudo]');
    if (!isPseudo) {
      return {
        layoutSizingHorizontal: 'FILL',
      };
    }
  }

  if (!node || !resolvedRect || !parentContext?.resolvedRect || !isFlexDisplay(parentComputed?.display) || isAbsoluteLikeNode(node)) {
    return {};
  }

  const result = {};
  const parentRect = parentContext.resolvedRect;
  const parentInnerWidth = Math.max(parentRect.width - parsePx(parentComputed.paddingLeft) - parsePx(parentComputed.paddingRight), 0);
  const parentInnerHeight = Math.max(parentRect.height - parsePx(parentComputed.paddingTop) - parsePx(parentComputed.paddingBottom), 0);
  const axis = isRowFlexDirection(parentComputed.flexDirection) ? 'HORIZONTAL' : 'VERTICAL';
  const flexGrow = parseFloat(node.computed?.flexGrow);

  if (axis === 'VERTICAL' && fillsAxis(resolvedRect.width, parentInnerWidth)) {
    result.layoutSizingHorizontal = 'FILL';
  }
  if (axis === 'HORIZONTAL' && fillsAxis(resolvedRect.height, parentInnerHeight)) {
    result.layoutSizingVertical = 'FILL';
  }

  if (Number.isFinite(flexGrow) && flexGrow > 0) {
    if (axis === 'HORIZONTAL') {
      if (!shouldHugSingleTextFlexChild(parentNode, node, axis)) {
        result.layoutSizingHorizontal = 'FILL';
      }
    } else {
      result.layoutSizingVertical = 'FILL';
    }
  }

  return result;
}

function fillsAxis(childSize, parentInnerSize) {
  if (!Number.isFinite(childSize) || !Number.isFinite(parentInnerSize) || parentInnerSize <= 0) {
    return false;
  }

  return Math.abs(childSize - parentInnerSize) <= Math.max(2, parentInnerSize * 0.02);
}

function resolveRenderedRect(node, parentContext) {
  const sourceRect = node?.rect || { x: 0, y: 0, width: 0, height: 0 };
  if (!parentContext?.sourceRect || !parentContext?.resolvedRect) {
    return sourceRect;
  }

  const resolved = reprojectRectWithinParent(sourceRect, parentContext.sourceRect, parentContext.resolvedRect);
  if (shouldStretchAspectWrapper(node, parentContext)) {
    return {
      ...resolved,
      width: parentContext.resolvedRect.width,
      height: parentContext.resolvedRect.height,
      x: parentContext.resolvedRect.x + (sourceRect.x - parentContext.sourceRect.x),
      y: parentContext.resolvedRect.y + (sourceRect.y - parentContext.sourceRect.y),
    };
  }

  return resolved;
}

function reprojectRectWithinParent(childRect, sourceParentRect, resolvedParentRect) {
  const rect = childRect || { x: 0, y: 0, width: 0, height: 0 };
  const sourceParent = sourceParentRect || { x: 0, y: 0, width: 0, height: 0 };
  const resolvedParent = resolvedParentRect || sourceParent;
  const tolerance = 1.5;

  if (isSameRect(sourceParent, resolvedParent)) {
    return rect;
  }

  const leftOffset = (rect.x ?? 0) - (sourceParent.x ?? 0);
  const topOffset = (rect.y ?? 0) - (sourceParent.y ?? 0);
  const rightOffset = (sourceParent.x ?? 0) + (sourceParent.width ?? 0) - ((rect.x ?? 0) + (rect.width ?? 0));
  const bottomOffset = (sourceParent.y ?? 0) + (sourceParent.height ?? 0) - ((rect.y ?? 0) + (rect.height ?? 0));

  const fillsHorizontal = isClose(leftOffset, 0, tolerance)
    && isClose(rightOffset, 0, tolerance)
    && isClose(rect.width ?? 0, sourceParent.width ?? 0, tolerance);
  const fillsVertical = isClose(topOffset, 0, tolerance)
    && isClose(bottomOffset, 0, tolerance)
    && isClose(rect.height ?? 0, sourceParent.height ?? 0, tolerance);

  const width = fillsHorizontal ? resolvedParent.width : rect.width;
  const height = fillsVertical ? resolvedParent.height : rect.height;

  const x = fillsHorizontal
    ? resolvedParent.x + leftOffset
    : (rightOffset < leftOffset
      ? resolvedParent.x + resolvedParent.width - rightOffset - width
      : resolvedParent.x + leftOffset);

  const y = fillsVertical
    ? resolvedParent.y + topOffset
    : (bottomOffset < topOffset
      ? resolvedParent.y + resolvedParent.height - bottomOffset - height
      : resolvedParent.y + topOffset);

  return {
    x,
    y,
    width,
    height,
  };
}

function shouldStretchAspectWrapper(node, parentContext) {
  if (!node?.rect || !parentContext?.sourceRect || !parentContext?.resolvedRect) {
    return false;
  }

  if (node.computed?.position === 'absolute' || node.computed?.position === 'fixed') {
    return false;
  }

  if (parsePx(node.computed?.paddingBottom) <= 0) {
    return false;
  }

  if (!Array.isArray(node.children) || node.children.length === 0) {
    return false;
  }

  if (node.children.some((child) => !isAbsoluteLikeNode(child))) {
    return false;
  }

  if (node.pseudoChildren?.length > 0 || node?.pseudo?.before || node?.pseudo?.after) {
    return false;
  }

  const sourceRect = node.rect;
  const parentRect = parentContext.sourceRect;
  const widthMatches = isClose(sourceRect.width, parentRect.width, 2);
  const xMatches = isClose(sourceRect.x, parentRect.x, 2);
  const yMatches = isClose(sourceRect.y, parentRect.y, 2);
  const isShorter = sourceRect.height + 2 < parentRect.height;

  return widthMatches && xMatches && yMatches && isShorter;
}

function isClose(a, b, tolerance = 1.5) {
  return Math.abs((a ?? 0) - (b ?? 0)) <= tolerance;
}

function isSameRect(a, b, tolerance = 0.01) {
  return isClose(a?.x, b?.x, tolerance)
    && isClose(a?.y, b?.y, tolerance)
    && isClose(a?.width, b?.width, tolerance)
    && isClose(a?.height, b?.height, tolerance);
}

function getNativePseudoChildren(node) {
  const result = [];
  const pseudo = node?.pseudo || {};
  const rect = node?.rect || { x: 0, y: 0 };

  for (const type of ['before', 'after']) {
    const entry = pseudo[type];
    if (!entry?.rect) continue;

    result.push({
      ...entry,
      x: entry.rect.x - rect.x,
      y: entry.rect.y - rect.y,
      width: entry.rect.width,
      height: entry.rect.height,
      zOrder: entry.zOrder || (type === 'before' ? 'bottom' : 'top'),
    });
  }

  return result;
}

function buildPseudoNode(pseudo, path, ctx = {}, options = {}) {
  const pseudoId = `pseudo-${path}-${pseudo.name.replace(/\s+/g, '-').toLowerCase()}`;
  let pseudoContent = pseudo.content;
  if (pseudoContent && pseudoContent.includes('counter(')) {
    pseudoContent = resolveCounterText(pseudoContent, options.liIndex || 1);
  }
  const isTextPseudo = pseudo.type === 'text' && Boolean(pseudoContent);
  const pseudoBackgrounds = isTextPseudo ? [] : buildPseudoBackgrounds(pseudo.computed, pseudo.fillColor, pseudo);
  const pseudoBackgroundPattern = isTextPseudo ? null : detectBackgroundPattern(pseudo.computed);
  const pseudoEffects = pseudo.computed ? mapVisualEffects(pseudo.computed) : [];
  const pseudoStrokes = pseudo.computed ? mapBorder(pseudo.computed) : {};
  const textTypography = pseudo.computed
    ? {
        ...mapTypography(pseudo.computed, ctx.fontMap),
        ...mapTextStroke(pseudo.computed),
      }
    : {
        fontName: {
          family: 'Inter',
          style: 'Regular',
        },
        fontSize: Math.max(Math.min(Math.round(pseudo.height || 16), 48), 12),
        fills: pseudo.fillColor && pseudo.fillColor !== 'noise-texture'
          ? [colorSolidPaint(pseudo.fillColor)]
          : [colorSolidPaint('#ffffff')],
      };

  let pseudoWidth = pseudo.width;
  let pseudoHeight = pseudo.height;
  if (isTextPseudo && pseudoContent && options.liIndex) {
    const fontSize = textTypography.fontSize || 16;
    const estimatedWidth = Math.ceil(pseudoContent.length * fontSize * 0.65) + 4;
    const estimatedHeight = Math.ceil(fontSize * 1.2);
    if (pseudoWidth > estimatedWidth) {
      pseudoWidth = estimatedWidth;
    }
    if (pseudoHeight > estimatedHeight) {
      pseudoHeight = estimatedHeight;
    }
  }

  return {
    id: pseudoId,
    name: `[pseudo] ${pseudo.name}`,
    type: 'FRAME',
    x: Math.round(pseudo.x),
    y: Math.round(pseudo.y),
    width: Math.round(pseudoWidth),
    height: Math.round(pseudoHeight),
    ...(!options.participatesInLayout ? { layoutPositioning: 'ABSOLUTE' } : {}),
    opacity: roundFloat(pseudo.opacity ?? 1),
    fills: pseudoBackgrounds,
    ...(pseudoBackgroundPattern ? { _backgroundPattern: pseudoBackgroundPattern } : {}),
    ...(isTextPseudo ? { clipsContent: false } : {}),
    ...pseudoStrokes,
    effects: pseudoEffects,
    _isPseudo: true,
    _pseudoType: pseudo.type,
    _pseudoPosition: pseudo.position,
    children: pseudoContent ? [{
      id: `${pseudoId}-content`,
      name: 'content',
      type: 'TEXT',
      characters: pseudoContent,
      x: 0, y: 0,
      width: pseudoWidth,
      height: pseudoHeight,
      ...textTypography,
    }] : [],
  };
}

function shouldPseudoParticipateInParentLayout(node, pseudo, layout = null) {
  const hasAutoLayout = isFlexDisplay(node.computed?.display) || Boolean(layout);
  if (!node || !pseudo || !hasAutoLayout) {
    return false;
  }

  if (node.tag === 'li' && layout) {
    return true;
  }

  const position = pseudo.position || pseudo.computed?.position || 'static';
  return position !== 'absolute' && position !== 'fixed';
}

function buildFormControlTextNode(node, ctx, path, resolvedRect = null, textTruncationContext = null) {
  const rendered = resolveFormControlText(node.formControl);
  if (!rendered) {
    return null;
  }

  const computed = rendered.kind === 'placeholder'
    ? mergeFormControlTextStyles(node.computed, node.formControl?.placeholderComputed)
    : node.computed;

  return buildEmbeddedTextNode(
    {
      ...node,
      text: rendered.text,
      textRuns: [{
        text: rendered.text,
        lineIndex: 0,
        computed,
      }],
      computed,
    },
    ctx,
    path,
    resolvedRect,
    rendered.kind,
    textTruncationContext
  );
}

function buildFormControlDecorationNodes(node, path) {
  if (!isNativeSelectControl(node) || node.formControl.hasChevron === false) {
    return [];
  }

  return [buildSelectChevronNode(node, path)];
}

function getNativeControlLayout(node) {
  if (!isNativeSelectControl(node) || node.formControl.hasChevron === false) {
    return null;
  }

  return {
    layoutMode: 'HORIZONTAL',
    primaryAxisAlignItems: 'SPACE_BETWEEN',
    counterAxisAlignItems: 'CENTER',
    itemSpacing: 0,
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
  };
}

function isNativeSelectControl(node) {
  return node?.tag === 'select' && node?.formControl?.type === 'select';
}

function buildSelectChevronNode(node, path) {
  const computed = node.computed || {};
  const rect = node.rect || { width: 0, height: 0 };
  const fontSize = parsePx(computed.fontSize) || 16;
  const width = Math.max(Math.round(fontSize * 0.72), 10);
  const height = Math.max(Math.round(fontSize * 0.44), 6);
  const rightInset = parsePx(computed.paddingRight);
  const color = computed.color || 'rgb(0, 0, 0)';

  return {
    id: buildStableId(node.tag, node.classList, `${path}-chevron`),
    name: `${buildName(node.tag, node.classList)} / chevron`,
    type: 'SVG',
    x: Math.max(Math.round((rect.width || 0) - rightInset - width), 0),
    y: Math.max(Math.round(((rect.height || 0) - height) / 2), 0),
    width,
    height,
    opacity: roundFloat(parseFloat(computed.opacity ?? 1)),
    _svgMarkup: makeChevronDownSvg(width, height, color),
  };
}

function makeChevronDownSvg(width, height, color) {
  const stroke = escapeSvgAttribute(color || 'rgb(0, 0, 0)');
  const strokeWidth = Math.max(Math.round(Math.min(width, height) * 0.22), 2);
  const left = strokeWidth / 2;
  const right = width - strokeWidth / 2;
  const top = Math.max(strokeWidth / 2, 1);
  const bottom = height - strokeWidth / 2;
  const mid = width / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none"><path d="M${left} ${top} L${mid} ${bottom} L${right} ${top}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function escapeSvgAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolveFormControlText(formControl) {
  if (!formControl) {
    return null;
  }

  const value = normalizeControlText(formControl.value);
  if (value) {
    return { kind: 'value', text: value };
  }

  const placeholder = normalizeControlText(formControl.placeholder);
  if (placeholder) {
    return { kind: 'placeholder', text: placeholder };
  }

  return null;
}

function normalizeControlText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function mergeFormControlTextStyles(baseComputed, overrideComputed) {
  if (!overrideComputed) {
    return baseComputed;
  }

  const merged = { ...baseComputed };
  const textKeys = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textTransform',
    'color',
    'opacity',
    'textDecoration',
    'webkitTextStrokeWidth',
    'webkitTextStrokeColor',
  ];

  for (const key of textKeys) {
    if (overrideComputed[key] !== undefined && overrideComputed[key] !== null && overrideComputed[key] !== '') {
      merged[key] = overrideComputed[key];
    }
  }

  return merged;
}

function buildPseudoBackgrounds(computed, fallbackFillColor, rect = null) {
  if (!computed) {
    return fallbackFillColor && fallbackFillColor !== 'noise-texture'
      ? [colorSolidPaint(fallbackFillColor)]
      : [];
  }

  if (detectBackgroundPattern(computed)) {
    return mapBackgroundColor(computed);
  }

  const fills = mapBackgroundColor(computed);
  if (computed.backgroundImage) {
    fills.push(...parseGradientLayers(computed.backgroundImage, rect));
  }

  // A pseudo box inherits `color` from its parent, but that text color is not a
  // background paint. Unsupported decorative backgrounds should stay transparent.
  return fills;
}

function buildMergedPseudoBackgrounds(pseudo) {
  const paints = buildPseudoBackgrounds(pseudo.computed, pseudo.fillColor, pseudo);
  const opacity = Number.isFinite(pseudo.opacity) ? pseudo.opacity : 1;
  return paints.map((paint) => applyPaintOpacity(paint, opacity));
}

function shouldMergePseudoIntoParent(node, pseudo) {
  if (!node?.computed || !pseudo || pseudo.type === 'text' || pseudo.zOrder !== 'bottom') {
    return false;
  }

  if (detectBackgroundPattern(pseudo.computed)) {
    return false;
  }

  const position = pseudo.position;
  if (position !== 'absolute' && position !== 'fixed') {
    return false;
  }

  if (!isTransparentCssBackground(node.computed) || !pseudo.rect || !node.rect) {
    return false;
  }

  const parent = node.rect;
  const child = pseudo.rect;
  const tolerance = 1.5;
  const coversParent =
    Math.abs((child.x ?? 0) - (parent.x ?? 0)) <= tolerance &&
    Math.abs((child.y ?? 0) - (parent.y ?? 0)) <= tolerance &&
    Math.abs((child.width ?? 0) - (parent.width ?? 0)) <= tolerance &&
    Math.abs((child.height ?? 0) - (parent.height ?? 0)) <= tolerance;

  if (!coversParent) {
    return false;
  }

  return buildPseudoBackgrounds(pseudo.computed, pseudo.fillColor, pseudo).length > 0;
}

function isTransparentCssBackground(computed) {
  const backgroundColor = computed?.backgroundColor || '';
  const backgroundImage = computed?.backgroundImage || '';
  return isTransparentCssColor(backgroundColor) && backgroundImage === 'none';
}

function isTransparentCssColor(value) {
  if (!value || value === 'transparent' || value === 'none') {
    return true;
  }
  return cssColorToFigma(value).a === 0;
}

function applyPaintOpacity(paint, opacity) {
  if (!paint || opacity === 1 || !Number.isFinite(opacity)) {
    return paint;
  }

  const copy = JSON.parse(JSON.stringify(paint));
  const existing = Number.isFinite(copy.opacity) ? copy.opacity : 1;
  copy.opacity = existing * opacity;
  return copy;
}

function clonePaints(paints) {
  return (paints || []).map((paint) => JSON.parse(JSON.stringify(paint)));
}

function mapVisualEffects(computed = {}) {
  return [
    ...mapBoxShadow(computed),
    ...mapDropShadowFilter(computed),
  ];
}

function isPaginationNode(node) {
  if (!node) {
    return false;
  }

  const haystack = `${node.tag || ''} ${(node.classList || []).join(' ')} ${node.id || ''} ${node.name || ''}`.toLowerCase();
  return /(?:^|\s)(pagination|paginator|pager|page-nav|page-control)(?:\s|$)/.test(haystack)
    || /pagination|paginator|pager|page-nav|page-control/.test(haystack);
}

function buildName(tag, classList) {
  if (classList?.length > 0) return `${tag}.${classList.slice(0, 2).join('.')}`;
  return tag;
}

function buildStableId(tag, classList, path) {
  const slug = (classList?.slice(0, 2).join('-') || 'el')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'el';

  return `${tag}-${slug}-${path.replace(/\./g, '-')}`;
}

function roundFloat(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function buildEmbeddedTextNode(node, ctx, path, resolvedRect = null, nameSuffix = 'text', textTruncationContext = null) {
  const { computed, rect, tag, text, textRuns = [], classList } = node;
  const insetX = parsePx(computed.paddingLeft);
  const insetY = parsePx(computed.paddingTop);
  const sourceRect = resolvedRect || rect;
  const initialTextRect = {
    x: sourceRect.x + insetX,
    y: sourceRect.y + insetY,
    width: Math.max(sourceRect.width - insetX - parsePx(computed.paddingRight), 1),
    height: Math.max(sourceRect.height - insetY - parsePx(computed.paddingBottom), 1),
  };
  const textRect = textTruncationContext
    ? clampRectToTextTruncationContext(initialTextRect, textTruncationContext)
    : initialTextRect;
  const typography = mapTypography(computed, ctx.fontMap, node.computed);
  if (textTruncationContext && !typography.textTruncation) {
    typography.textTruncation = 'ENDING';
  }

  return {
    id: buildStableId(tag, classList, `${path}-inner`),
    name: `${buildName(tag, classList)} / ${nameSuffix}`,
    type: 'TEXT',
    x: Math.round(textRect.x - sourceRect.x),
    y: Math.round(textRect.y - sourceRect.y),
    width: Math.max(Math.round(textRect.width), 1),
    height: Math.max(Math.round(textRect.height), 1),
    characters: text,
    ...typography,
    ...mapFlexTextAlignment(computed),
    ...mapTextStroke(computed),
    textRuns: buildTextRuns(textRuns, ctx.fontMap),
  };
}

function isTableCellNode(node) {
  const tag = String(node?.tag || '').toLowerCase();
  if (tag === 'td' || tag === 'th') {
    return true;
  }

  if (String(node?.computed?.display || '').toLowerCase() === 'table-cell') {
    return true;
  }

  const identity = `${node?.id || ''} ${(node?.classList || []).join(' ')}`.toLowerCase();
  // Match only when 'cell', 'td', or 'th' is a standalone word (surrounded by spaces)
  // or when 'table-cell' appears as an exact phrase.
  // Avoid false positives like 'excel' or 'cancel'.
  return /(?:^|\s)(?:cell|td|th)(?:$|\s)|table-cell/.test(identity);
}

function isTableRowNode(node) {
  const tag = String(node?.tag || '').toLowerCase();
  if (tag === 'tr') {
    return true;
  }

  if (String(node?.computed?.display || '').toLowerCase() === 'table-row') {
    return true;
  }

  const identity = `${node?.id || ''} ${(node?.classList || []).join(' ')}`.toLowerCase();
  // Match only when 'row' is a standalone class (surrounded by spaces, not a suffix like 'flex-row').
  // Tailwind classes like 'flex-row' must NOT match — they are layout helpers, not table rows.
  return /(?:^|\s)row(?:$|\s)|table-row|data-row/.test(identity);
}

function isLikelyRowCellNode(node, parentNode) {
  if (!node || !parentNode || !isTableRowNode(parentNode)) {
    return false;
  }

  const nodeRect = node.rect || {};
  const parentRect = parentNode.rect || {};
  const width = Number(nodeRect.width);
  const parentWidth = Number(parentRect.width);
  const height = Number(nodeRect.height);
  const parentHeight = Number(parentRect.height);

  return Number.isFinite(width)
    && Number.isFinite(parentWidth)
    && width > 0
    && parentWidth > 0
    && width <= parentWidth * 0.98
    && (!Number.isFinite(height) || !Number.isFinite(parentHeight) || height <= parentHeight * 1.2);
}

function getTableCellTextTruncationContext(node, parentContext, rect) {
  const parentNode = parentContext?.sourceNode;
  if (!isTableCellNode(node) && !isTableCellNode(parentNode) && !isLikelyRowCellNode(node, parentNode)) {
    return null;
  }

  const sourceNode = isTableCellNode(node) || isLikelyRowCellNode(node, parentNode)
    ? node
    : parentNode;
  const sourceRect = isTableCellNode(node) || isLikelyRowCellNode(node, parentNode)
    ? rect
    : parentContext?.resolvedRect;

  return createTextTruncationContext(sourceRect, sourceNode?.computed);
}

function getInheritedTextTruncationContext(parentContext) {
  // Only propagate a truncation context that was explicitly established by a
  // table-cell (or equivalent) ancestor.  We intentionally do NOT synthesise a
  // new context here from shouldTruncateText because that would truncate every
  // fixed-width element whose text happens to carry text-overflow:ellipsis,
  // which is not the intended behaviour — truncation should be table-only.
  if (parentContext?.textTruncationContext) {
    return parentContext.textTruncationContext;
  }

  return null;
}

function getChildTextTruncationContext(node, resolvedRect, inheritedContext) {
  // Only create a new truncation context when the node itself is a table cell
  // (or a div-based row cell).  For all other nodes we just pass through any
  // context that was already established by a table ancestor.
  if (node && isTableCellNode(node) && shouldTruncateText(node.computed, null)) {
    return createTextTruncationContext(resolvedRect, node.computed);
  }

  return inheritedContext;
}


function createTextTruncationContext(rect, computed = {}) {
  if (!rect) {
    return null;
  }

  const left = rect.x + parsePx(computed.paddingLeft);
  const right = rect.x + rect.width - parsePx(computed.paddingRight);
  const top = rect.y + parsePx(computed.paddingTop);
  const bottom = rect.y + rect.height - parsePx(computed.paddingBottom);

  return {
    left,
    right: Math.max(right, left + 1),
    top,
    bottom: Math.max(bottom, top + 1),
  };
}

function clampRectToTextTruncationContext(rect, context) {
  if (!rect || !context) {
    return rect;
  }

  const left = Math.max(rect.x, context.left);
  const right = Math.min(rect.x + rect.width, context.right);
  const width = Math.max(right - left, 1);

  return {
    ...rect,
    x: left,
    width,
  };
}

function getOrderedChildren(children) {
  const items = (children || [])
    .filter(Boolean)
    .map((child, index) => ({
      child,
      index,
      layerZ: getLayerZ(child),
    }));

  if (items.length <= 1) {
    return items.map((item) => item.child);
  }

  const hasLayering = items.some((item) => Number.isFinite(item.layerZ));
  if (!hasLayering) {
    return items.map((item) => item.child);
  }

  return items
    .sort((a, b) => {
      const zA = Number.isFinite(a.layerZ) ? a.layerZ : 0;
      const zB = Number.isFinite(b.layerZ) ? b.layerZ : 0;
      if (zA !== zB) {
        return zA - zB;
      }
      return a.index - b.index;
    })
    .map((item) => item.child);
}

function getOrderedFlowChildren(children, parentNode) {
  const ordered = getOrderedChildren(children);
  if (!isReverseFlexDirection(parentNode?.computed?.flexDirection)) {
    return ordered;
  }

  const zValues = ordered
    .map((child) => getLayerZ(child))
    .filter((value) => Number.isFinite(value));
  const hasMeaningfulLayering = new Set(zValues).size > 1;
  if (hasMeaningfulLayering) {
    return ordered;
  }

  return [...ordered].reverse();
}

function normalizeReverseFlexLayout(computed, layout) {
  if (!layout || !isReverseFlexDirection(computed?.flexDirection)) {
    return layout;
  }

  return {
    ...layout,
    primaryAxisAlignItems: reversePrimaryAxisAlign(layout.primaryAxisAlignItems),
  };
}

function isReverseFlexDirection(flexDirection) {
  return flexDirection === 'row-reverse' || flexDirection === 'column-reverse';
}

function reversePrimaryAxisAlign(value) {
  if (value === 'MIN') {
    return 'MAX';
  }
  if (value === 'MAX') {
    return 'MIN';
  }
  return value;
}

function getLayerZ(node) {
  if (!node) {
    return null;
  }

  if (Number.isFinite(node.effectiveZ)) {
    return node.effectiveZ;
  }

  const zIndex = parseFloat(node.computed?.zIndex);
  return Number.isFinite(zIndex) ? zIndex : null;
}

function attachPseudoElements(root, pseudoElements) {
  if (!root || !Array.isArray(pseudoElements) || pseudoElements.length === 0) return;

  for (const pseudo of pseudoElements) {
    const target = findBestPseudoParent(root, pseudo) || root;
    const relative = {
      ...pseudo,
      x: Math.round(pseudo.x - (target.rect?.x ?? 0)),
      y: Math.round(pseudo.y - (target.rect?.y ?? 0)),
    };
    if (!target.pseudoChildren) {
      target.pseudoChildren = [];
    }
    target.pseudoChildren.push(relative);
  }
}

function normalizeRootStructure(root) {
  if (!root || root.tag !== 'body' || !Array.isArray(root.children) || root.children.length === 0) {
    return root;
  }

  const headerChildren = root.children.filter((child) => isTopHeaderChild(child, root.rect));
  if (headerChildren.length === 0 || headerChildren.length === root.children.length) {
    return {
      ...root,
      _pageLayout: true,
    };
  }

  const otherChildren = root.children.filter((child) => !isTopHeaderChild(child, root.rect));
  const syntheticHeader = buildSyntheticGroup('header', headerChildren);
  return {
    ...root,
    _pageLayout: true,
    children: [syntheticHeader].concat(otherChildren),
  };
}

function isTopHeaderChild(node, rootRect) {
  if (!node?.rect || !node?.computed) return false;

  const position = node.computed.position;
  if (position !== 'fixed' && position !== 'absolute') {
    return false;
  }

  const nearTop = Math.abs((node.rect.y ?? 0) - (rootRect?.y ?? 0)) <= 8;
  const wideEnough = (node.rect.width ?? 0) >= Math.max((rootRect?.width ?? 0) * 0.6, 320);
  const shortEnough = (node.rect.height ?? 0) <= Math.max((rootRect?.height ?? 0) * 0.2, 220);
  return nearTop && wideEnough && shortEnough;
}

function buildSyntheticGroup(tag, children) {
  const rect = unionRects(children.map((child) => child.rect).filter(Boolean));
  const maxZ = Math.max(...children.map((child) => child.effectiveZ ?? 0), 0);

  return {
    tag,
    id: null,
    classList: [],
    _role: 'header',
    text: null,
    textRuns: [],
    isTextContainer: false,
    rect,
    computed: {
      display: 'block',
      position: 'static',
      zIndex: String(maxZ),
      flexDirection: 'row',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      flexWrap: 'nowrap',
      gap: '0px',
      columnGap: '0px',
      rowGap: '0px',
      gridTemplateColumns: 'none',
      gridTemplateRows: 'none',
      gridRow: 'auto',
      gridColumn: 'auto',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      minWidth: '0px',
      maxWidth: 'none',
      minHeight: '0px',
      paddingTop: '0px',
      paddingRight: '0px',
      paddingBottom: '0px',
      paddingLeft: '0px',
      marginTop: '0px',
      marginRight: '0px',
      marginBottom: '0px',
      marginLeft: '0px',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      backgroundSize: 'auto',
      backgroundPosition: '0% 0%',
      color: 'rgba(0, 0, 0, 0)',
      opacity: '1',
      borderRadius: '0px',
      borderTopLeftRadius: '0px',
      borderTopRightRadius: '0px',
      borderBottomRightRadius: '0px',
      borderBottomLeftRadius: '0px',
      border: '0px none rgba(0, 0, 0, 0)',
      borderWidth: '0px',
      borderColor: 'rgba(0, 0, 0, 0)',
      borderStyle: 'none',
      boxShadow: 'none',
      overflow: 'visible',
      overflowX: 'visible',
      overflowY: 'visible',
      mixBlendMode: 'normal',
      transform: 'none',
      fontFamily: 'Inter',
      fontSize: '16px',
      fontWeight: '400',
      fontStyle: 'normal',
      lineHeight: 'normal',
      letterSpacing: 'normal',
      textAlign: 'left',
      textTransform: 'none',
      whiteSpace: 'normal',
      textDecoration: 'none',
      webkitTextStrokeWidth: '0px',
      webkitTextStrokeColor: 'rgba(0, 0, 0, 0)',
      top: 'auto',
      right: 'auto',
      bottom: 'auto',
      left: 'auto',
      inset: 'auto',
      content: 'none',
    },
    pseudo: {
      before: null,
      after: null,
    },
    children,
    effectiveZ: maxZ,
  };
}

function unionRects(rects) {
  if (!Array.isArray(rects) || rects.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

function getRenderableGridStrategy(node, gridStrategy) {
  if (!node || !gridStrategy?.outerFrame || !Array.isArray(node.children) || node.children.length < 2) {
    return null;
  }

  const axis = detectLinearChildAxis(node.children);
  if (!axis) {
    return null;
  }

  return {
    ...gridStrategy.outerFrame,
    layoutMode: axis,
    itemSpacing: measureAxisSpacing(node.children, axis),
  };
}

function getRenderableInlineLayout(node) {
  if (!node?.computed || node.computed.display !== 'inline-block') {
    return null;
  }

  const children = Array.isArray(node.children) ? node.children.filter(Boolean) : [];
  if (children.length === 0) {
    return null;
  }

  if (children.some((child) => !child?.rect || isAbsoluteLikeNode(child))) {
    return null;
  }

  const detectedAxis = detectLinearChildAxis(children);
  if (detectedAxis === 'VERTICAL') {
    return null;
  }

  return {
    layoutMode: 'HORIZONTAL',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    itemSpacing: measureAxisSpacing(children, 'HORIZONTAL'),
  };
}

function getRenderableFlexLayout(node) {
  if (!node?.computed) {
    return null;
  }

  const children = getPresentChildren(node);
  const layout = normalizeReverseFlexLayout(node.computed, mapFlexLayout(node.computed));
  if (children.length === 0) {
    return { layout: withFlexSizing(node, [], layout) };
  }

  const flowChildren = getFlowChildren(node);
  if (shouldStartAlignSingleTextFlexRow(node, flowChildren, layout)) {
    layout.primaryAxisAlignItems = 'MIN';
  }

  if (flowChildren.length === 0) {
    return { layout: withFlexSizing(node, flowChildren, layout) };
  }

  if (flowChildren.some((child) => !child?.rect)) {
    return { layout: withFlexSizing(node, flowChildren, layout) };
  }

  const axis = isRowFlexDirection(node.computed.flexDirection) ? 'HORIZONTAL' : 'VERTICAL';
  const measuredSpacing = measureAxisSpacing(flowChildren, axis);
  const cssSpacing = layout.itemSpacing || 0;
  if (layout.primaryAxisAlignItems !== 'SPACE_BETWEEN' && measuredSpacing > cssSpacing) {
    layout.itemSpacing = measuredSpacing;
  }

  return {
    layout: withFlexSizing(node, flowChildren, layout),
  };
}

function getFlexAutoMarginLayoutOverride(node, layout) {
  const autoMargin = getDominantFlexAutoMargin(node, layout);
  if (!autoMargin) {
    return null;
  }

  return {
    primaryAxisAlignItems: 'SPACE_BETWEEN',
    itemSpacing: 0,
    primaryAxisSizingMode: 'FIXED',
  };
}

function withFlexAutoMarginGroups(parentNode, childPairs, layout, path) {
  if (!isFlexDisplay(parentNode?.computed?.display) || !Array.isArray(childPairs) || childPairs.length === 0) {
    return childPairs.map((pair) => pair.built);
  }

  const autoMargin = getDominantFlexAutoMargin(parentNode, layout);
  if (!autoMargin) {
    return childPairs.map((pair) => pair.built);
  }

  const splitIndex = childPairs.findIndex((pair) => pair.source === autoMargin.child);
  if (splitIndex < 0) {
    return childPairs.map((pair) => pair.built);
  }

  if (autoMargin.edge === 'start') {
    const before = childPairs.slice(0, splitIndex);
    const after = childPairs.slice(splitIndex);
    return compactFlexAutoMarginGroups(parentNode, before, after, autoMargin.axis, path);
  }

  const before = childPairs.slice(0, splitIndex + 1);
  const after = childPairs.slice(splitIndex + 1);
  return compactFlexAutoMarginGroups(parentNode, before, after, autoMargin.axis, path);
}

function compactFlexAutoMarginGroups(parentNode, beforePairs, afterPairs, axis, path) {
  const result = [];
  const beforeGroup = buildFlexAutoMarginGroup(parentNode, beforePairs, axis, `${path}.autoMargin.before`, 'start');
  const afterGroup = buildFlexAutoMarginGroup(parentNode, afterPairs, axis, `${path}.autoMargin.after`, 'end');

  if (beforeGroup) {
    result.push(beforeGroup);
  }
  if (afterGroup) {
    result.push(afterGroup);
  }

  return result.length > 0 ? result : beforePairs.concat(afterPairs).map((pair) => pair.built);
}

function buildFlexAutoMarginGroup(parentNode, pairs, axis, path, side) {
  const visiblePairs = (pairs || []).filter((pair) => pair?.built);
  if (visiblePairs.length === 0) {
    return null;
  }

  if (visiblePairs.length === 1) {
    return visiblePairs[0].built;
  }

  const groupRect = unionRects(visiblePairs.map((pair) => specToRect(pair.built)).filter(Boolean));
  const children = visiblePairs.map((pair) => rebaseSpecToGroup(pair.built, groupRect));
  const itemSpacing = measureSpecAxisSpacing(visiblePairs.map((pair) => pair.built), axis);
  const parentCounterAlign = mapFlexLayout(parentNode?.computed || {}).counterAxisAlignItems || 'MIN';
  const sideName = axis === 'HORIZONTAL'
    ? side === 'start' ? 'left' : 'right'
    : side === 'start' ? 'top' : 'bottom';
  const parentName = buildName(parentNode?.tag || 'div', parentNode?.classList || []);

  return {
    id: `flex-auto-margin-group-${path}`,
    name: `${parentName} / ${sideName}`,
    type: 'FRAME',
    x: Math.round(groupRect.x),
    y: Math.round(groupRect.y),
    width: Math.round(groupRect.width),
    height: Math.round(groupRect.height),
    fills: [],
    strokes: [],
    effects: [],
    opacity: 1,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    layoutMode: axis,
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: parentCounterAlign,
    itemSpacing,
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    children,
    _isLayoutGroup: true,
  };
}

function getDominantFlexAutoMargin(parentNode, layout) {
  if (!isFlexDisplay(parentNode?.computed?.display)) {
    return null;
  }

  const children = getFlowChildren(parentNode);
  if (children.length < 2) {
    return null;
  }

  const axis = isRowFlexDirection(parentNode.computed.flexDirection) ? 'HORIZONTAL' : 'VERTICAL';
  const freeSpace = measureFlexFreeSpaceBySum(parentNode, children, axis, layout?.itemSpacing || 0);
  if (freeSpace <= 8) {
    return null;
  }

  let best = null;
  for (let index = 0; index < children.length; index++) {
    for (const edge of ['start', 'end']) {
      const margin = getMainAxisMargin(children[index].computed, parentNode.computed, axis, edge);
      const dominantThreshold = Math.max(16, freeSpace * 0.45);
      if (margin < dominantThreshold) {
        continue;
      }

      if (!best || margin > best.margin) {
        best = { child: children[index], edge, axis, margin };
      }
    }
  }

  return best;
}

function getMainAxisMargin(childComputed = {}, parentComputed = {}, axis, edge) {
  const direction = String(parentComputed?.flexDirection || 'row').toLowerCase();
  if (axis === 'HORIZONTAL') {
    const useRight = direction === 'row-reverse';
    const prop = edge === 'start'
      ? useRight ? 'marginRight' : 'marginLeft'
      : useRight ? 'marginLeft' : 'marginRight';
    return parsePx(childComputed?.[prop]);
  }

  const useBottom = direction === 'column-reverse';
  const prop = edge === 'start'
    ? useBottom ? 'marginBottom' : 'marginTop'
    : useBottom ? 'marginTop' : 'marginBottom';
  return parsePx(childComputed?.[prop]);
}

function specToRect(spec) {
  if (!spec) {
    return null;
  }

  return {
    x: Number.isFinite(spec.x) ? spec.x : 0,
    y: Number.isFinite(spec.y) ? spec.y : 0,
    width: Number.isFinite(spec.width) ? spec.width : 0,
    height: Number.isFinite(spec.height) ? spec.height : 0,
  };
}

function rebaseSpecToGroup(spec, groupRect) {
  return {
    ...spec,
    x: Math.round((Number.isFinite(spec.x) ? spec.x : 0) - groupRect.x),
    y: Math.round((Number.isFinite(spec.y) ? spec.y : 0) - groupRect.y),
  };
}

function measureSpecAxisSpacing(specs, axis) {
  const gaps = measureSpecAxisGaps(specs, axis);
  let minGap = null;
  for (let index = 0; index < gaps.length; index++) {
    if (minGap === null || gaps[index] < minGap) {
      minGap = gaps[index];
    }
  }

  return Math.max(Math.round(minGap ?? 0), 0);
}

function measureSpecAxisGaps(specs, axis) {
  const items = [...(specs || [])]
    .filter((spec) => spec && Number.isFinite(spec.x) && Number.isFinite(spec.y))
    .sort((a, b) => axis === 'HORIZONTAL' ? a.x - b.x : a.y - b.y);

  const gaps = [];
  for (let index = 1; index < items.length; index++) {
    const prev = specToRect(items[index - 1]);
    const current = specToRect(items[index]);
    const gap = axis === 'HORIZONTAL'
      ? current.x - (prev.x + prev.width)
      : current.y - (prev.y + prev.height);
    if (gap >= 0) {
      gaps.push(gap);
    }
  }

  return gaps;
}

function withFlexSizing(node, flowChildren, layout) {
  const axis = isRowFlexDirection(node.computed.flexDirection) ? 'HORIZONTAL' : 'VERTICAL';
  const result = { ...layout };
  const primaryFreeSpace = measureFlexFreeSpace(node, flowChildren, axis);
  const counterFreeSpace = measureFlexFreeSpace(node, flowChildren, axis === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL');
  const primaryAlign = String(result.primaryAxisAlignItems || 'MIN').toUpperCase();
  const counterAlign = String(result.counterAxisAlignItems || 'MIN').toUpperCase();
  const wraps = result.layoutWrap === 'WRAP';

  if (wraps || primaryFreeSpace > 2 || primaryAlign === 'CENTER' || primaryAlign === 'MAX' || primaryAlign === 'SPACE_BETWEEN') {
    result.primaryAxisSizingMode = 'FIXED';
  }

  if (wraps || counterFreeSpace > 2 || counterAlign === 'CENTER' || counterAlign === 'MAX' || counterAlign === 'STRETCH') {
    result.counterAxisSizingMode = 'FIXED';
  }

  return result;
}

function measureFlexFreeSpaceBySum(node, children, axis, itemSpacing = 0) {
  const rect = node?.rect;
  if (!rect) {
    return 0;
  }

  const computed = node.computed || {};
  const renderedSize = axis === 'HORIZONTAL' ? rect.width : rect.height;
  const startPadding = axis === 'HORIZONTAL' ? parsePx(computed.paddingLeft) : parsePx(computed.paddingTop);
  const endPadding = axis === 'HORIZONTAL' ? parsePx(computed.paddingRight) : parsePx(computed.paddingBottom);
  const items = (children || []).filter((child) => child?.rect);
  const itemSize = items.reduce((total, child) => {
    return total + (axis === 'HORIZONTAL' ? child.rect.width : child.rect.height);
  }, 0);
  const gaps = Math.max(items.length - 1, 0) * Math.max(itemSpacing || 0, 0);

  return Math.max(renderedSize - startPadding - endPadding - itemSize - gaps, 0);
}

function measureFlexFreeSpace(node, children, axis) {
  const rect = node?.rect;
  if (!rect) {
    return 0;
  }

  const computed = node.computed || {};
  const renderedSize = axis === 'HORIZONTAL' ? rect.width : rect.height;
  const startPadding = axis === 'HORIZONTAL' ? parsePx(computed.paddingLeft) : parsePx(computed.paddingTop);
  const endPadding = axis === 'HORIZONTAL' ? parsePx(computed.paddingRight) : parsePx(computed.paddingBottom);
  const items = (children || []).filter((child) => child?.rect);

  if (items.length === 0) {
    return Math.max(renderedSize - startPadding - endPadding, 0);
  }

  if (axis === 'HORIZONTAL') {
    const left = Math.min(...items.map((child) => child.rect.x));
    const right = Math.max(...items.map((child) => child.rect.x + child.rect.width));
    return Math.max(renderedSize - startPadding - endPadding - (right - left), 0);
  }

  const top = Math.min(...items.map((child) => child.rect.y));
  const bottom = Math.max(...items.map((child) => child.rect.y + child.rect.height));
  return Math.max(renderedSize - startPadding - endPadding - (bottom - top), 0);
}

function isRowFlexDirection(flexDirection) {
  return flexDirection !== 'column' && flexDirection !== 'column-reverse';
}

function isAbsoluteLikeNode(node) {
  const position = node?.computed?.position;
  return position === 'absolute' || position === 'fixed';
}

function getPresentChildren(node) {
  return Array.isArray(node?.children) ? node.children.filter(Boolean) : [];
}

function getFlowChildren(node) {
  return getPresentChildren(node).filter((child) => !isAbsoluteLikeNode(child));
}

function shouldStartAlignSingleTextFlexRow(node, flowChildren, layout) {
  const axis = isRowFlexDirection(node?.computed?.flexDirection) ? 'HORIZONTAL' : 'VERTICAL';
  if (axis !== 'HORIZONTAL' || flowChildren.length !== 1 || !isTextLikeNode(flowChildren[0])) {
    return false;
  }

  if (!singleTextChildUsesPrimaryStretch(node, flowChildren[0])) {
    return false;
  }

  if (hasVisibleFrameSurface(node?.computed)) {
    return false;
  }

  const primaryAlign = String(layout?.primaryAxisAlignItems || 'MIN').toUpperCase();
  return primaryAlign === 'CENTER' || primaryAlign === 'MAX' || primaryAlign === 'SPACE_BETWEEN';
}

function singleTextChildUsesPrimaryStretch(parentNode, childNode) {
  const flexGrow = parseFloat(childNode?.computed?.flexGrow);
  if (Number.isFinite(flexGrow) && flexGrow > 0) {
    return true;
  }

  const parentRect = parentNode?.rect;
  const childRect = childNode?.rect;
  if (!parentRect || !childRect) {
    return false;
  }

  const computed = parentNode.computed || {};
  const parentInnerWidth = Math.max(parentRect.width - parsePx(computed.paddingLeft) - parsePx(computed.paddingRight), 0);
  return fillsAxis(childRect.width, parentInnerWidth);
}

function shouldHugSingleTextFlexChild(parentNode, childNode, axis) {
  if (axis !== 'HORIZONTAL' || !parentNode || !childNode) {
    return false;
  }

  const flowChildren = getFlowChildren(parentNode);
  if (flowChildren.length !== 1 || flowChildren[0] !== childNode || !isTextLikeNode(childNode)) {
    return false;
  }

  return shouldStartAlignSingleTextFlexRow(parentNode, flowChildren, mapFlexLayout(parentNode.computed || {}));
}

function isTextLikeNode(node) {
  return Boolean(node?.text && node?.isTextContainer);
}

function hasVisibleFrameSurface(computed = {}) {
  if (!isTransparentCssColor(computed.backgroundColor)) {
    return true;
  }

  const backgroundImage = String(computed.backgroundImage || 'none').trim().toLowerCase();
  if (backgroundImage && backgroundImage !== 'none') {
    return true;
  }

  const boxShadow = String(computed.boxShadow || 'none').trim().toLowerCase();
  if (boxShadow && boxShadow !== 'none') {
    return true;
  }

  return hasVisibleBorder(computed);
}

function hasVisibleBorder(computed = {}) {
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  return sides.some((side) => {
    const width = parsePx(computed[`border${side}Width`] ?? computed.borderWidth);
    const style = String(computed[`border${side}Style`] ?? computed.borderStyle ?? 'none').toLowerCase();
    const color = computed[`border${side}Color`] ?? computed.borderColor ?? computed.color;
    return width > 0 && style !== 'none' && style !== 'hidden' && !isTransparentCssColor(color);
  });
}

function hasSignificantFlexChildMargins(children, axis) {
  return children.some((child) => {
  const computed = child?.computed || {};
    if (axis === 'HORIZONTAL') {
      return Math.abs(parsePx(computed.marginLeft)) > 0.5 || Math.abs(parsePx(computed.marginRight)) > 0.5;
    }

    return Math.abs(parsePx(computed.marginTop)) > 0.5 || Math.abs(parsePx(computed.marginBottom)) > 0.5;
  });
}

function hasUnevenFlexChildGaps(children, axis) {
  const gaps = measureAxisGaps(children, axis);
  if (gaps.length <= 1) {
    return false;
  }

  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  const tolerance = Math.max(8, Math.round(Math.abs(minGap) * 0.25));
  return maxGap - minGap > tolerance;
}

function isFlexDisplay(display) {
  return display === 'flex' || display === 'inline-flex';
}

function detectLinearChildAxis(children) {
  const tolerance = 8;
  const xs = groupAxisValues(children.map((child) => child.rect?.x ?? 0), tolerance);
  const ys = groupAxisValues(children.map((child) => child.rect?.y ?? 0), tolerance);

  if (ys.length === 1 && xs.length > 1) {
    return 'HORIZONTAL';
  }
  if (xs.length === 1 && ys.length > 1) {
    return 'VERTICAL';
  }
  return null;
}

function groupAxisValues(values, tolerance) {
  const sorted = [...values].sort((a, b) => a - b);
  const groups = [];

  for (const value of sorted) {
    const prev = groups[groups.length - 1];
    if (prev === undefined || Math.abs(value - prev) > tolerance) {
      groups.push(value);
    }
  }

  return groups;
}

function measureAxisGaps(children, axis) {
  const items = [...children]
    .filter((child) => child?.rect)
    .sort((a, b) => axis === 'HORIZONTAL' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y);

  const gaps = [];
  for (let index = 1; index < items.length; index++) {
    const prev = items[index - 1].rect;
    const current = items[index].rect;
    const gap = axis === 'HORIZONTAL'
      ? current.x - (prev.x + prev.width)
      : current.y - (prev.y + prev.height);
    if (gap >= 0) {
      gaps.push(gap);
    }
  }

  return gaps;
}

function measureAxisSpacing(children, axis) {
  const gaps = measureAxisGaps(children, axis);
  let minGap = null;
  for (let index = 0; index < gaps.length; index++) {
    if (minGap === null || gaps[index] < minGap) {
      minGap = gaps[index];
    }
  }

  return Math.max(Math.round(minGap ?? 0), 0);
}

function findBestPseudoParent(node, pseudo) {
  let best = null;

  function walk(current, depth = 0) {
    if (!current || !current.rect || current.isTextContainer) return;

    const score = scorePseudoParent(current, pseudo, depth);
    if (score > 0 && (!best || score > best.score)) {
      best = { node: current, score };
    }

    for (const child of current.children || []) {
      walk(child, depth + 1);
    }
  }

  walk(node, 0);
  return best?.node ?? null;
}

function scorePseudoParent(node, pseudo, depth) {
  const rect = node.rect;
  if (!rect) return 0;

  const nodeArea = Math.max(rect.width * rect.height, 1);
  const pseudoArea = Math.max((pseudo.width || 0) * (pseudo.height || 0), 1);
  const contains =
    pseudo.x >= rect.x - 8 &&
    pseudo.y >= rect.y - 8 &&
    pseudo.x + pseudo.width <= rect.x + rect.width + 8 &&
    pseudo.y + pseudo.height <= rect.y + rect.height + 8;
  const intersects =
    pseudo.x < rect.x + rect.width &&
    pseudo.x + pseudo.width > rect.x &&
    pseudo.y < rect.y + rect.height &&
    pseudo.y + pseudo.height > rect.y;

  if (!contains && !intersects) {
    return 0;
  }

  const haystack = `${node.tag ?? ''} ${(node.classList || []).join(' ')} ${node.name ?? ''}`.toLowerCase();
  const tokens = String(pseudo.name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2);
  let tokenHits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) tokenHits++;
  }

  if (tokenHits === 0 && depth > 0) {
    const nearSizedContainer = nodeArea <= pseudoArea * 64;
    if (!nearSizedContainer) {
      return 0;
    }
  }

  let score = tokenHits * 1000;
  if (contains) score += 500;
  else if (intersects) score += 120;
  score += Math.min(400, Math.round(100000 / nodeArea));
  score += Math.min(100, depth * 5);
  score += Math.min(80, Math.round(100000 / pseudoArea));
  return score;
}

function buildTextRuns(runs, fontMap) {
  return (runs || [])
    .filter((run) => run && run.text)
    .map((run) => ({
      text: run.text,
      lineIndex: run.lineIndex || 0,
      ...mapTypography(run.computed, fontMap),
      ...mapTextStroke(run.computed),
    }));
}

function mapFlexTextAlignment(computed) {
  if (!computed || (computed.display !== 'flex' && computed.display !== 'inline-flex')) {
    return {};
  }

  const isRow = computed.flexDirection !== 'column' && computed.flexDirection !== 'column-reverse';
  const primary = mapFlexTextAxisAlignment(computed.justifyContent, 'primary');
  const counter = mapFlexTextAxisAlignment(computed.alignItems, 'counter');
  const result = {};

  if (isRow) {
    if (primary.horizontal) result.textAlignHorizontal = primary.horizontal;
    if (counter.vertical) result.textAlignVertical = counter.vertical;
  } else {
    if (counter.horizontal) result.textAlignHorizontal = counter.horizontal;
    if (primary.vertical) result.textAlignVertical = primary.vertical;
  }

  return result;
}

function mapFlexTextAxisAlignment(value, axisRole) {
  const normalized = String(value || '').toLowerCase();
  const horizontalMap = {
    center: 'CENTER',
    'flex-start': 'LEFT',
    start: 'LEFT',
    left: 'LEFT',
    'flex-end': 'RIGHT',
    end: 'RIGHT',
    right: 'RIGHT',
  };
  const verticalMap = {
    center: 'CENTER',
    'flex-start': 'TOP',
    start: 'TOP',
    'flex-end': 'BOTTOM',
    end: 'BOTTOM',
  };

  return {
    horizontal: horizontalMap[normalized] || null,
    vertical: verticalMap[normalized] || null,
    axisRole,
  };
}

function detectBackgroundPattern(computed) {
  if (!computed) {
    return null;
  }

  const backgroundImage = computed.backgroundImage || '';
  const backgroundSize = computed.backgroundSize || '';
  if (!backgroundImage.includes('linear-gradient')) {
    return null;
  }

  const repeatingPattern = detectRepeatingLinearGridPattern(backgroundImage);
  if (repeatingPattern) {
    return repeatingPattern;
  }

  return detectSizedLinearGridPattern(backgroundImage, backgroundSize);
}

function detectSizedLinearGridPattern(backgroundImage, backgroundSize) {
  if (!String(backgroundSize || '').includes('px')) {
    return null;
  }

  const layers = splitCssLayers(backgroundImage)
    .filter((layer) => /^linear-gradient\(/i.test(layer.trim()));
  if (layers.length < 2) {
    return null;
  }

  const size = parseBackgroundGridSize(backgroundSize);
  const color = findVisibleCssColor(backgroundImage);
  if (!size || !color) {
    return null;
  }

  return {
    kind: 'grid',
    cellWidth: size.width,
    cellHeight: size.height,
    strokeWeight: detectGridStrokeWeight(layers) || 1,
    paint: colorSolidPaint(color),
    verticalLines: true,
    horizontalLines: true,
  };
}

function detectRepeatingLinearGridPattern(backgroundImage) {
  const layers = splitCssLayers(backgroundImage)
    .map((layer) => parseRepeatingLinearGridLayer(layer))
    .filter(Boolean);

  if (layers.length === 0) {
    return null;
  }

  const vertical = layers.find((layer) => layer.axis === 'x');
  const horizontal = layers.find((layer) => layer.axis === 'y');
  if (!vertical && !horizontal) {
    return null;
  }

  const first = vertical || horizontal;
  return {
    kind: 'grid',
    cellWidth: Math.max(Math.round(vertical?.cellSize || horizontal?.cellSize || 1), 1),
    cellHeight: Math.max(Math.round(horizontal?.cellSize || vertical?.cellSize || 1), 1),
    strokeWeight: Math.max(Math.round(Math.min(
      vertical?.strokeWeight || horizontal?.strokeWeight || 1,
      horizontal?.strokeWeight || vertical?.strokeWeight || 1
    )), 1),
    paint: colorSolidPaint((vertical || horizontal).color),
    verticalLines: Boolean(vertical),
    horizontalLines: Boolean(horizontal),
  };
}

function parseRepeatingLinearGridLayer(layer) {
  const source = String(layer || '').trim();
  if (!/^repeating-linear-gradient\(/i.test(source)) {
    return null;
  }

  const color = findVisibleCssColor(source);
  const positions = extractPxPositions(source);
  if (!color || positions.length < 2) {
    return null;
  }

  const axis = getLinearGradientAxis(source);
  const unique = Array.from(new Set(positions.map((value) => roundFloat(value, 3)))).sort((a, b) => a - b);
  const cellSize = Math.max(...unique);
  const strokeWeight = getSmallestPositiveGap(unique) || 1;
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    return null;
  }

  return { axis, cellSize, strokeWeight, color };
}

function parseBackgroundGridSize(backgroundSize) {
  const values = extractPxPositions(String(backgroundSize || '').split(',')[0] || '');
  if (values.length === 0) {
    return null;
  }

  return {
    width: Math.max(Math.round(values[0]), 1),
    height: Math.max(Math.round(values[1] || values[0]), 1),
  };
}

function detectGridStrokeWeight(layers) {
  const weights = [];
  for (const layer of layers) {
    const positions = Array.from(new Set(extractPxPositions(layer))).sort((a, b) => a - b);
    const gap = getSmallestPositiveGap(positions);
    if (gap) weights.push(gap);
  }
  return weights.length ? Math.max(Math.round(Math.min(...weights)), 1) : 1;
}

function getSmallestPositiveGap(values) {
  let best = null;
  for (let index = 1; index < values.length; index++) {
    const gap = values[index] - values[index - 1];
    if (gap > 0 && (best === null || gap < best)) {
      best = gap;
    }
  }
  return best;
}

function extractPxPositions(value) {
  return (String(value || '').match(/-?[\d.]+px/g) || [])
    .map((part) => parseFloat(part))
    .filter((number) => Number.isFinite(number));
}

function findVisibleCssColor(value) {
  const matches = String(value || '').match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || [];
  for (const match of matches) {
    if (cssColorToFigma(match).a > 0) {
      return match;
    }
  }
  return null;
}

function getLinearGradientAxis(layer) {
  const lower = String(layer || '').toLowerCase();
  if (/repeating-linear-gradient\(\s*(90deg|270deg|to\s+(right|left))/.test(lower)) {
    return 'x';
  }
  return 'y';
}

function toRoman(num, uppercase = true) {
  const romanLookup = [
    ['M', 1000],
    ['CM', 900],
    ['D', 500],
    ['CD', 400],
    ['C', 100],
    ['XC', 90],
    ['L', 50],
    ['XL', 40],
    ['X', 10],
    ['IX', 9],
    ['V', 5],
    ['IV', 4],
    ['I', 1]
  ];
  let res = '';
  let val = num;
  for (const [str, amount] of romanLookup) {
    while (val >= amount) {
      res += str;
      val -= amount;
    }
  }
  return uppercase ? res : res.toLowerCase();
}

function toAlpha(num, uppercase = true) {
  let res = '';
  let val = num;
  while (val > 0) {
    const mod = (val - 1) % 26;
    res = String.fromCharCode((uppercase ? 65 : 97) + mod) + res;
    val = Math.floor((val - 1) / 26);
  }
  return res;
}

function resolveCounterText(content, index) {
  if (!content) return '';
  const trimmed = content.trim();

  // Format: counter(name, style)
  const counterMatch = trimmed.match(/counter\([^,]+,\s*([^)]+)\)/);
  if (counterMatch) {
    const style = counterMatch[1].trim().toLowerCase();
    if (style === 'decimal-leading-zero') {
      return String(index).padStart(2, '0');
    }
    if (style === 'upper-roman') {
      return toRoman(index, true);
    }
    if (style === 'lower-roman') {
      return toRoman(index, false);
    }
    if (style === 'lower-alpha' || style === 'lower-latin') {
      return toAlpha(index, false);
    }
    if (style === 'upper-alpha' || style === 'upper-latin') {
      return toAlpha(index, true);
    }
    return String(index);
  }

  // Format: counter(name)
  if (trimmed.includes('counter(')) {
    return String(index);
  }

  return content;
}

function parseRotationAndScale(transform) {
  if (!transform || transform === 'none') {
    return { rotation: 0, scaleX: 1, scaleY: 1 };
  }

  const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/i);
  if (matrixMatch) {
    const values = matrixMatch[1].split(',').map((part) => parseFloat(part.trim()));
    if (values.length === 6 && values.every(Number.isFinite)) {
      const [a, b, c, d] = values;
      const angleRad = Math.atan2(b, a);
      const rotation = angleRad * (180 / Math.PI);
      const scaleX = Math.hypot(a, b);
      const scaleY = Math.hypot(c, d);
      return { rotation, scaleX, scaleY };
    }
  }

  const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/i);
  if (matrix3dMatch) {
    const values = matrix3dMatch[1].split(',').map((part) => parseFloat(part.trim()));
    if (values.length === 16 && values.every(Number.isFinite)) {
      const a = values[0];
      const b = values[1];
      const c = values[4];
      const d = values[5];
      const angleRad = Math.atan2(b, a);
      const rotation = angleRad * (180 / Math.PI);
      const scaleX = Math.hypot(a, b);
      const scaleY = Math.hypot(c, d);
      return { rotation, scaleX, scaleY };
    }
  }

  return { rotation: 0, scaleX: 1, scaleY: 1 };
}
