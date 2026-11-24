import { execFileSync } from 'node:child_process';
import { createReadStream, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { expect, test } from '@playwright/test';

// The product panels use the SDK's 'IL Montserrat'. The player declares it from fonts/ next to its own bundle, so the font
// is requested only when a product card is on screen. Production shape, with real servers: the embed page is on one origin
// (https://localhost:port) and the bundle, the font and the video on another (https://127.0.0.1:port, the CDN, under a
// version folder), and the page's Content-Security-Policy is the Console's. The servers use a throwaway self-signed
// certificate (made with openssl), which the browser is told to accept.
const folder = '/native-il-player/abc123def456/';
const dist = resolve('dist');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const servers = [];
let tls;

test.use({ ignoreHTTPSErrors: true });
test.beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'il-player-font-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
    '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
  tls = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
});
test.afterEach(() => { for (const server of servers.splice(0)) server.close(); });

const card = {
  id: 'dlv_1', format: 'super', start: 1000, end: 20000, holdUntil: 600000, window: 'm1',
  imageUrl: 'https://ads-images.test/apron.png', mimeType: 'image/png',
  impressionUrl: 'https://ads.iadserver.com/events/dlv_1/impression',
  commerce: {
    id: 'gid://shopify/Product/100', title: 'Apron', price: '100.00', currency: 'USD', locale: 'en',
    variants: [{ id: 'gid://shopify/ProductVariant/101', label: 'Black / M', price: '100.00', availableForSale: true }],
    handoffUrl: 'https://ads.iadserver.com/commerce/offer/dlv_1',
    viewUrl: 'https://ads.iadserver.com/events/dlv_1/creativeView',
  },
};

const plan = (route) => ({
  version: 1, asset_id: 'asset-1', duration: 18, page_url: 'https://publisher.example/page', cuts: [],
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  commerce: {
    kind: 'scene_product', url: route, session: '9f1c0000000000000000000000000abc', lead_ms: 5000,
    pacing: { min_seconds: 1.5, max_seconds: null, gap_after_seconds: 0, max_per_video: null, cut_clearance_seconds: 0 },
    windows: [{ id: 'm1', start_ms: 1000, end_ms: 20000 }],
  },
});

const listen = (handler) => new Promise((done) => { const server = createServer(tls, handler).listen(0, () => { servers.push(server); done(server); }); });

// fontCors: what the CDN sends as Access-Control-Allow-Origin on the font: true is `*` (the real CDN), false is nothing,
// 'origin' is the page's own origin (the bundle always gets `*`). fontSrc: whether the page's policy allows the CDN for fonts.
// The policy is the Console's `_player_page` (branch codex/console-il-montserrat), including the `sandbox` the preview page
// sends: no allow-same-origin, so the page has an opaque origin and its requests carry `Origin: null`.
async function setup(context, page, { product = true, fontCors = true, fontSrc = true } = {}) {
  const seen = { fonts: [], errors: [] };
  const cdn = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = resolve(dist, '.' + url.pathname.slice(folder.length - 1));
    if (!url.pathname.startsWith(folder) || !path.startsWith(dist + sep)) return res.writeHead(404).end();
    try {
      const { size } = statSync(path);
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(range ? 206 : 200, { 'Content-Type': types[extname(path)], 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
        ...(!url.pathname.includes('/fonts/') || fontCors === true ? { 'Access-Control-Allow-Origin': '*' }
          : fontCors === 'origin' ? { 'Access-Control-Allow-Origin': pageOrigin, Vary: 'Origin' } : {}) });
      createReadStream(path, { start, end }).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  const base = `https://127.0.0.1:${cdn.address().port}${folder}`;
  let pageOrigin;
  const embed = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    // Under the sandbox the page's origin is opaque, so even its own feed is a cross-origin request.
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    if (url.pathname === '/il-player/scene-product')
      return res.writeHead(200, { 'Content-Type': 'application/json', ...cors }).end(product ? JSON.stringify(card) : '');
    const policy = ["default-src 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'", "frame-ancestors 'self'",
      `script-src ${base} 'nonce-n' https://imasdk.googleapis.com`, `style-src ${base} 'nonce-n'`,
      `media-src 'self' ${base} https: blob:`, `img-src 'self' ${base} data: https:`, `connect-src 'self' ${base} https:`,
      'frame-src https:', "style-src-attr 'unsafe-inline'", ...(fontSrc ? [`font-src ${base}`] : []),
      'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox'].join('; ');
    const config = { src: base + 'demo/program.mp4', locale: 'en', embed: { playback: { muted: true } },
      ads: { plan: plan(pageOrigin + '/il-player/scene-product?project=p1&asset=asset-1') } };
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': policy }).end(
      `<!doctype html><meta charset=utf-8><link rel=stylesheet href="${base}native-il-player.css">` +
      `<div id=il-player style="width:800px;height:450px"></div><script nonce=n type=application/json id=il-player-config>${JSON.stringify(config)}</script>` +
      `<script type=module src="${base}native-il-player.js"></script>`);
  });
  pageOrigin = `https://localhost:${embed.address().port}`;
  seen.pageOrigin = pageOrigin;
  seen.base = base;
  page.on('request', (request) => { if (request.url().includes('/fonts/')) seen.fonts.push(request); });
  page.on('pageerror', (error) => seen.errors.push(error.message));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__csp.push(event.violatedDirective + ' ' + event.blockedURI));
  });
  await context.route('https://ads-images.test/**', (request) => request.fulfill({ contentType: 'image/png', body: png }));
  await context.route('https://ads.iadserver.com/**', (request) => request.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' } }));
  await context.route('https://imasdk.googleapis.com/**', (request) => request.abort());
  return seen;
}

const faces = (page) => page.evaluate(() => [...document.fonts].map((face) => ({ family: face.family.replace(/"/g, ''), weight: face.weight, status: face.status })));
// Chromium marks a face whose request failed 'error'; WebKit leaves it 'unloaded'. Neither is 'loaded'.
async function notLoaded(page, browserName) {
  await page.waitForTimeout(800);
  const [face] = await faces(page);
  expect(face.family).toBe('IL Montserrat');
  if (browserName === 'chromium') expect(face.status).toBe('error');
  else expect(face.status).not.toBe('loaded');
}
const play = (page) => page.getByRole('button', { name: 'Play', exact: true }).first().click();
const time = (page) => page.evaluate(() => document.querySelector('video').currentTime);

async function paintedWith(page, selectors) {
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument');
  const painted = {};
  for (const selector of selectors) {
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await client.send('CSS.getPlatformFontsForNode', { nodeId });
    painted[selector] = fonts.map((font) => [font.familyName.startsWith('Montserrat'), font.isCustomFont]);
  }
  return painted;
}

test('with no product on screen the font is declared but never requested', async ({ page, context }) => {
  const seen = await setup(context, page, { product: false });
  await page.goto(seen.pageOrigin + '/page');
  await play(page);
  await expect.poll(() => time(page)).toBeGreaterThan(1.5);
  await expect(page.getByRole('button', { name: 'View product' })).toHaveCount(0);
  expect(await faces(page)).toEqual([{ family: 'IL Montserrat', weight: '100 900', status: 'unloaded' }]);
  expect(seen.fonts).toHaveLength(0);
});

test('a product card requests the font once, from the bundle folder on the CDN, and is drawn with it', async ({ page, context, browserName }) => {
  const seen = await setup(context, page);
  await page.goto(seen.pageOrigin + '/page');
  await play(page);
  const view = page.getByRole('button', { name: 'View product' });
  await expect(view).toBeVisible();
  // The sandbox gives the page an opaque origin, so the font is fetched with `Origin: null`: only `*` admits it.
  expect(await page.evaluate(() => window.origin)).toBe('null');
  await expect.poll(() => seen.fonts.length).toBe(1);
  // Chromium sends `Origin: null` with the font request; the WebKit build Playwright runs sends no Origin at all.
  if (browserName === 'chromium') expect(await seen.fonts[0].headerValue('origin')).toBe('null');
  const response = await seen.fonts[0].response();
  expect(seen.fonts[0].url()).toBe(seen.base + 'fonts/Montserrat-wght.woff2');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('font/woff2');
  await page.evaluate(() => document.fonts.ready);
  expect(await faces(page)).toEqual([{ family: 'IL Montserrat', weight: '100 900', status: 'loaded' }]);
  await view.click();
  await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(seen.fonts).toHaveLength(1);
  expect(await page.evaluate(() => window.__csp)).toEqual([]);
  expect(seen.errors).toEqual([]);
  // The panel's text is drawn with the loaded face. Chromium says which font painted a node; elsewhere the loaded face
  // and the width of the text (the same as the family alone) stand in.
  if (browserName === 'chromium') {
    const painted = await paintedWith(page, ['.il-commerce-title', '.il-commerce-buy', '.il-commerce-price']);
    expect(painted).toEqual({ '.il-commerce-title': [[true, true]], '.il-commerce-buy': [[true, true]], '.il-commerce-price': [[true, true]] });
  }
  const difference = await page.evaluate(() => {
    const title = document.querySelector('.il-commerce-title');
    const style = getComputedStyle(title);
    const probe = document.createElement('span');
    probe.style.cssText = `font: ${style.fontWeight} ${style.fontSize} "IL Montserrat"; white-space: nowrap; position: absolute`;
    probe.textContent = title.textContent;
    document.body.append(probe);
    const range = document.createRange();
    range.selectNodeContents(title);
    const result = Math.abs(probe.getBoundingClientRect().width - range.getBoundingClientRect().width);
    probe.remove();
    return result;
  });
  expect(difference).toBeLessThan(0.5);
});

test('when the CDN sends no CORS header for the font, the panel keeps the fallback font and the player works', async ({ page, context, browserName }) => {
  const seen = await setup(context, page, { fontCors: false });
  await page.goto(seen.pageOrigin + '/page');
  await play(page);
  const view = page.getByRole('button', { name: 'View product' });
  await expect(view).toBeVisible();
  await expect.poll(() => seen.fonts.length).toBe(1);
  // Chromium refuses a cross-origin font without the header. The WebKit build Playwright runs loads it anyway, so there
  // the check is only that the player and the panel work.
  if (browserName === 'chromium') await notLoaded(page, browserName);
  await view.click();
  await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();
  const before = await time(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Buy' })).toBeHidden();
  await page.evaluate(() => document.querySelector('video').play());
  await expect.poll(() => time(page)).toBeGreaterThan(before);
  expect(seen.errors).toEqual([]);
  if (browserName === 'chromium') {
    const painted = await paintedWith(page, ['.il-commerce-title']);
    expect(painted['.il-commerce-title'].every(([, custom]) => !custom)).toBe(true);
  }
});

test('a CORS header naming the page origin is not enough under the sandbox: the origin is null, so only * admits the font', async ({ page, context, browserName }) => {
  const seen = await setup(context, page, { fontCors: 'origin' });
  await page.goto(seen.pageOrigin + '/page');
  await play(page);
  await expect(page.getByRole('button', { name: 'View product' })).toBeVisible();
  await expect.poll(() => seen.fonts.length).toBe(1);
  // Chromium refuses the font; the WebKit build Playwright runs does not check CORS for it and loads it.
  if (browserName === 'chromium') await notLoaded(page, browserName);
  else expect((await faces(page))[0].status).not.toBe('error');
  await expect.poll(() => time(page)).toBeGreaterThan(1);
  expect(seen.errors).toEqual([]);
});

test('a page policy without font-src (default-src none) blocks the font: fallback font, player unaffected', async ({ page, context, browserName }) => {
  const seen = await setup(context, page, { fontSrc: false });
  await page.goto(seen.pageOrigin + '/page');
  await play(page);
  await expect(page.getByRole('button', { name: 'View product' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__csp)).toEqual([expect.stringMatching(/^font-src .*\/fonts\/Montserrat-wght\.woff2$/)]);
  await notLoaded(page, browserName);
  await expect.poll(() => time(page)).toBeGreaterThan(1);
  expect(seen.errors).toEqual([]);
});
