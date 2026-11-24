import { expect, test } from '@playwright/test';

// Buy during an ad: the product the viewer opened stays after the ad, with the content paused, until it is closed.
const origin = 'https://player.test';
const program = '/demo/program.mp4';
const delivery = 'D'.repeat(43);
const position = (page) => page.locator('video').evaluate((video) => video.currentTime);
const offer = {
  id: 'gid://shopify/Product/100', title: 'Apron', price: '100.00', currency: 'USD', locale: 'en',
  variants: [{ id: 'gid://shopify/ProductVariant/101', label: 'Black / M', price: '100.00', availableForSale: true }],
  handoffUrl: `https://ads.iadserver.com/commerce/offer/${delivery}`,
  viewUrl: `https://ads.iadserver.com/events/${delivery}/creativeView`,
};

// Enough of google.ima for one pre-roll whose ad iADServer linked to a shop (Ad@id il-shop-preroll-<delivery>).
const fakeIma = `(() => {
  const listeners = () => { const map = {}; return {
    addEventListener(type, callback) { (map[type] ??= []).push(callback); },
    fire(type, event = {}) { for (const callback of map[type] ?? []) callback(event); } }; };
  const ad = { getAdId: () => 'il-shop-preroll-${delivery}', getCreativeId: () => 'cr1' };
  window.google = { ima: {
    ViewMode: { NORMAL: 'normal' },
    AdEvent: { Type: { CONTENT_PAUSE_REQUESTED: 'pause', CONTENT_RESUME_REQUESTED: 'resume', ALL_ADS_COMPLETED: 'done',
      STARTED: 'started', COMPLETE: 'complete' } },
    AdErrorEvent: { Type: { AD_ERROR: 'error' } },
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: 'loaded' } },
    AdDisplayContainer: class { initialize() {} destroy() {} },
    AdsRequest: class {},
    AdsLoader: class {
      constructor() { Object.assign(this, listeners()); }
      requestAds() {
        setTimeout(() => {
          const manager = Object.assign(listeners(), { init() {}, resize() {}, destroy() {}, setVolume() {},
            start() {
              setTimeout(() => { manager.fire('pause', {}); manager.fire('started', { getAd: () => ad }); }, 50);
              // The ad plays to its end: IMA reports it complete, then asks for the content.
              window.endAd = () => { manager.fire('complete', {}); manager.fire('resume', {}); };
            } });
          this.fire('loaded', { getAdsManager: () => manager });
        }, 0);
      }
      contentComplete() {}
      destroy() {}
    },
  } };
})();`;

function plan() {
  return {
    version: 1, asset_id: 'asset-1', duration: 18, page_url: 'https://publisher.example/page',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    cuts: [{ id: 'pre', at: 0, position: 'preroll', contextual: false,
      requests: [{ provider: 'iadserver', tag_url: 'https://ads.iadserver.com/gampad/ads?tag=shop&output=vast&vid=asset-1&cue_seconds=0' }] }],
    commerce: {
      kind: 'scene_product', url: origin + '/il-player/scene-product?project=p1&asset=asset-1&grant=g',
      break_url: origin + '/il-player/break-product?project=p1&asset=asset-1&grant=g',
      session: '9f1c0000000000000000000000000abc', lead_ms: 5000, windows: [],
      pacing: { min_seconds: 1.5, max_seconds: null, gap_after_seconds: 0, max_per_video: null, cut_clearance_seconds: 0 },
    },
  };
}

async function serve(page) {
  const seen = { products: 0, handoffs: 0, plays: 0 };
  await page.route('**/ima3.js', (route) => route.fulfill({ contentType: 'application/javascript', body: fakeIma }));
  await page.route(origin + '/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/il-player/break-product') {
      seen.products++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: url.searchParams.get('delivery'),
        format: 'midroll', linearCreativeId: url.searchParams.get('creative'), start: 0, end: 60000, commerce: offer }) });
    }
    const response = await route.fetch({ url: 'http://127.0.0.1:4194' + url.pathname + url.search });
    return route.fulfill({ response });
  });
  await page.route('https://ads.iadserver.com/**', (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname.startsWith('/commerce/offer/')) {
      seen.handoffs++;
      return route.fulfill({ status: 201, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ continueUrl: 'https://shop.test/checkout' }) });
    }
    return route.fulfill({ status: 204, headers: cors });
  });
  const config = { src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan() } };
  await page.goto(origin + '/embed?config=' + encodeURIComponent(JSON.stringify(config)));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(page.locator('.il-player--ad-break')).toHaveCount(1);
  await expect(page.locator('.il-commerce > button')).toBeVisible();
  await page.locator('video').evaluate((video) => video.addEventListener('play', () => { window.contentPlays = (window.contentPlays ?? 0) + 1; }));
  return seen;
}

test('a product opened during the ad stays after it, content waits, Buy reaches the cart and closing resumes once', async ({ page }) => {
  const seen = await serve(page);
  await page.locator('.il-commerce > button').click();
  await expect(page.locator('.il-commerce-buy')).toBeVisible();
  await page.evaluate(() => window.endAd());
  await expect(page.locator('.il-player--ad-break')).toHaveCount(0);          // the break itself ended on time
  await page.waitForTimeout(1000);
  await expect(page.locator('.il-commerce-buy')).toBeVisible();               // the purchase is still there
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  expect(await page.evaluate(() => window.contentPlays ?? 0)).toBe(0);
  await page.locator('.il-commerce-buy').click();
  await expect.poll(() => seen.handoffs).toBe(1);
  await expect(page.locator('.il-commerce-result a')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.il-commerce')).toHaveCount(0);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.contentPlays)).toBe(1);
  expect(seen.products).toBe(1);
});

test('a product never opened changes nothing: the card goes with the ad and content resumes', async ({ page }) => {
  await serve(page);
  await page.evaluate(() => window.endAd());
  await expect(page.locator('.il-player--ad-break')).toHaveCount(0);
  await expect(page.locator('.il-commerce')).toHaveCount(0);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.contentPlays)).toBe(1);
});

// A scene product the viewer opened and then played on with: a video break closes it, the playing ad's own product is the one that shows.
test('a video break starting closes the panel opened in the content, and the playing ad keeps its own', async ({ page }) => {
  const sceneCard = {
    id: 'dlv_scene', format: 'super', start: 1000, end: 4500, window: 'm1',
    imageUrl: 'https://ads-images.test/apron.png', mimeType: 'image/png',
    impressionUrl: 'https://ads.iadserver.com/events/dlv_scene/impression',
    commerce: { ...offer, id: 'gid://shopify/Product/300', title: 'Scene Pan', handoffUrl: 'https://ads.iadserver.com/commerce/offer/dlv_scene',
      viewUrl: 'https://ads.iadserver.com/events/dlv_scene/creativeView' },
  };
  const withMidroll = plan();
  withMidroll.cuts = [withMidroll.cuts[0], { ...withMidroll.cuts[0], id: 'mid', at: 5, position: 'midroll' }];
  withMidroll.commerce.windows = [{ id: 'm1', start_ms: 1000, end_ms: 4500 }];
  // IMA schedules the plan's VMAP mid-roll itself; here the page reports that pod starting, as IMA would.
  const ima = fakeIma.replace('window.endAd = ', `window.startMidroll = () => { manager.fire('pause', {});
        manager.fire('started', { getAd: () => ({ getAdId: () => 'il-shop-midroll-${delivery}', getCreativeId: () => 'cr1' }) }); };
      window.endAd = `);
  await page.route('**/ima3.js', (route) => route.fulfill({ contentType: 'application/javascript', body: ima }));
  await page.route(origin + '/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/il-player/scene-product') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(sceneCard) });
    if (url.pathname === '/il-player/break-product') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: url.searchParams.get('delivery'),
        format: 'midroll', linearCreativeId: url.searchParams.get('creative'), start: 0, end: 60000, commerce: offer }) });
    }
    const response = await route.fetch({ url: 'http://127.0.0.1:4194' + url.pathname + url.search });
    return route.fulfill({ response });
  });
  await page.route('https://ads-images.test/**', (route) => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }));
  await page.route('https://ads.iadserver.com/**', (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
    return route.fulfill({ status: 204, headers: cors });
  });
  const config = { src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: withMidroll } };
  await page.goto(origin + '/embed?config=' + encodeURIComponent(JSON.stringify(config)));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  // The pre-roll plays out untouched, then the content runs and the scene's card shows.
  await expect(page.locator('.il-player--ad-break')).toHaveCount(1);
  await page.evaluate(() => window.endAd());
  await expect(page.locator('.il-player--ad-break')).toHaveCount(0);
  await page.getByRole('button', { name: 'View product' }).click();
  await expect(page.locator('.il-commerce-title')).toHaveText('Scene Pan');
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await page.locator('.il-player__toolbar').getByRole('button', { name: 'Play', exact: true }).click();
  // The mid-roll at 5 s starts with the panel still open: the panel goes, the ad's own card (its own product) is there.
  await page.locator('video').evaluate((video) => { video.currentTime = 5; });
  await expect.poll(() => position(page)).toBeGreaterThan(5);
  await page.evaluate(() => window.startMidroll());
  await expect(page.locator('.il-player--ad-break')).toHaveCount(1);
  await expect(page.locator('.il-commerce-buy')).toBeHidden();
  await page.locator('.il-commerce > button').click();
  await expect(page.locator('.il-commerce-title')).toHaveText('Apron');
  await expect(page.locator('.il-commerce-buy')).toBeVisible();
});
