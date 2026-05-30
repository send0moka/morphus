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

test('waits for delayed client layout before extracting slider-like content', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      .viewport { width: 320px; height: 120px; overflow: hidden; }
      .slide { width: 320px; height: 120px; }
      .active { background: #111111; }
      .next { background: #333333; }
    </style>
    <div class="viewport">
      <div class="track">
        <section class="slide active">Current event</section>
        <section class="slide next">Next event</section>
        <section class="slide later">Later event</section>
      </div>
    </div>
    <script>
      setTimeout(() => {
        document.querySelectorAll('.slide:not(.active)').forEach((el) => el.remove());
        document.querySelector('.track').setAttribute('data-ready', 'true');
      }, 800);
    </script>
  `, {
    width: 360,
    height: 180,
  });

  const active = find(domTree, (node) => node.classList?.includes('active'));
  const next = find(domTree, (node) => node.classList?.includes('next'));
  const later = find(domTree, (node) => node.classList?.includes('later'));

  expect(active).toBeTruthy();
  expect(next).toBeNull();
  expect(later).toBeNull();
}, 30000);

test('skips aria-hidden inactive slider items without class-specific rules', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      .stage { width: 320px; height: 120px; overflow: hidden; }
      .track { display: flex; width: 960px; }
      .slide { flex: 0 0 320px; height: 120px; }
      .active { background: #111111; }
      .inactive { background: #333333; }
    </style>
    <div class="stage">
      <div class="track">
        <section class="slide inactive" aria-hidden="true" tabindex="-1" role="tabpanel">Hidden event</section>
        <section class="slide active" aria-hidden="false" tabindex="0" role="tabpanel">Active event</section>
        <img class="slide hidden-image" aria-hidden="true" tabindex="-1" alt="Hidden image" src="data:image/png;base64,aGVsbG8=" />
      </div>
    </div>
  `, {
    width: 360,
    height: 180,
  });

  const active = find(domTree, (node) => node.classList?.includes('active'));
  const inactive = find(domTree, (node) => node.classList?.includes('inactive'));
  const hiddenImage = find(domTree, (node) => node.classList?.includes('hidden-image'));

  expect(active).toBeTruthy();
  expect(inactive).toBeNull();
  expect(hiddenImage).toBeNull();
}, 30000);

test('collapses uninitialized single-view carousel stacks before extraction', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      .program-carousel { display: grid; grid-template-columns: 320px 240px; width: 560px; }
      .media-slider { overflow: hidden; }
      .media-slider img { display: block; width: 320px; height: 160px; }
      .content-slider { overflow: hidden; }
      .event-card { width: 240px; height: 160px; background: #3a0024; color: #ffffff; }
    </style>
    <div class="program-carousel">
      <div class="media-slider">
        <img class="event-image first-image" alt="First event image" src="data:image/png;base64,aGVsbG8=" />
        <img class="event-image second-image" alt="Second event image" src="data:image/png;base64,aGVsbG8=" />
        <img class="event-image third-image" alt="Third event image" src="data:image/png;base64,aGVsbG8=" />
      </div>
      <div class="content-slider">
        <article class="event-card first-card">First event</article>
        <article class="event-card second-card">Second event</article>
        <article class="event-card third-card">Third event</article>
      </div>
      <button aria-label="Previous slide">Prev</button>
      <button aria-label="Next slide">Next</button>
    </div>
  `, {
    width: 620,
    height: 260,
  });

  const firstImage = find(domTree, (node) => node.classList?.includes('first-image'));
  const secondImage = find(domTree, (node) => node.classList?.includes('second-image'));
  const firstCard = find(domTree, (node) => node.classList?.includes('first-card'));
  const secondCard = find(domTree, (node) => node.classList?.includes('second-card'));

  expect(firstImage).toBeTruthy();
  expect(secondImage).toBeNull();
  expect(firstCard).toBeTruthy();
  expect(secondCard).toBeNull();
}, 30000);

test('does not reveal inactive disclosure dropdown panels', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; }
      .dropdown { position: relative; width: 160px; height: 40px; }
      .trigger { width: 80px; height: 32px; background: #ffffff; }
      .panel {
        position: absolute;
        top: 40px;
        left: 0;
        width: 120px;
        height: 64px;
        opacity: 0;
        transition: opacity 200ms ease;
        background: #ffffff;
      }
      .option { height: 32px; }
    </style>
    <div class="dropdown" data-active="false">
      <button class="trigger">IND</button>
      <div class="panel">
        <button class="option">IND</button>
        <button class="option">ENG</button>
      </div>
    </div>
  `, {
    width: 240,
    height: 160,
  });

  const trigger = find(domTree, (node) => node.classList?.includes('trigger'));
  const panel = find(domTree, (node) => node.classList?.includes('panel'));
  const option = find(domTree, (node) => node.classList?.includes('option'));

  expect(trigger).toBeTruthy();
  expect(panel).toBeNull();
  expect(option).toBeNull();
}, 30000);

test('preserves structured interactive children instead of collapsing them into text', async () => {
  const { domTree } = await extractFromFile('./tests/landing-page/input.html', {
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

test('preserves collapsed spaces between direct inline text nodes and styled spans', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; font-family: Arial, sans-serif; }
      p { font-size: 24px; line-height: 32px; }
      b { font-weight: 700; }
      a { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
      svg { width: 16px; height: 16px; }
    </style>
    <p class="announcement">Lebih dari <b>1000+ sekolah</b> dan <b>pendidik</b> telah bergabung. <a><span>Ikuti Program</span><svg viewBox="0 0 16 16"></svg></a></p>
  `, {
    width: 960,
    height: 160,
  });

  const announcement = find(domTree, (node) => node.classList?.includes('announcement'));
  const childTexts = announcement.children
    .filter((child) => child.isTextContainer)
    .map((child) => child.text);

  expect(announcement.isTextContainer).toBe(false);
  expect(childTexts).toEqual(expect.arrayContaining([
    'Lebih dari ',
    ' dan ',
    ' telah bergabung. ',
  ]));
}, 30000);

test('splits wrapped inline visual boxes into painted line fragments', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; font-family: Arial, sans-serif; }
      p { width: 190px; font-size: 20px; line-height: 30px; color: rgb(40, 40, 40); }
      mark {
        background: rgb(255, 225, 0);
        color: rgb(10, 10, 10);
        padding: 0 4px;
        border-radius: 2px;
      }
    </style>
    <p>Awal teks <mark>Ditandai dengan mark</mark> akhir</p>
  `, {
    width: 260,
    height: 180,
  });

  const mark = find(domTree, (node) => node.tag === 'mark' && node._inlineFragmentGroup);

  expect(mark).toBeTruthy();
  expect(mark.computed.backgroundColor).toBe('rgba(0, 0, 0, 0)');

  const fragments = mark.children.filter((child) => child._inlineFragment);
  expect(fragments.length).toBeGreaterThan(1);
  expect(fragments.every((fragment) => fragment.computed.backgroundColor === 'rgb(255, 225, 0)')).toBe(true);
  expect(Math.max(...fragments.map((fragment) => fragment.rect.width))).toBeLessThan(mark.rect.width);
  expect(fragments.map((fragment) => fragment.children[0]?.text).filter(Boolean).join(' ')).toBe('Ditandai dengan mark');
}, 30000);

test('splits wrapped inline text into separate line fragments', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; font-family: Arial, sans-serif; }
      p { width: 60px; font-size: 20px; line-height: 30px; }
      i { font-style: italic; }
      mark { background: yellow; }
    </style>
    <p><mark>x</mark> <i>italic (i)</i></p>
  `, {
    width: 180,
    height: 120,
  });

  const italic = find(domTree, (node) => node.tag === 'i' && node._inlineTextFragmentGroup);

  expect(italic).toBeTruthy();
  expect(italic.children.map((child) => child.text)).toEqual(['italic', '(i)']);
  expect(italic.children.every((child) => child.isTextContainer && child._inlineTextFragment)).toBe(true);
  expect(Math.max(...italic.children.map((child) => child.rect.width))).toBeLessThan(italic.rect.width);
}, 30000);

test('splits multiline direct text after inline visual boxes into line fragments', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; font-family: Arial, sans-serif; }
      p { width: 300px; font-size: 28px; line-height: 40px; color: rgb(80, 80, 100); }
      code {
        background: rgb(30, 30, 45);
        color: rgb(200, 255, 60);
        padding: 2px 8px;
        font-family: monospace;
      }
    </style>
    <p>Font sebagai <code>.woff2</code>, lalu ditanam di <code>@font-face</code>. File mandiri sepenuhnya untuk demo ekstra panjang.</p>
  `, {
    width: 420,
    height: 220,
  });

  const groups = [];
  find(domTree, (node) => {
    if (node._directTextFragmentGroup) {
      groups.push(node);
    }
    return false;
  });
  const group = groups.find((node) => node.children.map((child) => child.text).join(' ').includes('File mandiri'));

  expect(group).toBeTruthy();
  expect(group.children.length).toBeGreaterThan(1);
  expect(group.children.every((child) => child.isTextContainer && child._directTextFragment)).toBe(true);
  expect(group.children.map((child) => child.text).join(' ')).toContain('File mandiri');
  expect(group.children[0].rect.x).toBeGreaterThan(group.children[1].rect.x);
}, 30000);

test('includes generated inline pseudo text when collapsing phrasing content', async () => {
  const { domTree } = await extractFromHtml(`
    <style>
      body { margin: 0; font-family: Georgia, serif; }
      p { width: 360px; font-size: 20px; line-height: 32px; color: rgb(153, 153, 153); }
      q::before { content: "«"; color: rgb(200, 255, 0); }
      q::after { content: " »"; color: rgb(200, 255, 0); }
    </style>
    <p class="quote-line">Standar berkata <q>kutipan inline</q>.</p>
  `, {
    width: 420,
    height: 120,
  });

  const line = find(domTree, (node) => node.classList?.includes('quote-line'));

  expect(line).toBeTruthy();
  expect(line.isTextContainer).toBe(true);
  expect(line.children).toHaveLength(0);
  expect(line.text).toBe('Standar berkata «kutipan inline ».');

  const quoteRuns = line.textRuns.filter((run) => run.computed.color === 'rgb(200, 255, 0)');
  expect(quoteRuns.map((run) => run.text)).toEqual(['«', ' »']);
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

test('captures CSS background image urls as image data', async () => {
  const { domTree } = await extractFromHtml(`
    <div class="hero" style="width: 120px; height: 80px; background-image: linear-gradient(to bottom, rgba(0,0,0,.4), transparent), url('data:image/png;base64,aGVsbG8='); background-size: auto, cover;"></div>
  `, {
    width: 160,
    height: 120,
  });

  const hero = find(domTree, (node) => node.classList?.includes('hero'));

  expect(hero).toBeTruthy();
  expect(hero.backgroundImages).toEqual([
    expect.objectContaining({
      layerIndex: 1,
      src: 'data:image/png;base64,aGVsbG8=',
      contentType: 'image/png',
    }),
  ]);
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
