import { expect, test } from '@playwright/test';

const program = '/demo/program.mp4';
const pageUrl = 'https://publisher.example/page';
const superImage = 'https://ads-images.test/super.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const googleHost = /(^|\.)(googleapis\.com|doubleclick\.net|googlesyndication\.com|googletagservices\.com)$/;

const vast = '<?xml version="1.0" encoding="UTF-8"?><VAST version="4.0"><Ad id="a1"><InLine>' +
  '<AdSystem>GAM</AdSystem><AdTitle>Super</AdTitle><Impression><![CDATA[https://ads-images.test/impression]]></Impression>' +
  '<Creatives><Creative><NonLinearAds><NonLinear width="600" height="90">' +
  '<StaticResource creativeType="image/png"><![CDATA[' + superImage + ']]></StaticResource>' +
  '</NonLinear></NonLinearAds></Creative></Creatives></InLine></Ad></VAST>';

// Enough of google.ima for the SDK ads module: records the request and plays one break on start().
const fakeIma = `(() => {
  const log = window.imaLog = { requests: [], initialized: 0, started: 0 };
  const listeners = () => {
    const map = {};
    return {
      addEventListener(type, callback) { (map[type] ??= []).push(callback); },
      fire(type, event = {}) { for (const callback of map[type] ?? []) callback(event); },
    };
  };
  const ima = {
    ViewMode: { NORMAL: 'normal' },
    AdEvent: { Type: { CONTENT_PAUSE_REQUESTED: 'pause', CONTENT_RESUME_REQUESTED: 'resume', ALL_ADS_COMPLETED: 'done' } },
    AdErrorEvent: { Type: { AD_ERROR: 'error' } },
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: 'loaded' } },
    AdDisplayContainer: class { initialize() { log.initialized++; } destroy() {} },
    AdsRequest: class {},
    AdsLoader: class {
      constructor() { Object.assign(this, listeners()); }
      requestAds(request) {
        log.requests.push({ adsResponse: request.adsResponse, pageUrl: request.pageUrl });
        setTimeout(() => {
          if (window.imaMode === 'error') return this.fire('error', { getError: () => ({}) });
          if (window.imaMode === 'silent') return;
          const manager = Object.assign(listeners(), {
            init() {},
            resize() {},
            destroy() {},
            start() {
              log.started++;
              setTimeout(() => manager.fire('pause', {}), window.imaPauseDelay ?? 50);
              window.endBreak = () => manager.fire('resume', {});
            },
          });
          this.fire('loaded', { getAdsManager: () => manager });
        }, 0);
      }
      contentComplete() {}
      destroy() {}
    },
  };
  window.google = { ima };
})();`;

// Enough of googletag to accept the command queue without serving anything.
const fakeGpt = 'window.gptLoaded = true; window.googletag = window.googletag || { cmd: [] };';

function embed(config) {
  return '/embed?config=' + encodeURIComponent(JSON.stringify(config));
}

function plan(extra) {
  return {
    version: 1, asset_id: 'asset-1', duration: 18, page_url: pageUrl,
    expires_at: new Date(Date.now() + 3600000).toISOString(), ...extra,
  };
}

const scenes = {
  formats: ['super'],
  pacing: { min_seconds: 1.5, max_seconds: null, gap_after_seconds: 0, max_per_video: null, cut_clearance_seconds: 0 },
  graphics: [{ format: 'super', tag_url: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/123/site/super&sz=600x90' }],
  windows: [{ id: 'p1', start_ms: 0, end_ms: 9000, targeting: { ilayers_context: 'deportes' } }],
};
const cuts = [{ id: 'pre', at: 0, position: 'preroll', tag_url: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/123/site/video', contextual: false }];

async function stubGoogle(page, { ima = 'ok' } = {}) {
  const seen = { gampad: [], ima: 0, gpt: 0, chunks: [] };
  page.on('request', request => {
    if (/\/ads-[\w-]+\.js$/.test(new URL(request.url()).pathname)) seen.chunks.push(request.url());
  });
  await page.route('**/ima3.js', route => {
    seen.ima++;
    return ima === 'fail' ? route.abort() : route.fulfill({ contentType: 'application/javascript', body: fakeIma });
  });
  await page.route('**/gpt.js', route => {
    seen.gpt++;
    return route.fulfill({ contentType: 'application/javascript', body: fakeGpt });
  });
  await page.route('**/gampad/ads**', route => {
    seen.gampad.push(route.request().url());
    return route.fulfill({ contentType: 'application/xml', body: vast, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route('https://ads-images.test/**', route => route.fulfill({ contentType: 'image/png', body: png }));
  return seen;
}

function watchGoogle(page) {
  const hosts = [];
  page.on('request', request => {
    const { hostname } = new URL(request.url());
    if (googleHost.test(hostname)) hosts.push(request.url());
  });
  return hosts;
}

test('a plan-less embed requests no ads code and nothing from Google', async ({ page }) => {
  const seen = await stubGoogle(page);
  const google = watchGoogle(page);
  await page.goto(embed({ src: program, locale: 'en' }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(0.5);
  expect(seen.chunks).toEqual([]);
  expect(google).toEqual([]);
  expect(seen.ima + seen.gpt + seen.gampad.length).toBe(0);
  await expect(page.locator('.il-player__ad-container')).toHaveCount(0);
});

test('shows the planned Super from Google Ad Manager during its window', async ({ page }) => {
  const seen = await stubGoogle(page);
  await page.goto(embed({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan({ scenes }) } }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => seen.chunks.length).toBe(1);
  await expect.poll(() => seen.gampad.length).toBe(1);
  const request = new URL(seen.gampad[0]);
  expect(request.origin + request.pathname).toBe('https://pubads.g.doubleclick.net/gampad/ads');
  const custom = new URLSearchParams(request.searchParams.get('cust_params'));
  expect(custom.get('ilayers_context')).toBe('deportes');
  expect(custom.get('il_format')).toBe('super');
  expect(request.searchParams.get('url')).toBe(pageUrl);
  await expect(page.locator(`.il-player img[src="${superImage}"]`)).toBeVisible();
  expect(await page.locator('video').evaluate(video => video.currentTime)).toBeLessThan(9);
  expect(seen.ima).toBe(0);
});

test('plays the planned break through IMA and blocks seeking until it ends', async ({ page }) => {
  const seen = await stubGoogle(page);
  await page.goto(embed({
    src: program, locale: 'en', metadata: { id: 'video-ads' },
    embed: { playback: { muted: true }, engagement: { watch_later: true } },
    ads: { plan: plan({ cuts }) },
  }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await expect.poll(() => seen.ima).toBe(1);
  await expect.poll(() => page.evaluate(() => window.imaLog?.requests.length)).toBe(1);
  const { adsResponse, pageUrl: requestedPage } = await page.evaluate(() => window.imaLog.requests[0]);
  expect(requestedPage).toBe(pageUrl);
  expect(adsResponse).toContain('timeOffset="start"');
  expect(adsResponse).toContain('breakId="pre"');
  expect(adsResponse).toContain('https://pubads.g.doubleclick.net/gampad/ads?iu=%2F123%2Fsite%2Fvideo');
  expect(adsResponse).toContain('url=' + encodeURIComponent(pageUrl));

  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.imaLog.initialized)).toBe(1);
  await expect(page.locator('.il-player--ad-break')).toHaveCount(1);
  await expect(page.locator('.il-player__center')).toBeHidden();
  await expect(video).toHaveJSProperty('paused', true);
  await expect(page.getByRole('slider', { name: 'Playback position' })).toBeDisabled();
  const before = await video.evaluate(element => element.currentTime);
  await page.locator('.il-player').press('ArrowRight');
  await page.getByRole('button', { name: 'Play', exact: true }).last().click({ force: true });
  expect(await video.evaluate(element => element.currentTime)).toBe(before);
  await expect(video).toHaveJSProperty('paused', true);

  // Every change to the centre button until the first playing event: none may reveal it.
  await page.evaluate(() => {
    const center = document.querySelector('.il-player__center');
    const content = document.querySelector('video');
    window.centerShown = [];
    const observer = new MutationObserver(records => {
      for (const record of records) if (record.oldValue === null) window.centerShown.push('mutation');
    });
    observer.observe(center, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });
    const sample = () => {
      if (!center.hidden) window.centerShown.push('frame');
      if (!window.playingSeen) requestAnimationFrame(sample);
    };
    content.addEventListener('playing', () => {
      window.playingSeen = true;
      if (!center.hidden) window.centerShown.push('playing');
      observer.disconnect();
    }, { once: true });
    window.endBreak();
    sample();
  });
  await expect(page.locator('.il-player--ad-break')).toHaveCount(0);
  await expect(video).toHaveJSProperty('paused', false);
  await expect.poll(() => page.evaluate(() => window.playingSeen)).toBe(true);
  expect(await page.evaluate(() => window.centerShown)).toEqual([]);
  await video.evaluate(element => element.pause());
  await expect(page.locator('.il-player__center')).toBeVisible();
  await video.evaluate(element => element.play());
  await expect(page.getByRole('slider', { name: 'Playback position' })).toBeEnabled();
  await page.locator('.il-player').focus();
  await page.locator('.il-player').press('ArrowRight');
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(4);
});

for (const failure of ['error', 'fail']) {
  test(`keeps the content playing when IMA ${failure === 'error' ? 'reports an error' : 'cannot load'}`, async ({ page }) => {
    await stubGoogle(page, { ima: failure === 'fail' ? 'fail' : 'ok' });
    await page.addInitScript(mode => { window.imaMode = mode; }, failure);
    await page.goto(embed({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan({ cuts }) } }));
    const video = page.locator('video');
    await expect(video).toHaveJSProperty('readyState', 4);
    await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(1);
    await expect(video).toHaveJSProperty('paused', false);
    await expect(page.locator('.il-player--ad-break')).toHaveCount(0);
    await expect(page.getByRole('slider', { name: 'Playback position' })).toBeEnabled();
  });
}

test('the console simulation ignores a plan and loads nothing from Google', async ({ page }) => {
  const seen = await stubGoogle(page);
  const google = watchGoogle(page);
  await page.goto('/host');
  await page.evaluate(src => {
    const frame = document.createElement('iframe');
    frame.src = src;
    frame.width = 832;
    frame.height = 472;
    document.body.append(frame);
  }, embed({ demo: true, locale: 'en', adapter: 'sdk', demoAd: 'none', ads: { plan: plan({ scenes, cuts }) } }));
  const player = page.frameLocator('iframe');
  await expect(player.locator('video')).toHaveJSProperty('readyState', 4);
  await page.evaluate(() => document.querySelector('iframe').contentWindow
    .postMessage({ type: 'il-player:simulate', format: 'super' }, location.origin));
  await expect(player.locator('.il-scene')).toBeVisible();
  expect(seen.chunks).toEqual([]);
  expect(google).toEqual([]);
  expect(seen.ima + seen.gpt + seen.gampad.length).toBe(0);
  await expect(player.locator('.il-player__ad-container')).toHaveCount(0);
});

const midroll = [{ id: 'mid', at: 8, position: 'midroll', tag_url: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/123/site/video' }];

test('holds the content until the pre-roll starts and plays it after the break', async ({ page }) => {
  await stubGoogle(page);
  await page.addInitScript(() => { window.imaPauseDelay = 1500; });
  await page.goto(embed({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan({ cuts }) } }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await expect.poll(() => page.evaluate(() => window.imaLog?.requests.length)).toBe(1);
  await page.locator('.il-player__center').click();
  await expect(page.locator('.il-player__center')).toBeHidden();
  await page.waitForTimeout(700);
  await page.locator('.il-player__button--play').click();
  expect(await video.evaluate(element => element.currentTime)).toBe(0);
  await expect(video).toHaveJSProperty('paused', true);
  expect(await page.evaluate(() => window.imaLog.started)).toBe(1);
  await expect(page.locator('.il-player--ad-break')).toHaveCount(1);
  expect(await video.evaluate(element => element.currentTime)).toBe(0);
  await page.evaluate(() => window.endBreak());
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0.3);
});

test('starts the content after about 4 seconds when IMA never answers', async ({ page }) => {
  await stubGoogle(page);
  await page.addInitScript(() => { window.imaMode = 'silent'; });
  await page.goto(embed({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan({ cuts }) } }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const clicked = Date.now();
  await page.waitForTimeout(3000);
  expect(await video.evaluate(element => element.currentTime)).toBe(0);
  await expect(page.locator('.il-player__center')).toBeHidden();
  await expect(video).toHaveJSProperty('paused', false, { timeout: 3000 });
  const waited = Date.now() - clicked;
  expect(waited).toBeGreaterThan(3500);
  expect(waited).toBeLessThan(5500);
});

test('starts the content at once when the first cut is a mid-roll', async ({ page }) => {
  await stubGoogle(page);
  await page.addInitScript(() => { window.imaMode = 'silent'; });
  await page.goto(embed({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan({ cuts: midroll }) } }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(video).toHaveJSProperty('paused', false, { timeout: 1000 });
});

test('a player destroyed during the hold starts nothing', async ({ page }) => {
  await stubGoogle(page);
  await page.addInitScript(() => { window.imaMode = 'silent'; });
  await page.goto('/host');
  await page.evaluate(async config => {
    const { mountILPlayer } = await import('/native-il-player.js');
    const host = document.createElement('div');
    document.body.append(host);
    window.player = mountILPlayer(host, config);
    window.content = window.player.video;
    window.played = 0;
    window.content.addEventListener('play', () => { window.played++; });
    await new Promise(resolve => window.content.readyState >= 1 ? resolve() : window.content.addEventListener('loadedmetadata', resolve));
  }, { src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan({ cuts }) } });
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => window.player.destroy());
  await page.waitForTimeout(4500);
  expect(await page.evaluate(() => [window.played, window.content.currentTime])).toEqual([0, 0]);
});

test('does not save the resume bookmark during a break and saves it again after', async ({ page }) => {
  await stubGoogle(page);
  const key = 'interactivelayers.il-player:v1:video-ads';
  await page.goto(embed({
    src: program, locale: 'en', metadata: { id: 'video-ads' },
    embed: { playback: { muted: true }, engagement: { watch_later: true } },
    ads: { plan: plan({ cuts }) },
  }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await page.getByRole('button', { name: 'Watch later', exact: true }).click();
  const saved = () => page.evaluate(name => JSON.parse(localStorage.getItem(name)).watchAt, key);
  expect(await saved()).toBe(0);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(page.locator('.il-player--ad-break')).toHaveCount(1);
  // An ad playing in the same element moves its clock; none of it may reach the bookmark.
  await video.evaluate(element => { element.currentTime = 7; });
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeCloseTo(7, 0);
  await video.evaluate(element => {
    for (const type of ['timeupdate', 'pause']) element.dispatchEvent(new Event(type));
  });
  expect(await saved()).toBe(0);
  await page.evaluate(() => window.endBreak());
  await expect(page.locator('.il-player--ad-break')).toHaveCount(0);
  await expect(video).toHaveJSProperty('paused', false);
  await video.evaluate(element => element.pause());
  await expect.poll(saved).toBeGreaterThan(6.5);
});

test('shows the centre play button when the content cannot resume after a break', async ({ page }) => {
  await stubGoogle(page);
  await page.goto(embed({ src: program, locale: 'en', embed: { playback: { muted: true } }, ads: { plan: plan({ cuts }) } }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await page.locator('.il-player__center').click();
  await expect(page.locator('.il-player--ad-break')).toHaveCount(1);
  await expect(page.locator('.il-player__center')).toBeHidden();
  await video.evaluate(element => {
    element.play = () => Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
  });
  await page.evaluate(() => window.endBreak());
  await expect(page.locator('.il-player--ad-break')).toHaveCount(0);
  await expect(page.locator('.il-player__center')).toBeVisible();
  await expect(video).toHaveJSProperty('paused', true);
});
