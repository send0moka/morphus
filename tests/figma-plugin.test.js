import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeNode(type) {
  return {
    type,
    name: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    children: [],
    fills: [],
    strokes: [],
    characters: '',
    strokeWeight: undefined,
    strokeAlign: undefined,
    strokeTopWeight: undefined,
    strokeRightWeight: undefined,
    strokeBottomWeight: undefined,
    strokeLeftWeight: undefined,
    appendChild(child) {
      this.children.push(child);
      child.parent = this;
    },
    resize(width, height) {
      this.width = width;
      this.height = height;
    },
    remove() {
      this.removed = true;
    },
    setRangeFontName() {},
    setRangeFontSize() {},
    setRangeFills() {},
    setRangeLineHeight() {},
    setRangeLetterSpacing() {},
    setRangeTextCase() {},
    setRangeTextDecoration(start, end, value) {
      this.rangeTextDecorations = this.rangeTextDecorations || [];
      this.rangeTextDecorations.push({ start, end, value });
    },
    setRangeTextDecorationStyle(start, end, value) {
      this.rangeTextDecorationStyles = this.rangeTextDecorationStyles || [];
      this.rangeTextDecorationStyles.push({ start, end, value });
    },
    setRangeTextDecorationColor(start, end, value) {
      this.rangeTextDecorationColors = this.rangeTextDecorationColors || [];
      this.rangeTextDecorationColors.push({ start, end, value });
    },
    setRangeTextDecorationThickness(start, end, value) {
      this.rangeTextDecorationThicknesses = this.rangeTextDecorationThicknesses || [];
      this.rangeTextDecorationThicknesses.push({ start, end, value });
    },
  };
}

const AVAILABLE_FONT_NAMES = [
  { family: 'Inter', style: 'Regular' },
  { family: 'Inter', style: 'Italic' },
  { family: 'Inter', style: 'Medium' },
  { family: 'Inter', style: 'Bold' },
  { family: 'Georgia', style: 'Regular' },
  { family: 'Georgia', style: 'Italic' },
  { family: 'Georgia', style: 'Bold' },
  { family: 'Georgia', style: 'Bold Italic' },
  { family: 'Courier New', style: 'Regular' },
  { family: 'Courier New', style: 'Italic' },
  { family: 'Playfair Display', style: 'Regular' },
  { family: 'Playfair Display', style: 'Bold' },
];

function createFigmaMock() {
  const page = makeNode('PAGE');
  const paintStyles = [];
  const textStyles = [];
  const uiMessages = [];
  const notifications = [];
  return {
    page,
    paintStyles,
    textStyles,
    uiMessages,
    notifications,
    figma: {
      ui: {
        onmessage: null,
        postMessage(message) {
          uiMessages.push(message);
        },
      },
      currentPage: page,
      showUI() {},
      notify(message) {
        notifications.push(message);
      },
      createFrame() {
        return makeNode('FRAME');
      },
      createText() {
        return makeNode('TEXT');
      },
      createComponent() {
        return makeNode('COMPONENT');
      },
      createNodeFromSvg(svg) {
        const node = makeNode('FRAME');
        node.svgMarkup = svg;
        return node;
      },
      createImage(bytes) {
        return {
          hash: `image-${bytes.length}`,
        };
      },
      async listAvailableFontsAsync() {
        return AVAILABLE_FONT_NAMES.map((fontName) => ({ fontName }));
      },
      async loadFontAsync() {},
      async getLocalPaintStylesAsync() {
        return paintStyles;
      },
      async getLocalTextStylesAsync() {
        return textStyles;
      },
      createPaintStyle() {
        return {
          id: `paint-style-${paintStyles.length + 1}`,
          name: '',
          paints: [],
          description: '',
          remove() {
            this.removed = true;
          },
        };
      },
      createTextStyle() {
        return {
          id: `text-style-${textStyles.length + 1}`,
          name: '',
          description: '',
          remove() {
            this.removed = true;
          },
        };
      },
    },
  };
}

function frameSpec(name, overrides = {}) {
  return {
    name,
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    fills: [],
    strokes: [],
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    clipsContent: false,
    effects: [],
    children: [],
    ...overrides,
  };
}

function textSpec(name, overrides = {}) {
  return {
    name,
    type: 'TEXT',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    characters: '',
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    lineHeight: { unit: 'AUTO' },
    textAlignHorizontal: 'LEFT',
    fills: [],
    ...overrides,
  };
}

test('fixes only the auto-layout axis that needs rendered free space', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  const navLinks = frameSpec('ul.nav-links', {
    x: 893,
    y: 36,
    width: 487,
    height: 21,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'MIN',
    itemSpacing: 40,
    children: [
      frameSpec('li', { width: 66, height: 21 }),
      frameSpec('li', { width: 94, height: 21 }),
      frameSpec('li', { width: 54, height: 21 }),
      frameSpec('li', { width: 152, height: 21 }),
    ],
  });

  await context.buildFromSnapshot({
    figmaTree: [
      frameSpec('nav', {
        width: 1440,
        height: 93,
        paddingTop: 28,
        paddingRight: 60,
        paddingBottom: 28,
        paddingLeft: 60,
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'SPACE_BETWEEN',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 0,
        children: [
          frameSpec('a.logo', { width: 59, height: 37 }),
          navLinks,
        ],
      }),
    ],
  });

  const nav = page.children[0];
  const builtNavLinks = nav.children[1];

  expect(nav.primaryAxisSizingMode).toBe('FIXED');
  expect(nav.layoutSizingHorizontal).toBe('FIXED');
  expect(nav.counterAxisSizingMode).toBeUndefined();
  expect(builtNavLinks.primaryAxisSizingMode).toBeUndefined();
  expect(builtNavLinks.layoutSizingHorizontal).toBeUndefined();
});

test('uses width-and-height auto resize for explicit multiline text', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      {
        name: 'h2.section-title',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 230,
        height: 123,
        characters: 'Layanan\nUnggulan',
        fontName: { family: 'Playfair Display', style: 'Bold' },
        fontSize: 56,
        fills: [],
      },
    ],
  });

  const title = page.children[0];
  expect(title.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  expect(title.width).toBe(0);
});

test('preserves centered multiline text box width outside auto layout', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      textSpec('h3', {
        width: 316,
        height: 67,
        characters: 'The Art of\nLayering',
        fontName: { family: 'Georgia', style: 'Regular' },
        fontSize: 25.6,
        textAlignHorizontal: 'CENTER',
      }),
    ],
  });

  const title = page.children[0];
  expect(title.textAutoResize).toBe('HEIGHT');
  expect(title.textAlignHorizontal).toBe('CENTER');
  expect(title.width).toBe(316);
  expect(title.height).toBe(67);
});

test('keeps explicitly truncated text fixed and enables ending ellipsis', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      textSpec('p.truncate', {
        width: 274,
        height: 20,
        characters: 'Belanja Iuran Jaminan Kesehatan bagi Peserta PBPU dan BP Kelas 3',
        textTruncation: 'ENDING',
      }),
    ],
  });

  const label = page.children[0];
  expect(label.textTruncation).toBe('ENDING');
  expect(label.maxLines).toBe(1);
  expect(label.textAutoResize).toBe('NONE');
  expect(label.width).toBe(274);
  expect(label.height).toBe(20);
});

test('uses auto width for table-cell nowrap text', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      textSpec('td.nama-paket span', {
        width: 274,
        height: 20,
        characters: 'RUMAH SAKIT UMUM DAERAH BANYUMAS',
        whiteSpace: 'nowrap',
      }),
    ],
  });

  const label = page.children[0];
  expect(label.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  expect(label.textTruncation).toBeUndefined();
});

test('keeps centered flex text boxes fixed so vertical middle alignment can apply', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      {
        name: 'div.work-accent',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 810,
        height: 810,
        characters: 'NOVA',
        fontName: { family: 'Bebas Neue', style: 'Regular' },
        fontSize: 120,
        textAlignHorizontal: 'CENTER',
        textAlignVertical: 'CENTER',
        fills: [],
      },
    ],
  });

  const accent = page.children[0];
  expect(accent.textAutoResize).toBe('NONE');
  expect(accent.textAlignHorizontal).toBe('CENTER');
  expect(accent.textAlignVertical).toBe('CENTER');
});

test('auto-sizes rendered single-line text without class-specific widths', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      frameSpec('div.author-avatar', {
        width: 46,
        height: 46,
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        children: [
          textSpec('span', {
            width: 12,
            height: 21,
            characters: 'AR',
            textAlignHorizontal: 'CENTER',
          }),
        ],
      }),
      frameSpec('div.author-info', {
        width: 110,
        height: 16,
        children: [
          textSpec('div.author-role', {
            width: 110,
            height: 16,
            characters: 'CEO, Nusantara Collective',
            fontSize: 12,
          }),
        ],
      }),
      textSpec('div.testimonial-stars', {
        width: 800,
        height: 19,
        characters: '★★★★★',
        textAlignHorizontal: 'CENTER',
        fontSize: 14,
      }),
      textSpec('div.announcement span', {
        width: 510,
        height: 15,
        characters: 'COMPLIMENTARY SHIPPING ON ALL ORDERS - WORLDWIDE DELIVERY',
        textAlignHorizontal: 'CENTER',
        fontSize: 11.5,
        letterSpacing: { value: 3, unit: 'PIXELS' },
      }),
    ],
  });

  const initials = page.children[0].children[0];
  const role = page.children[1].children[0];
  const centeredBoxText = page.children[2];
  const announcement = page.children[3];

  expect(initials.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  expect(role.textAutoResize).toBe('WIDTH_AND_HEIGHT');
  expect(centeredBoxText.textAutoResize).toBe('HEIGHT');
  expect(centeredBoxText.width).toBe(800);
  expect(announcement.textAutoResize).toBe('WIDTH_AND_HEIGHT');
});

test('keeps single-child centered flex containers fixed when rendered free space matters', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      frameSpec('div.ba-divider', {
        width: 60,
        height: 120,
        layoutMode: 'HORIZONTAL',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        children: [
          frameSpec('div.ba-divider-inner', {
            x: 30,
            width: 1,
            height: 120,
            fills: [{
              type: 'SOLID',
              color: { r: 0.54, g: 0.51, b: 0.46 },
              opacity: 1,
            }],
          }),
        ],
      }),
    ],
  });

  const divider = page.children[0];
  expect(divider.primaryAxisSizingMode).toBe('FIXED');
  expect(divider.layoutSizingHorizontal).toBe('FIXED');
  expect(divider.width).toBe(60);
});

test('honors explicit auto-layout sizing modes from the snapshot', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      frameSpec('div.margin-flex', {
        width: 320,
        height: 180,
        layoutMode: 'VERTICAL',
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'MIN',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
        children: [
          frameSpec('div.first', {
            y: 24,
            width: 120,
            height: 30,
            layoutPositioning: 'ABSOLUTE',
          }),
        ],
      }),
    ],
  });

  const frame = page.children[0];
  expect(frame.primaryAxisSizingMode).toBe('FIXED');
  expect(frame.counterAxisSizingMode).toBe('FIXED');
  expect(frame.layoutSizingVertical).toBe('FIXED');
  expect(frame.layoutSizingHorizontal).toBe('FIXED');
  expect(frame.children[0].layoutPositioning).toBe('ABSOLUTE');
});

test('applies child fill sizing from the snapshot', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      frameSpec('div.card', {
        width: 600,
        height: 240,
        layoutMode: 'VERTICAL',
        children: [
          frameSpec('div.card-header', {
            width: 552,
            height: 23,
            layoutMode: 'HORIZONTAL',
            layoutSizingHorizontal: 'FILL',
            primaryAxisAlignItems: 'SPACE_BETWEEN',
            primaryAxisSizingMode: 'FIXED',
            counterAxisSizingMode: 'FIXED',
          }),
        ],
      }),
    ],
  });

  const card = page.children[0];
  const header = card.children[0];
  expect(header.layoutSizingHorizontal).toBe('FILL');
  expect(header.primaryAxisSizingMode).toBe('FIXED');
});

test('applies auto-layout wrap properties from the snapshot', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      frameSpec('div.toolbar', {
        width: 702,
        height: 119,
        layoutMode: 'HORIZONTAL',
        layoutWrap: 'WRAP',
        itemSpacing: 12,
        counterAxisSpacing: 16,
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'FIXED',
      }),
    ],
  });

  const toolbar = page.children[0];
  expect(toolbar.layoutWrap).toBe('WRAP');
  expect(toolbar.itemSpacing).toBe(12);
  expect(toolbar.counterAxisSpacing).toBe(16);
  expect(toolbar.primaryAxisSizingMode).toBe('FIXED');
  expect(toolbar.counterAxisSizingMode).toBe('FIXED');
});

test('creates local styles only for reusable values and prunes stale generated styles', async () => {
  const { figma, paintStyles, textStyles } = createFigmaMock();
  paintStyles.push(
    {
      id: 'stale-paint',
      name: 'Morphus / Color / Purple / 900 / OLD',
      paints: [],
      remove() {
        this.removed = true;
      },
    },
    {
      id: 'custom-paint',
      name: 'Brand / Color / Neutral / 50',
      paints: [],
      remove() {
        this.removed = true;
      },
    }
  );
  textStyles.push({
    id: 'stale-text',
    name: 'Morphus / Typography / Body / XS / Regular / OLD',
    remove() {
      this.removed = true;
    },
  });

  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  const sharedFill = [{
    type: 'SOLID',
    color: { r: 0.96, g: 0.95, b: 0.93 },
    opacity: 1,
  }];
  const oneOffFill = [{
    type: 'SOLID',
    color: { r: 0.2, g: 0.1, b: 0.08 },
    opacity: 1,
  }];

  await context.buildFromSnapshot({
    figmaTree: [
      textSpec('p.first', {
        characters: 'Shared copy one',
        fontSize: 16,
        fills: sharedFill,
      }),
      textSpec('p.second', {
        characters: 'Shared copy two',
        fontSize: 16,
        fills: sharedFill,
      }),
      textSpec('h1.once', {
        characters: 'One off heading',
        fontSize: 48,
        fills: oneOffFill,
      }),
    ],
  });

  const activePaintStyles = paintStyles.filter((style) => !style.removed);
  const activeTextStyles = textStyles.filter((style) => !style.removed);
  const generatedPaintStyles = activePaintStyles.filter((style) => style.name.startsWith('Morphus / '));
  const generatedTextStyles = activeTextStyles.filter((style) => style.name.startsWith('Morphus / '));

  expect(paintStyles.find((style) => style.id === 'stale-paint').removed).toBe(true);
  expect(textStyles.find((style) => style.id === 'stale-text').removed).toBe(true);
  expect(paintStyles.find((style) => style.id === 'custom-paint').removed).toBeUndefined();

  expect(generatedPaintStyles).toHaveLength(1);
  expect(generatedPaintStyles[0].paints).toEqual(sharedFill);
  expect(generatedTextStyles).toHaveLength(1);
  expect(generatedTextStyles[0].fontSize).toBe(16);
});

test('uses document title as local style namespace without pruning other imports', async () => {
  const { figma, paintStyles, textStyles } = createFigmaMock();
  paintStyles.push(
    {
      id: 'previous-paint',
      name: 'First Landing / Color / Green / 500',
      paints: [],
      remove() {
        this.removed = true;
      },
    },
    {
      id: 'stale-current-paint',
      name: 'Second Landing / Color / Purple / 900 / OLD',
      paints: [],
      remove() {
        this.removed = true;
      },
    }
  );
  textStyles.push(
    {
      id: 'previous-text',
      name: 'First Landing / Typography / Body / MD / Regular',
      remove() {
        this.removed = true;
      },
    },
    {
      id: 'stale-current-text',
      name: 'Second Landing / Typography / Body / XS / Regular / OLD',
      remove() {
        this.removed = true;
      },
    }
  );

  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  const sharedFill = [{
    type: 'SOLID',
    color: { r: 0.1, g: 0.36, b: 0.3 },
    opacity: 1,
  }];

  await context.buildFromSnapshot({
    meta: {
      title: 'Second/Landing',
    },
    figmaTree: [
      textSpec('p.first', {
        characters: 'Shared copy one',
        fontSize: 18,
        fills: sharedFill,
      }),
      textSpec('p.second', {
        characters: 'Shared copy two',
        fontSize: 18,
        fills: sharedFill,
      }),
    ],
  });

  const activePaintNames = paintStyles.filter((style) => !style.removed).map((style) => style.name);
  const activeTextNames = textStyles.filter((style) => !style.removed).map((style) => style.name);

  expect(paintStyles.find((style) => style.id === 'previous-paint').removed).toBeUndefined();
  expect(textStyles.find((style) => style.id === 'previous-text').removed).toBeUndefined();
  expect(paintStyles.find((style) => style.id === 'stale-current-paint').removed).toBe(true);
  expect(textStyles.find((style) => style.id === 'stale-current-text').removed).toBe(true);

  expect(activePaintNames.some((name) => name.startsWith('Second Landing / Color / '))).toBe(true);
  expect(activeTextNames.some((name) => name.startsWith('Second Landing / Typography / Body / LG / Regular'))).toBe(true);
  expect(activePaintNames.some((name) => name.startsWith('Morphus / '))).toBe(false);
  expect(activeTextNames.some((name) => name.startsWith('Morphus / '))).toBe(false);
});

test('falls back to the html title tag when snapshot metadata is missing', async () => {
  const { figma } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  const snapshot = context.withClientSnapshotMeta(
    { figmaTree: [], meta: {} },
    {
      html: '<!doctype html><html><head><title>Studio &amp; Co</title></head><body></body></html>',
    }
  );

  expect(snapshot.meta.title).toBe('Studio & Co');
});

test('converts and builds multiple viewport presets from one plugin action', async () => {
  const { figma, page, uiMessages, notifications } = createFigmaMock();
  const requests = [];
  const jobResults = {};
  const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const fetchMock = async (url, options = {}) => {
    const cleanUrl = String(url);
    if (cleanUrl.endsWith('/health')) {
      return response({ ok: true });
    }

    if (cleanUrl.endsWith('/jobs') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      requests.push(body);
      const jobId = `job-${requests.length}`;
      jobResults[jobId] = {
        meta: { title: 'Responsive Build' },
        figmaTree: [
          frameSpec('body', {
            width: body.viewport.width,
            height: body.viewport.height,
          }),
        ],
      };
      return response({ jobId }, 202);
    }

    const match = cleanUrl.match(/\/jobs\/([^/]+)$/);
    if (match) {
      return response({
        state: 'done',
        progress: 100,
        message: 'Done',
        result: jobResults[match[1]],
      });
    }

    throw new Error(`Unexpected fetch: ${cleanUrl}`);
  };

  const context = {
    figma,
    __html__: '',
    console,
    fetch: fetchMock,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.convertAndBuild({
    html: '<!doctype html><html><head><title>Responsive Build</title></head><body></body></html>',
    sourceName: 'inline.html',
    viewports: [
      { name: 'desktop', label: 'Desktop', width: 1440, height: 900 },
      { name: 'mobile', label: 'Mobile', width: 375, height: 812 },
    ],
  });

  expect(requests).toHaveLength(2);
  expect(requests.map((request) => request.viewport)).toEqual([
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]);
  expect(page.children).toHaveLength(2);
  expect(page.children[0].name).toBe('Desktop - body');
  expect(page.children[1].name).toBe('Mobile - body');
  expect(page.children[1].x).toBe(1480);

  const done = uiMessages.filter((message) => message.type === 'DONE').pop();
  expect(done.nodeCount).toBe(2);
  expect(done.variants).toBe(2);
  expect(notifications.pop()).toBe('Morphus: 2 viewports, 2 nodes built');
});

test('imports inline SVG markup as a rendered Figma node', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      {
        name: 'svg.collar-illustration',
        type: 'SVG',
        x: 12,
        y: 18,
        width: 366,
        height: 403,
        opacity: 0.15,
        _svgMarkup: '<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg"><path d="M40 80 L80 40" stroke="#2B2220" fill="none"/></svg>',
      },
    ],
  });

  const svg = page.children[0];
  expect(svg.name).toBe('svg.collar-illustration');
  expect(svg.svgMarkup).toContain('<path');
  expect(svg.x).toBe(12);
  expect(svg.y).toBe(18);
  expect(svg.width).toBe(366);
  expect(svg.height).toBe(403);
  expect(svg.opacity).toBe(0.15);
});

test('imports base64 image data as a Figma image fill', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
    Uint8Array,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      {
        name: 'img.logo',
        type: 'IMAGE',
        x: 10,
        y: 12,
        width: 48,
        height: 32,
        _objectFit: 'cover',
        _image: {
          src: 'data:image/png;base64,aGVsbG8=',
          alt: 'Logo',
        },
      },
    ],
  });

  const image = page.children[0];
  expect(image.name).toBe('img.logo');
  expect(image.x).toBe(10);
  expect(image.y).toBe(12);
  expect(image.width).toBe(48);
  expect(image.height).toBe(32);
  expect(image.fills).toEqual([{
    type: 'IMAGE',
    imageHash: 'image-5',
    scaleMode: 'FILL',
  }]);
});

test('maps css object-fit fill to a valid Figma image scale mode', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
    Uint8Array,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      {
        name: 'canvas.chart',
        type: 'IMAGE',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        _objectFit: 'fill',
        _image: {
          src: 'data:image/png;base64,aGVsbG8=',
          alt: '',
        },
      },
    ],
  });

  expect(page.children[0].fills[0].scaleMode).toBe('FILL');
});

test('applies side-specific border weights for underline-like borders', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      {
        name: 'a.editorial-link',
        type: 'FRAME',
        x: 0,
        y: 0,
        width: 120,
        height: 18,
        fills: [],
        strokes: [{
          type: 'SOLID',
          color: { r: 1, g: 1, b: 1 },
          opacity: 0.4,
        }],
        strokeWeight: 1,
        strokeAlign: 'INSIDE',
        strokeTopWeight: 0,
        strokeRightWeight: 0,
        strokeBottomWeight: 1,
        strokeLeftWeight: 0,
      },
    ],
  });

  const link = page.children[0];
  expect(link.strokeBottomWeight).toBe(1);
  expect(link.strokeTopWeight).toBe(0);
  expect(link.strokeRightWeight).toBe(0);
  expect(link.strokeLeftWeight).toBe(0);
});

test('applies dotted underline decoration to mixed text ranges', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      textSpec('p.lede', {
        width: 260,
        height: 64,
        characters: 'Learn HTML and CSS',
        fontName: { family: 'Georgia', style: 'Italic' },
        fontSize: 20,
        lineHeight: { unit: 'PIXELS', value: 32 },
        textRuns: [
          {
            text: 'HTML',
            fontName: { family: 'Georgia', style: 'Italic' },
            fontSize: 20,
            lineHeight: { unit: 'PIXELS', value: 32 },
            fills: [{ type: 'SOLID', color: { r: 100 / 255, g: 216 / 255, b: 1 }, opacity: 1 }],
            textDecoration: 'UNDERLINE',
            textDecorationStyle: 'DOTTED',
            textDecorationColor: {
              value: {
                type: 'SOLID',
                color: { r: 100 / 255, g: 216 / 255, b: 1 },
                opacity: 1,
              },
            },
          },
        ],
      }),
    ],
  });

  const text = page.children[0];
  expect(text.rangeTextDecorations).toEqual([{ start: 6, end: 10, value: 'UNDERLINE' }]);
  expect(text.rangeTextDecorationStyles).toEqual([{ start: 6, end: 10, value: 'DOTTED' }]);
  expect(text.rangeTextDecorationColors).toEqual([{
    start: 6,
    end: 10,
    value: {
      value: {
        type: 'SOLID',
        color: { r: 100 / 255, g: 216 / 255, b: 1 },
        opacity: 1,
      },
    },
  }]);
});

test('extends page-layout height when fixed header content is offset down', async () => {
  const { figma, page } = createFigmaMock();
  const context = {
    figma,
    __html__: '',
    console,
    fetch,
    setTimeout,
    Promise,
    TextEncoder,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync('./figma-plugin/code.js', 'utf8'), context);

  await context.buildFromSnapshot({
    figmaTree: [
      frameSpec('body', {
        width: 1440,
        height: 450,
        _pageLayout: true,
        clipsContent: true,
        children: [
          frameSpec('nav', {
            _role: 'header',
            x: 0,
            y: 0,
            width: 1440,
            height: 90,
            layoutMode: 'HORIZONTAL',
            primaryAxisAlignItems: 'SPACE_BETWEEN',
            counterAxisAlignItems: 'CENTER',
          }),
          frameSpec('section.hero', {
            x: 0,
            y: 0,
            width: 1440,
            height: 360,
          }),
          frameSpec('div.footer-bottom', {
            x: 0,
            y: 360,
            width: 1440,
            height: 90,
            layoutMode: 'HORIZONTAL',
            primaryAxisAlignItems: 'SPACE_BETWEEN',
            counterAxisAlignItems: 'CENTER',
          }),
        ],
      }),
    ],
  });

  const body = page.children[0];
  const footerBottom = body.children[2];

  expect(body.height).toBe(540);
  expect(body.clipsContent).toBe(true);
  expect(body.children[1].y).toBe(90);
  expect(footerBottom.y).toBe(450);
});
