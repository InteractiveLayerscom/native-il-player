import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function serve(context, { answer = () => ({ status: 200, body: card }), embedded = null, frame = [800, 450], handoff = 201 } = {}) {
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
      const status = typeof handoff === 'function' ? handoff(JSON.parse(request.request().postData()).variantId) : handoff;
      if (status !== 201) return request.fulfill({ status, headers: cors, contentType: 'application/json', body: '{"error":"offer_unavailable"}' });
      return request.fulfill({ status: 201, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ continueUrl: 'https://shop.test/checkout', qrImageUrl: 'https://ads-images.test/qr.png' }) });
    }
    return request.fulfill({ status: 204, headers: cors });
  });
  await context.route('https://shop.test/**', (request) => request.fulfill({ contentType: 'text/html', body: '<title>Checkout</title>' }));
  await context.route('https://publisher.test/**', (request) => request.fulfill({ contentType: 'text/html',
    body: `<!doctype html><iframe id=player sandbox="allow-scripts allow-same-origin" style="width:${frame[0]}px;height:${frame[1]}px;border:0"
      src="${origin}${embedPath(embedded)}"></iframe>` }));
  return seen;
}

test('a plan with commerce shows the product card in the scene, fires the impression once and Buy opens the purchase', async ({ page, context }) => {
  const seen = await serve(context);
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const open = page.getByRole('button', { name: 'View product' });
  await expect(open).toBeVisible();
  expect(seen.routes.map((url) => url.split('&scene=')[0])).toEqual([route + '&window=m1&locale=en']);
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
  expect(seen.routes.map((url) => url.split('&scene=')[0])).toEqual([route + '&window=m1&locale=es']);
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

// At the pace of a person: pauses, an open product, a scene that ends while choosing.
async function cardShown(page, context) {
  const seen = await serve(context);
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'View product' })).toBeVisible();
  return seen;
}
const paused = (page) => page.locator('video').evaluate((video) => video.paused);
const position = (page) => page.locator('video').evaluate((video) => video.currentTime);

test('pausing with the card closed keeps it, for as long as the viewer looks', async ({ page, context }) => {
  const seen = await cardShown(page, context);
  await page.locator('.il-player__toolbar').getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(2500);
  await expect(page.getByRole('button', { name: 'View product' })).toBeVisible();
  await page.locator('.il-player__toolbar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View product' })).toBeVisible();
  expect(seen.impressions).toBe(1);
});

test('opening the product pauses the video, hides the centre button, and closing resumes it', async ({ page, context }) => {
  await cardShown(page, context);
  await page.getByRole('button', { name: 'View product' }).click();
  await expect.poll(() => paused(page)).toBe(true);
  await expect(page.locator('.il-player__center')).toBeHidden();
  const at = await position(page);
  await page.waitForTimeout(2000);
  expect(await position(page)).toBe(at);
  await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();
  // Space on a button of the card chooses it; it does not toggle the video.
  await page.getByRole('button', { name: 'Black / M' }).focus();
  await page.keyboard.press(' ');
  expect(await paused(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Buy' })).toBeHidden();
  await expect.poll(() => paused(page)).toBe(false);
});

test('a viewer who plays with the product open keeps it open past the scene, and closing it then removes it', async ({ page, context }) => {
  await cardShown(page, context);
  await page.getByRole('button', { name: 'View product' }).click();
  await expect.poll(() => paused(page)).toBe(true);
  await page.locator('.il-player__toolbar').getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => position(page), { timeout: 15000 }).toBeGreaterThan(9);
  await expect(page.getByRole('button', { name: 'Buy' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.il-commerce')).toHaveCount(0);
  expect(await paused(page)).toBe(false);
});

test('after Continue to Shopify the video stays paused', async ({ page, context }) => {
  await cardShown(page, context);
  await page.getByRole('button', { name: 'View product' }).click();
  await page.getByRole('button', { name: 'Buy' }).click();
  const link = page.getByRole('link', { name: 'Continue to Shopify' });
  const [checkout] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await expect(checkout).toHaveURL('https://shop.test/checkout');
  await page.bringToFront();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(500);
  expect(await paused(page)).toBe(true);
});

test('with a light brand the open card\'s title and price read at 4.5:1 on its real background', async ({ page, context }) => {
  const branded = { ...card, brand: { accent: '#aa2200', background: '#ffffff' } };
  await serve(context, { answer: () => ({ status: 200, body: branded }) });
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'View product' }).click();
  const ratios = await page.evaluate(() => {
    const rgb = (value) => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const surface = rgb(getComputedStyle(document.querySelector('.il-commerce-panel')).backgroundColor);
    return Object.fromEntries(['.il-commerce-title', '.il-commerce-price', '.il-commerce-caption', '.il-commerce-header span']
      .map((selector) => [selector, ratio(rgb(getComputedStyle(document.querySelector(selector)).color), surface)]));
  });
  for (const [selector, value] of Object.entries(ratios)) expect(value, selector).toBeGreaterThanOrEqual(4.5);
});


// The QR is the only way to finish from an iframe that cannot open tabs: after Buy it must be fully visible.
async function insidePanel(frame, selector) {
  const panel = await frame.locator('.il-commerce-panel').boundingBox();
  const box = await frame.locator(selector).boundingBox();
  return box.x >= panel.x - 0.5 && box.y >= panel.y - 0.5 &&
    box.x + box.width <= panel.x + panel.width + 0.5 && box.y + box.height <= panel.y + panel.height + 0.5;
}
const embeddedConfig = { src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } };

for (const [width, height] of [[640, 360], [500, 281], [380, 214]]) {
  test(`at ${width}x${height} in the publisher's iframe, the link and the whole QR are visible after Buy`, async ({ page, context }) => {
    await serve(context, { embedded: embeddedConfig, frame: [width, height] });
    await page.goto('https://publisher.test/page');
    const frame = page.frameLocator('#player');
    await frame.getByRole('button', { name: 'Play', exact: true }).first().click();
    await frame.getByRole('button', { name: 'View product' }).click();
    await frame.getByRole('button', { name: 'Buy' }).click();
    const link = frame.getByRole('link', { name: 'Continue to Shopify' });
    await expect(link).toBeFocused();
    const qr = frame.locator('.il-commerce-qr img');
    await expect.poll(() => qr.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await insidePanel(frame, '.il-commerce-result a')).toBe(true);
    expect(await insidePanel(frame, '.il-commerce-qr')).toBe(true);
    // The close control: in view at the Console's size; below it, a scroll up or Escape away.
    if (width >= 640) expect(await insidePanel(frame, '.il-commerce-close')).toBe(true);
    await link.press('Escape');
    await expect(frame.getByRole('link', { name: 'Continue to Shopify' })).toHaveCount(0);
  });
}

test('at 640x360 an expired offer\'s message is visible without the viewer scrolling', async ({ page, context }) => {
  await serve(context, { embedded: embeddedConfig, frame: [640, 360], handoff: 404 });
  await page.goto('https://publisher.test/page');
  const frame = page.frameLocator('#player');
  await frame.getByRole('button', { name: 'Play', exact: true }).first().click();
  await frame.getByRole('button', { name: 'View product' }).click();
  await frame.getByRole('button', { name: 'Buy' }).click();
  await expect(frame.locator('.il-commerce-result')).toHaveText('This offer is no longer available.');
  expect(await insidePanel(frame, '.il-commerce-result')).toBe(true);
});


// Phones: the link is the way to buy, so after Buy it is always fully in view and focused; the QR as far as it fits.
for (const [width, height] of [[360, 202], [320, 180]]) {
  test(`at ${width}x${height} (a phone) the link is fully in view and focused after Buy`, async ({ page, context }) => {
    // Like the real card: Spanish, a two-line title and a brand logo.
    const real = { ...card, brand: { accent: '#aa2200', background: '#ffffff', logoUrl: 'https://ads-images.test/logo.png' },
      commerce: { ...card.commerce, locale: 'es', title: 'Delantal de cocina de lino lavado con bolsillo frontal' } };
    await serve(context, { answer: () => ({ status: 200, body: real }), frame: [width, height],
      embedded: { ...embeddedConfig, locale: 'es' } });
    await page.goto('https://publisher.test/page');
    const frame = page.frameLocator('#player');
    await frame.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
    await frame.getByRole('button', { name: 'Ver producto' }).click();
    await frame.getByRole('button', { name: 'Comprar' }).click();
    const link = frame.getByRole('link', { name: 'Continuar a Shopify' });
    await expect(link).toBeFocused();
    const qr = frame.locator('.il-commerce-qr img');
    await expect.poll(() => qr.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.waitForTimeout(100);
    expect(await insidePanel(frame, '.il-commerce-result a')).toBe(true);
    // The whole QR beside it, at a size a phone camera can read (its caption gives way at this width).
    expect(await insidePanel(frame, '.il-commerce-qr img')).toBe(true);
    expect((await qr.boundingBox()).width).toBeGreaterThanOrEqual(84);
    await expect(qr).toHaveAttribute('alt', 'Escaneá el código con tu celular');
  });
}


for (const [width, height] of [[360, 202], [320, 180]]) {
  test(`at ${width}x${height} the product opens at the top, with the title in view and focus on a visible control`, async ({ page, context }) => {
    const real = { ...card, brand: { accent: '#aa2200', background: '#ffffff', logoUrl: 'https://ads-images.test/logo.png' },
      commerce: { ...card.commerce, locale: 'es', title: 'Delantal de cocina de lino lavado con bolsillo frontal' } };
    await serve(context, { answer: () => ({ status: 200, body: real }), frame: [width, height], embedded: { ...embeddedConfig, locale: 'es' } });
    await page.goto('https://publisher.test/page');
    const frame = page.frameLocator('#player');
    await frame.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
    await frame.getByRole('button', { name: 'Ver producto' }).click();
    await expect(frame.locator('.il-commerce-panel')).toBeVisible();
    expect(await frame.locator('.il-commerce-panel').evaluate((panel) => panel.scrollTop)).toBe(0);
    expect(await insidePanel(frame, '.il-commerce-title')).toBe(true);
    const focused = await frame.locator('.il-commerce-panel').evaluate((panel) => {
      const box = panel.ownerDocument.activeElement.getBoundingClientRect();
      const view = panel.getBoundingClientRect();
      return panel.contains(panel.ownerDocument.activeElement) && box.top >= view.top - 0.5 && box.bottom <= view.bottom + 0.5;
    });
    expect(focused).toBe(true);
    // The compact panel has room for the chosen variant, so focus starts on it.
    await expect(frame.locator('.il-commerce-variants button').first()).toBeFocused();
  });
}


const openProduct = async (page, context, commerce, size = [320, 180]) => {
  await serve(context, { answer: () => ({ status: 200, body: { ...card, commerce: { ...card.commerce, ...commerce } } }),
    frame: size, embedded: embeddedConfig });
  await page.goto('https://publisher.test/page');
  const frame = page.frameLocator('#player');
  await frame.getByRole('button', { name: 'Play', exact: true }).first().click();
  await frame.getByRole('button', { name: 'View product' }).click();
  await expect(frame.locator('.il-commerce-panel')).toBeVisible();
  return frame;
};

test('with every variant sold out, focus is on Close and Escape closes the product', async ({ page, context }) => {
  // At a size where the variant is in view, so only its being disabled sends focus to Close.
  const frame = await openProduct(page, context, { variants: card.commerce.variants.map((v) => ({ ...v, availableForSale: false })) }, [640, 360]);
  await expect(frame.locator('.il-commerce-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(frame.locator('.il-commerce-panel')).toBeHidden();
});

test('a chosen variant late in a long row is scrolled into view sideways', async ({ page, context }) => {
  const variants = Array.from({ length: 10 }, (_, i) => ({ id: 'v' + i, label: 'Variante larga ' + i, price: '100.00', availableForSale: i === 8 }));
  const frame = await openProduct(page, context, { variants });
  const inRow = await frame.locator('.il-commerce-variants').evaluate((row) => {
    const chosen = row.querySelector('[aria-pressed="true"]').getBoundingClientRect();
    const view = row.getBoundingClientRect();
    return { label: row.querySelector('[aria-pressed="true"]').textContent, scrolled: row.scrollLeft > 0,
      inside: chosen.left >= view.left - 0.5 && chosen.right <= view.right + 0.5 };
  });
  expect(inRow).toEqual({ label: 'Variante larga 8', scrolled: true, inside: true });
});


// iADServer's real answer for a designed Súper from the «Fila de productos» template: the whole product card is the action.
const designedCard = {
  id: 'dlv_1', format: 'super', start: 1000, end: 11000, window: 'm1',
  impressionUrl: 'https://ads.iadserver.com/events/dlv_1/impression',
  scene: { format: 'super', width: 1440, height: 216, durationMs: 10000, layers: [
    { id: 'card', type: 'rect', x: 86, y: 26, width: 1267, height: 164, fill: '#151923', stroke: '#798399', strokeWidth: 2, radius: 12, productIndex: 0, action: 'product' },
    { id: 'image', type: 'image', x: 99, y: 39, width: 380, height: 138, fill: '#242d41', radius: 7, fit: 'contain', binding: 'image', productIndex: 0, src: 'https://ads-images.test/apron.png' },
    { id: 'title', type: 'text', x: 492, y: 39, width: 848, height: 64, fill: '#ffffff', text: 'Sartén de cocina (prueba IL)', fontSize: 29, fontWeight: 700, binding: 'title', productIndex: 0, maxLines: 2 },
    { id: 'price', type: 'text', x: 492, y: 116, width: 848, height: 64, fill: '#ffc3ce', text: 'USD 10.0', fontSize: 38, fontWeight: 600, binding: 'price', productIndex: 0, maxLines: 1 },
  ] },
  products: [{ ...card.commerce, title: 'Sartén de cocina (prueba IL)', imageUrl: 'https://ads-images.test/apron.png' }],
};

for (const [width, height] of [[1280, 720], [390, 220]]) {
  test(`at ${width}x${height} a designed banner shows a visible Buy, is not clipped, and Buy reaches the cart`, async ({ page, context }) => {
    const seen = await serve(context, { answer: () => ({ status: 200, body: designedCard }) });
    await page.setViewportSize({ width, height });
    await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    const chip = page.locator('.il-scene-buy');
    await expect(chip).toBeVisible({ timeout: 10000 });
    await expect(chip).toHaveText('Buy');
    const layout = await page.evaluate(() => {
      const root = document.querySelector('.il-scene').getBoundingClientRect();
      const inside = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return r.top >= root.top - 0.5 && r.bottom <= root.bottom + 0.5 && r.left >= root.left - 0.5 && r.right <= root.right + 0.5; };
      const buy = document.querySelector('.il-scene-buy');
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("[data-layer-id='price'] div"));
      const price = range.getBoundingClientRect(), b = buy.getBoundingClientRect();
      return { title: inside("[data-layer-id='title']"), card: inside("[data-layer-id='card']"), chip: inside('.il-scene-buy'),
        unclipped: buy.scrollWidth <= buy.clientWidth + 1, overPrice: price.left < b.right && price.right > b.left && price.top < b.bottom && price.bottom > b.top,
        name: document.querySelector('.il-scene-action').getAttribute('aria-label') };
    });
    expect(layout).toEqual({ title: true, card: true, chip: true, unclipped: true, overPrice: false, name: 'Buy: Sartén de cocina (prueba IL)' });
    const box = await chip.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.il-commerce-buy').click();
    await expect.poll(() => seen.handoffs.length).toBe(1);
  });
}


// What the viewer sees once the SDK keeps an opened panel: it stays after its scene, with no time limit, until the
// viewer closes it, another product opens, a break starts, or the media changes. The video is 18 s long.
const playBar = (page) => page.locator('.il-player__toolbar').getByRole('button', { name: 'Play', exact: true });
const seekTo = (page, seconds) => page.locator('video').evaluate((video, to) => { video.currentTime = to; }, seconds);
const buy = (page) => page.getByRole('button', { name: 'Buy' });

// Opens the product from the card, then plays on (opening pauses the video).
async function openAndResume(page, context, serveOptions = {}, config = {}, setup = null) {
  const seen = await serve(context, serveOptions);
  await setup?.();
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() }, ...config }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'View product' }).click();
  await expect(buy(page)).toBeVisible();
  await expect.poll(() => paused(page)).toBe(true);
  await playBar(page).click();
  await expect.poll(() => paused(page)).toBe(false);
  return seen;
}

test('the scene graphic ends with its window while the panel the viewer opened stays', async ({ page, context }) => {
  const designed = { ...designedCard, end: 6000, scene: { ...designedCard.scene, durationMs: 5000 } };
  await serve(context, { answer: () => ({ status: 200, body: designed }) });
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const chip = page.locator('.il-scene-buy');
  await expect(chip).toBeVisible({ timeout: 10000 });
  const box = await chip.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.il-commerce-buy')).toBeVisible();
  await playBar(page).click();
  await expect.poll(() => position(page), { timeout: 15000 }).toBeGreaterThan(6.5);
  await expect(page.locator('.il-scene')).toHaveCount(0);
  await expect(page.locator('.il-commerce-buy')).toBeVisible();
  expect(await paused(page)).toBe(false);
});

test('an opened panel outlasts the old cue limit (holdUntil): it is still open seconds after it', async ({ page, context }) => {
  await openAndResume(page, context, { answer: () => ({ status: 200, body: { ...card, holdUntil: 9000 } }) });
  await seekTo(page, 14);
  await expect.poll(() => position(page)).toBeGreaterThan(14);
  await page.waitForTimeout(1500);
  await expect(buy(page)).toBeVisible();
});

// A 100 s video with a keyframe every second, so the page can jump to any second of it; served with range support.
function makeLongVideo() {
  const dir = mkdtempSync(join(tmpdir(), 'il-long-'));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5:d=100',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '5', '-movflags', '+faststart', join(dir, 'long.mp4')]);
  return dir;
}
const routeLongVideo = (context, dir) => context.route(origin + '/demo/long.mp4', (request) => {
  const file = readFileSync(join(dir, 'long.mp4'));
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.request().headers().range ?? '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
  return request.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', body: file.subarray(start, end + 1),
    headers: { 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${file.length}` } : {}) } });
});

test('an opened panel is still there 60 s of content time after its scene, with no activity from the viewer', async ({ page, context }) => {
  const dir = makeLongVideo();
  try {
    await openAndResume(page, context, {}, { src: '/demo/long.mp4', ads: { plan: plan({ duration: 100 }) } }, () => routeLongVideo(context, dir));
    // The scene ended at 8 s; the old limit was 60 s of content time after that (68 s).
    await seekTo(page, 80);
    await expect.poll(() => position(page)).toBeGreaterThan(80);
    await page.waitForTimeout(1500);
    await expect(buy(page)).toBeVisible();
    await seekTo(page, 99);
    await page.waitForTimeout(500);
    await expect(buy(page)).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with the scene over, Escape closes the panel and nothing is left on the video, which keeps playing', async ({ page, context }) => {
  await openAndResume(page, context);
  await seekTo(page, 10);
  await expect.poll(() => position(page)).toBeGreaterThan(10);
  await expect(buy(page)).toBeVisible();
  // Escape acts from inside the panel (the viewer's Play click left focus on the control bar).
  await page.getByRole('button', { name: 'Close' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.il-commerce')).toHaveCount(0);
  expect(await paused(page)).toBe(false);
});

test('Close closes a panel that outlasted its scene', async ({ page, context }) => {
  await openAndResume(page, context);
  await seekTo(page, 10);
  await expect.poll(() => position(page)).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.il-commerce')).toHaveCount(0);
  expect(await paused(page)).toBe(false);
});

test('at the end of the video the closed card goes', async ({ page, context }) => {
  // Closed card: it goes with the end of the video even though its scene lasts to the end.
  const long = { ...card, end: 18000 };
  await serve(context, { answer: () => ({ status: 200, body: long }) });
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'View product' })).toBeVisible();
  await seekTo(page, 17.5);
  await expect.poll(() => page.locator('video').evaluate((video) => video.ended), { timeout: 10000 }).toBe(true);
  await expect(page.getByRole('button', { name: 'View product' })).toHaveCount(0);
});

test('an open panel stays when the video ends, and closing it leaves the ended video as it was', async ({ page, context }) => {
  await openAndResume(page, context);
  await seekTo(page, 17.5);
  await expect.poll(() => page.locator('video').evaluate((video) => video.ended), { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(500);
  await expect(buy(page)).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.il-commerce')).toHaveCount(0);
  expect(await page.locator('video').evaluate((video) => video.ended)).toBe(true);
});

test('a 404 on Buy turns Buy off for that variant only; another variant can be bought', async ({ page, context }) => {
  const two = { ...card, commerce: { ...card.commerce, variants: [
    { id: 'gid://shopify/ProductVariant/101', label: 'Black / M', price: '100.00', availableForSale: true },
    { id: 'gid://shopify/ProductVariant/102', label: 'Black / L', price: '100.00', availableForSale: true },
  ] } };
  const seen = await serve(context, { answer: () => ({ status: 200, body: two }), handoff: (variant) => (variant.endsWith('/101') ? 404 : 201) });
  await page.goto(origin + embedPath({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'View product' }).click();
  await page.getByRole('button', { name: 'Black / M' }).click();
  await buy(page).click();
  await expect(page.locator('.il-commerce-result')).toHaveText('This offer is no longer available.');
  await expect(buy(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Black / L' }).click();
  await expect(buy(page)).toBeEnabled();
  await expect(page.locator('.il-commerce-result')).toHaveText('');
  await page.getByRole('button', { name: 'Black / M' }).click();
  await expect(buy(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Black / L' }).click();
  await buy(page).click();
  await expect(page.getByRole('link', { name: 'Continue to Shopify' })).toHaveAttribute('href', 'https://shop.test/checkout');
  expect(seen.handoffs.map((body) => JSON.parse(body).variantId.split('/').pop())).toEqual(['101', '102']);
});

// Two scenes 39 s apart (the plan's pacing allows a window only 30 s or more after the start of every one before it).
// The viewer opens the first product and plays on: the next scene's product is asked for at its lead time with the
// panel still open, its card waits behind the panel, and it is there once the panel is closed.
for (const how of ['playback', 'seek']) {
  test(`with a panel open, the next scene's product is asked for once and its card is there after Close (${how})`, async ({ page, context }) => {
    const second = { ...card, id: 'dlv_2', start: 40000, end: 50000, window: 'm2',
      impressionUrl: 'https://ads.iadserver.com/events/dlv_2/impression',
      commerce: { ...card.commerce, id: 'gid://shopify/Product/200', title: 'Pan', handoffUrl: 'https://ads.iadserver.com/commerce/offer/dlv_2',
        viewUrl: 'https://ads.iadserver.com/events/dlv_2/creativeView' } };
    const twoScenes = plan({ duration: 100 });
    twoScenes.commerce.windows = [{ id: 'm1', start_ms: 1000, end_ms: 8000 }, { id: 'm2', start_ms: 40000, end_ms: 50000 }];
    const dir = makeLongVideo();
    try {
      const seen = await openAndResume(page, context, { answer: (url) => ({ status: 200, body: url.searchParams.get('window') === 'm2' ? second : card }) },
        { src: '/demo/long.mp4', ads: { plan: twoScenes } }, () => routeLongVideo(context, dir));
      const asked = (window) => seen.routes.filter((url) => new URL(url).searchParams.get('window') === window).length;
      expect(asked('m1')).toBe(1);
      expect(asked('m2')).toBe(0);
      // The viewer's choice in the panel, which the next scene must not disturb.
      await page.getByRole('button', { name: 'Black / M' }).focus();
      if (how === 'playback') {
        // 35 s is m2's lead time (5 s before 40 s): nothing is asked for before it, the request goes out as playback crosses it.
        await seekTo(page, 33);
        await expect.poll(() => position(page)).toBeGreaterThan(33);
        expect(asked('m2')).toBe(0);
        await expect.poll(() => position(page), { timeout: 15000 }).toBeGreaterThan(35.5);
      } else {
        await seekTo(page, 41);
        await expect.poll(() => position(page)).toBeGreaterThan(41);
      }
      await expect.poll(() => asked('m2')).toBe(1);
      await page.waitForTimeout(1000);
      expect(asked('m2')).toBe(1);
      // The first product's panel is untouched; the second card sits behind it and cannot be operated.
      await expect(page.locator('.il-commerce--open .il-commerce-title')).toHaveText('Apron');
      await expect(page.getByRole('button', { name: 'Black / M' })).toBeFocused();
      await expect(page.getByRole('button', { name: 'Black / M' })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.il-commerce')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'View product' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Close' }).click();
      const next = page.getByRole('button', { name: 'View product' });
      await expect(next).toBeVisible();
      await next.focus();
      await expect(next).toBeFocused();
      await expect.poll(() => seen.impressions).toBe(2);
      await next.click();
      await expect(page.locator('.il-commerce--open .il-commerce-title')).toHaveText('Pan');
      expect(seen.impressions).toBe(2);
      expect(asked('m1') + asked('m2')).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
