import { expect, test } from '@playwright/test';

// The player page is served from an https origin (routed to the local server), as the Console serves it,
// so the plan's commerce.url is on the page's own origin.
const origin = 'https://player.test';
const program = '/demo/program.mp4';
const route = origin + '/il-player/scene-product?project=p1&asset=asset-1&grant=g.1%2Bx';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

const card = {
  id: 'dlv_1', format: 'super', start: 1000, end: 8000, window: 'm1',
  imageUrl: 'https://ads-images.test/apron.png', mimeType: 'image/png',
  impressionUrl: 'https://ads.iadserver.com/events/dlv_1/impression',
  commerce: {
    id: 'gid://shopify/Product/100', title: 'Apron', price: '100.00', currency: 'USD', locale: 'en',
    variants: [{ id: 'gid://shopify/ProductVariant/101', label: 'Black / M', price: '100.00', availableForSale: true }],
    handoffUrl: 'https://ads.iadserver.com/commerce/offer/dlv_1',
    viewUrl: 'https://ads.iadserver.com/events/dlv_1/creativeView',
  },
};

function plan(extra) {
  return {
    version: 1, asset_id: 'asset-1', duration: 18, page_url: 'https://publisher.example/page', cuts: [],
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    commerce: {
      kind: 'scene_product', url: route, session: '9f1c0000000000000000000000000abc', lead_ms: 5000,
      pacing: { min_seconds: 1.5, max_seconds: null, gap_after_seconds: 0, max_per_video: null, cut_clearance_seconds: 0 },
      windows: [{ id: 'm1', start_ms: 1000, end_ms: 8000 }],
    },
    ...extra,
  };
}

const embedPath = (config) => '/embed?config=' + encodeURIComponent(JSON.stringify(config));

async function serve(context, { answer = () => ({ status: 200, body: card }), embedded = null } = {}) {
  const seen = { routes: [], impressions: 0, views: 0, handoffs: [] };
  await context.route(origin + '/**', async (request) => {
    const url = new URL(request.request().url());
    if (url.pathname === '/il-player/scene-product') {
      seen.routes.push(url.href);
      const reply = answer(url);
      return request.fulfill({ status: reply.status, contentType: 'application/json', body: reply.body ? JSON.stringify(reply.body) : '' });
    }
    const response = await request.fetch({ url: 'http://127.0.0.1:4194' + url.pathname + url.search });
    return request.fulfill({ response });
  });
  await context.route('https://ads-images.test/**', (request) => request.fulfill({ contentType: 'image/png', body: png }));
  await context.route('https://ads.iadserver.com/**', (request) => {
    const url = new URL(request.request().url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
    if (request.request().method() === 'OPTIONS') return request.fulfill({ status: 204, headers: cors });
    if (url.pathname.endsWith('/impression')) seen.impressions++;
    if (url.pathname.endsWith('/creativeView')) seen.views++;
    if (url.pathname === '/commerce/offer/dlv_1') {
      seen.handoffs.push(request.request().postData());
      return request.fulfill({ status: 201, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ continueUrl: 'https://shop.test/checkout', qrImageUrl: 'https://ads-images.test/qr.png' }) });
    }
    return request.fulfill({ status: 204, headers: cors });
  });
  await context.route('https://shop.test/**', (request) => request.fulfill({ contentType: 'text/html', body: '<title>Checkout</title>' }));
  await context.route('https://publisher.test/**', (request) => request.fulfill({ contentType: 'text/html',
    body: `<!doctype html><iframe id=player sandbox="allow-scripts allow-same-origin" style="width:800px;height:450px;border:0"
      src="${origin}${embedPath(embedded)}"></iframe>` }));
  return seen;
}

test('a plan with commerce shows the product card in the scene, fires the impression once and Buy opens the purchase', async ({ page, context }) => {
  const seen = await serve(context);
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const open = page.getByRole('button', { name: 'View product' });
  await expect(open).toBeVisible();
  expect(seen.routes).toEqual([route + '&window=m1&locale=en']);
  await expect.poll(() => seen.impressions).toBe(1);
  await open.click();
  await expect.poll(() => seen.views).toBe(1);
  await page.getByRole('button', { name: 'Buy' }).click();
  const link = page.getByRole('link', { name: 'Continue to Shopify' });
  await expect(link).toHaveAttribute('href', 'https://shop.test/checkout');
  expect(seen.handoffs.map((body) => JSON.parse(body))).toEqual([{ variantId: 'gid://shopify/ProductVariant/101' }]);
  // Not embedded: no QR, the link is the purchase.
  await expect(page.locator('.il-commerce-result img')).toHaveCount(0);
  const [checkout] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await expect(checkout).toHaveURL('https://shop.test/checkout');
  // Above the control bar: the play button stays clickable.
  const card = await page.locator('.il-commerce').boundingBox();
  const bar = await page.locator('.il-player__toolbar').boundingBox();
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
  expect(seen.impressions).toBe(1);
  expect(seen.routes.length).toBe(1);
});

test('Escape closes the open card without leaving fullscreen or the player', async ({ page, context }) => {
  await serve(context);
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'View product' }).click();
  await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Buy' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'View product' })).toBeFocused();
});

test('embedded in a sandbox without allow-popups, the purchase QR is shown next to the link', async ({ page, context }) => {
  const seen = await serve(context, { embedded: { src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } } });
  await page.goto('https://publisher.test/page');
  const frame = page.frameLocator('#player');
  await frame.getByRole('button', { name: 'Play', exact: true }).first().click();
  await frame.getByRole('button', { name: 'View product' }).click();
  await frame.getByRole('button', { name: 'Buy' }).click();
  await expect(frame.locator('.il-commerce-result img[src="https://ads-images.test/qr.png"]')).toBeVisible();
  await expect(frame.getByRole('link', { name: 'Continue to Shopify' })).toBeVisible();
  expect(seen.handoffs.length).toBe(1);
});

test('a plan without commerce never asks for a product and draws no card', async ({ page, context }) => {
  const seen = await serve(context);
  const noCommerce = plan();
  delete noCommerce.commerce;
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: noCommerce } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => page.locator('video').evaluate((video) => video.currentTime)).toBeGreaterThan(2.5);
  expect(seen.routes).toEqual([]);
  await expect(page.locator('.il-commerce')).toHaveCount(0);
});

test('a 204 shows nothing and asks the window only once', async ({ page, context }) => {
  const seen = await serve(context, { answer: () => ({ status: 204 }) });
  await page.goto(origin + embedPath({ src: program, locale: 'es', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
  await expect.poll(() => page.locator('video').evaluate((video) => video.currentTime)).toBeGreaterThan(3);
  expect(seen.routes).toEqual([route + '&window=m1&locale=es']);
  await expect(page.locator('.il-commerce')).toHaveCount(0);
});

test('in a 320x180 embed the open card fits above the control bar and Buy is reachable', async ({ page, context }) => {
  await serve(context);
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'View product' }).click();
  const stage = await page.locator('.il-player').boundingBox();
  const card = await page.locator('.il-commerce').boundingBox();
  const bar = await page.locator('.il-player__toolbar').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(stage.x);
  expect(card.y).toBeGreaterThanOrEqual(stage.y);
  expect(card.x + card.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
  const buy = page.getByRole('button', { name: 'Buy' });
  await buy.scrollIntoViewIfNeeded();
  await expect(buy).toBeVisible();
  await buy.click();
  await expect(page.getByRole('link', { name: 'Continue to Shopify' })).toBeAttached();
});
