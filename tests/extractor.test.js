import { extractFromFile, extractFromHtml } from '../src/core/extractor.js';

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
  return null;
}

test('captures document title from the rendered HTML', async () => {
  const { title, domTree } = await extractFromHtml(`
    <!doctype html>
    <html>
      <head><title>Acme Dashboard</title></head>
      <body><main>Ready</main></body>
    </html>
  `, {
    width: 320,
    height: 120,
  });

  expect(title).toBe('Acme Dashboard');
  expect(domTree).toBeTruthy();
}, 30000);

test('does not reveal hidden animated progress overlays', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      .loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100px;
        height: 100px;
        opacity: 0;
        transition: opacity 200ms ease;
        background: #0d1020;
        color: #fff;
      }
      .content { width: 320px; height: 120px; background: #f4f4f4; }
    </style>
    <div class="loading-overlay" role="status" aria-live="polite">
      <p>Memuat...</p>
      <p>0%</p>
      <progress value="0" max="100"></progress>
    </div>
    <main class="content">Ready</main>
  `, {
    width: 360,
    height: 160,
  });

  const loader = find(domTree, (node) => node.classList?.includes('loading-overlay'));
  const content = find(domTree, (node) => node.classList?.includes('content'));

  expect(loader).toBeNull();
  expect(content).toBeTruthy();
}, 30000);

test('preserves visible transform-based layout while stabilizing animations', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      .stage { position: relative; width: 600px; height: 100px; }
      .centered {
        position: absolute;
        left: 50%;
        top: 0;
        width: 200px;
        height: 40px;
        transform: translateX(-50%);
        transition: transform 200ms ease;
        background: #111;
      }
    </style>
    <div class="stage">
      <div class="centered"></div>
    </div>
  `, {
    width: 600,
    height: 120,
  });

  const centered = find(domTree, (node) => node.classList?.includes('centered'));

  expect(centered).toBeTruthy();
  expect(Math.round(centered.rect.x)).toBe(200);
}, 30000);

test('still reveals safe entry-animation content', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .headline {
        width: 320px;
        height: 48px;
        opacity: 0;
        transform: translateY(24px);
        animation: fadeUp 10s 60s forwards;
      }
    </style>
    <h1 class="headline">Dashboard</h1>
  `, {
    width: 360,
    height: 120,
  });

  const headline = find(domTree, (node) => node.classList?.includes('headline'));

  expect(headline).toBeTruthy();
  expect(headline.computed.opacity).toBe('1');
  expect(headline.computed.transform).toBe('none');
}, 30000);

test('preserves structured interactive children instead of collapsing them into text', async () => {
  const { domTree } = await extractFromFile('./tests/vela/input.html', {
    width: 1440,
    height: 900,
  });

  const navCta = find(domTree, (node) => node.classList?.includes('nav-cta'));
  const btnGhost = find(domTree, (node) => node.classList?.includes('btn-ghost'));

  expect(navCta).toBeTruthy();
  expect(navCta.tag).toBe('a');
  expect(navCta.isTextContainer).toBe(false);
  expect(navCta.computed.borderStyle).toBe('solid');

  expect(btnGhost).toBeTruthy();
  expect(btnGhost.tag).toBe('a');
  expect(btnGhost.isTextContainer).toBe(false);
  expect(btnGhost.computed.display).toBe('flex');
}, 30000);

test('collapses semantic inline phrasing content into one text container', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; font-family: Georgia, serif; }
      p { width: 420px; font-size: 20px; line-height: 32px; color: rgb(153, 153, 153); }
      abbr { color: rgb(100, 216, 255); text-decoration: underline dotted; }
      time { color: rgb(200, 255, 0); }
    </style>
    <p class="lede">
      Satu halaman. Semua elemen <abbr>HTML</abbr> dan properti <abbr>CSS</abbr>
      ditampilkan pada <time datetime="2026-05-18">hari ini</time>.
    </p>
  `, {
    width: 520,
    height: 180,
  });

  const lede = find(domTree, (node) => node.classList?.includes('lede'));

  expect(lede).toBeTruthy();
  expect(lede.isTextContainer).toBe(true);
  expect(lede.children).toHaveLength(0);
  expect(lede.text).toContain('HTML');
  expect(lede.text).toContain('CSS');
  expect(lede.text).toContain('hari ini');
  expect(lede.textRuns.map((run) => run.text.trim()).filter(Boolean)).toEqual([
    'Satu halaman. Semua elemen',
    'HTML',
    'dan properti',
    'CSS',
    'ditampilkan pada',
    'hari ini',
    '.',
  ]);
  const htmlRun = lede.textRuns.find((run) => run.text.trim() === 'HTML');
  expect(htmlRun.computed.textDecorationLine).toContain('underline');
  expect(htmlRun.computed.textDecorationStyle).toBe('dotted');
  expect(htmlRun.computed.textDecorationColor).toBe('rgb(100, 216, 255)');
}, 30000);

test('clips paginated table rows after the pager so the table height stays bounded', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; font-family: Arial, sans-serif; }
      .table-wrap { width: 640px; }
      table { width: 100%; border-collapse: collapse; }
      td { padding: 12px 16px; border-bottom: 1px solid #333; }
      .pagination { padding: 12px 16px; color: #999; }
    </style>
    <div class="table-wrap">
      <table class="report-table">
        <tbody>
          <tr><td>Row 1</td></tr>
          <tr><td>Row 2</td></tr>
          <tr><td>Row 3</td></tr>
          <tr><td>Row 4</td></tr>
          <tr><td>Row 5</td></tr>
        </tbody>
      </table>
      <div class="pagination">Hal 1/314 - Baris 1-50</div>
      <table class="report-table">
        <tbody>
          <tr class="late-row"><td>Row 6</td></tr>
          <tr class="late-row"><td>Row 7</td></tr>
          <tr class="late-row"><td>Row 8</td></tr>
        </tbody>
      </table>
    </div>
  `, {
    width: 720,
    height: 360,
  });

  const wrap = find(domTree, (node) => node.classList?.includes('table-wrap'));
  const lateRow = find(domTree, (node) => node.classList?.includes('late-row'));

  expect(wrap).toBeTruthy();
  expect(wrap.rect.height).toBeLessThan(340);
  expect(lateRow).toBeNull();
}, 30000);

test('captures form control placeholders and placeholder styles', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      .newsletter-input {
        color: rgb(20, 18, 16);
        font-family: Arial, sans-serif;
        font-size: 16px;
        padding: 12px 20px;
      }

      .newsletter-input::placeholder {
        color: rgba(20, 18, 16, 0.42);
      }
    </style>
    <input class="newsletter-input" type="email" placeholder="email@perusahaan.com" />
  `, {
    width: 360,
    height: 120,
  });

  const input = find(domTree, (node) => node.classList?.includes('newsletter-input'));

  expect(input).toBeTruthy();
  expect(input.formControl).toEqual(expect.objectContaining({
    type: 'email',
    value: '',
    placeholder: 'email@perusahaan.com',
  }));
  expect(input.formControl.placeholderComputed.color).toBe('rgba(20, 18, 16, 0.42)');
  expect(input.formControl.placeholderComputed.fontSize).toBe('16px');
}, 30000);

test('captures native select controls as the selected label only', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      select {
        width: 220px;
        height: 48px;
        padding: 8px 32px 8px 16px;
        color: rgb(220, 227, 240);
      }
    </style>
    <select class="filter">
      <option>Semua Cara</option>
      <option selected>Penyedia</option>
      <option>Swakelola</option>
    </select>
  `, {
    width: 320,
    height: 120,
  });

  const select = find(domTree, (node) => node.classList?.includes('filter'));

  expect(select).toBeTruthy();
  expect(select.text).toBeNull();
  expect(select.children).toHaveLength(0);
  expect(select.formControl).toEqual(expect.objectContaining({
    type: 'select',
    value: 'Penyedia',
    hasChevron: true,
  }));
}, 30000);

test('skips pseudo-elements collapsed in the default state', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      .nav-link {
        color: #111;
        display: inline-block;
        margin: 24px;
        overflow: visible;
        position: relative;
      }

      .nav-link::after {
        background: currentColor;
        bottom: -2px;
        content: '';
        height: 1px;
        left: 0;
        position: absolute;
        transform-origin: left center;
        width: 100%;
      }

      .nav-link.is-zero-width::after {
        width: 0;
      }

      .nav-link.is-zero-width:hover::after {
        width: 100%;
      }

      .nav-link.is-scaled::after {
        transform: scaleX(0);
      }

      .nav-link.is-scaled:hover::after {
        transform: scaleX(1);
      }

      .nav-link.is-clipped::after {
        clip-path: inset(0 100% 0 0);
      }

      .nav-link.is-clipped:hover::after {
        clip-path: inset(0);
      }

      .nav-link.is-translated {
        overflow: hidden;
      }

      .nav-link.is-translated::after {
        transform: translateX(-100%);
      }

      .nav-link.is-translated:hover::after {
        transform: translateX(0);
      }
    </style>
    <a class="nav-link is-zero-width" href="#">Shop</a>
    <a class="nav-link is-scaled" href="#">Story</a>
    <a class="nav-link is-clipped" href="#">Lookbook</a>
    <a class="nav-link is-translated" href="#">Journal</a>
    <a class="nav-link is-visible" href="#">Story</a>
  `, {
    width: 720,
    height: 160,
  });

  const hiddenClasses = ['is-zero-width', 'is-scaled', 'is-clipped', 'is-translated'];
  const visibleLink = find(domTree, (node) => node.classList?.includes('is-visible'));

  for (const className of hiddenClasses) {
    const hiddenLink = find(domTree, (node) => node.classList?.includes(className));
    expect(hiddenLink).toBeTruthy();
    expect(hiddenLink.pseudo.after).toBeNull();
  }

  expect(visibleLink).toBeTruthy();
  expect(visibleLink.pseudo.after).toBeTruthy();
  expect(visibleLink.pseudo.after.rect.width).toBeGreaterThan(0);
}, 30000);

test('expands pseudo text bounds for glyph overhangs', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      blockquote {
        position: relative;
        width: 420px;
        min-height: 120px;
        margin: 32px;
        font-family: Georgia, serif;
      }
      blockquote::before {
        content: '“';
        position: absolute;
        left: 12px;
        top: -16px;
        font-family: Georgia, serif;
        font-style: italic;
        font-size: 80px;
        line-height: 80px;
        color: rgb(200, 255, 0);
      }
    </style>
    <blockquote>Quote content</blockquote>
  `, {
    width: 520,
    height: 220,
  });

  const quote = find(domTree, (node) => node.tag === 'blockquote');
  const before = quote?.pseudo?.before;

  expect(before).toBeTruthy();
  expect(before.content).toBe('“');
  expect(before.rect.width).toBeGreaterThan(parseFloat(before.computed.width));
}, 30000);

test('captures inline svg markup for native import', async () => {
  const { domTree } = await extractFromHtml(`
    <svg class="collar-illustration" viewBox="0 0 200 220" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M40 80 L80 40 L100 55 L120 40 L160 80" stroke="#2B2220" stroke-width="1.5" fill="none"/>
      <circle cx="100" cy="80" r="3" fill="#2B2220" opacity="0.5"/>
    </svg>
  `, {
    width: 240,
    height: 240,
  });

  const svg = find(domTree, (node) => node.tag === 'svg');
  expect(svg).toBeTruthy();
  expect(svg.children).toHaveLength(0);
  expect(svg.svgMarkup).toContain('<path');
  expect(svg.svgMarkup).toContain('stroke="rgb(43, 34, 32)"');
  expect(svg.svgMarkup).toContain('<circle');
}, 30000);

test('captures base64 image sources from img elements', async () => {
  const { domTree } = await extractFromHtml(`
    <img class="logo" alt="Logo" src="data:image/png;base64,aGVsbG8=" style="width: 48px; height: 32px; object-fit: cover;" />
  `, {
    width: 120,
    height: 80,
  });

  const image = find(domTree, (node) => node.tag === 'img');
  expect(image).toBeTruthy();
  expect(image.children).toHaveLength(0);
  expect(image.imageData).toEqual(expect.objectContaining({
    src: 'data:image/png;base64,aGVsbG8=',
    alt: 'Logo',
  }));
  expect(image.computed.objectFit).toBe('cover');
}, 30000);

test('captures rendered canvas content as image data', async () => {
  const { domTree } = await extractFromHtml(`
    <canvas class="chart" width="120" height="80" style="width: 120px; height: 80px;"></canvas>
    <script>
      const canvas = document.querySelector('.chart');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#07111f';
      ctx.fillRect(0, 0, 120, 80);
      ctx.strokeStyle = '#00b7ff';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(12, 60);
      ctx.lineTo(42, 30);
      ctx.lineTo(72, 42);
      ctx.lineTo(108, 14);
      ctx.stroke();
    </script>
  `, {
    width: 180,
    height: 120,
  });

  const canvas = find(domTree, (node) => node.tag === 'canvas');

  expect(canvas).toBeTruthy();
  expect(canvas.children).toHaveLength(0);
  expect(canvas.imageData).toEqual(expect.objectContaining({
    src: expect.stringMatching(/^data:image\/png;base64,/),
    naturalWidth: 120,
    naturalHeight: 80,
  }));
}, 30000);

test('captures one-sided borders as visual boxes', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      .editorial-link {
        border-bottom: 1px solid rgba(245, 242, 237, 0.4);
        color: rgb(245, 242, 237);
        display: inline-block;
        text-decoration: none;
      }
    </style>
    <a class="editorial-link" href="#">Read Our Story</a>
  `, {
    width: 320,
    height: 120,
  });

  const link = find(domTree, (node) => node.classList?.includes('editorial-link'));
  expect(link).toBeTruthy();
  expect(link.isTextContainer).toBe(false);
  expect(link.computed.borderBottomWidth).toBe('1px');
  expect(link.computed.borderBottomStyle).toBe('solid');
  expect(link.computed.borderBottomColor).toBe('rgba(245, 242, 237, 0.4)');
}, 30000);
