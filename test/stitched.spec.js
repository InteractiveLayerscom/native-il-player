import { expect, test } from '@playwright/test';

// ILPlayer over an HLS stream with ads stitched in as MediaTailor does it (test/stitched-fixture.mjs): pre-roll
// 0–4 s, content 0–14 at 4–18, mid-roll 18–22, content 14–30 at 22–38. Content frames carry their segment number in
// four black or white bands; ad frames are red. Every presented frame is checked against the SDK's graphic.
const superImage = 'https://ads-images.test/super.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const vast = '<?xml version="1.0" encoding="UTF-8"?><VAST version="4.0"><Ad id="a1"><InLine>' +
  '<AdSystem>GAM</AdSystem><AdTitle>Super</AdTitle><Impression><![CDATA[https://ads-images.test/impression]]></Impression>' +
  '<Creatives><Creative><NonLinearAds><NonLinear width="600" height="90">' +
  '<StaticResource creativeType="image/png"><![CDATA[' + superImage + ']]></StaticResource>' +
  '</NonLinear></NonLinearAds></Creative></Creatives></InLine></Ad></VAST>';
// How far past a window's edge (in content) the graphic may still be seen: two frames at 25 fps.
const EDGE = 0.09;

const plan = () => ({
  version: 1, asset_id: 'asset-1', duration: 30, page_url: 'https://publisher.example/page',
  expires_at: new Date(Date.now() + 3600000).toISOString(),
  timeline: { kind: 'stitched', pdt_origin: '2000-01-01T00:00:00.000Z', breaks: [0, 14] }, cuts: [],
  scenes: {
    formats: ['super'],
    pacing: { min_seconds: 1.5, max_seconds: null, gap_after_seconds: 0, max_per_video: null, cut_clearance_seconds: 0 },
    graphics: [{ format: 'super', tag_url: 'https://pubads.g.doubleclick.net/gampad/ads?iu=/123/site/super&sz=600x90' }],
    // Content 10–20 s straddles the mid-roll: stream 14–18 and 22–28.
    windows: [{ id: 'w', start_ms: 10000, end_ms: 20000 }],
  },
});

function picture({ r, g, b, bands }) {
  if (r > 150 && g < 90 && b < 90) return { ad: true };
  let code = 0;
  for (const [k, [br, bg, bb]] of bands.entries()) {
    if (Math.max(br, bg, bb) - Math.min(br, bg, bb) > 40) return {};
    if (br > 170) code += 2 ** k;
    else if (br > 70) return {};
  }
  return code >= 1 && code <= 15 ? { segment: code - 1 } : {};
}

async function open(page, timeline = plan().timeline) {
  const seen = { gampad: 0, ima: 0, impressions: 0 };
  await page.route('**/ima3.js', route => {
    seen.ima++;
    return route.abort();
  });
  await page.route('**/gampad/ads**', route => {
    seen.gampad++;
    return route.fulfill({ contentType: 'application/xml', body: vast, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.route('https://ads-images.test/**', route => {
    if (route.request().url().endsWith('/impression')) seen.impressions++;
    return route.fulfill({ contentType: 'image/png', body: png });
  });
  const config = { src: '/fixtures/stitched/master.m3u8', type: 'hls', locale: 'en',
    embed: { playback: { muted: true } }, ads: { plan: { ...plan(), timeline } } };
  await page.goto('/embed?config=' + encodeURIComponent(JSON.stringify(config)));
  await page.locator('video').evaluate((video) => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 9;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const samples = window.samples = [];
    let seekedAt = -Infinity;
    video.addEventListener('seeked', () => { seekedAt = performance.now(); });
    const image = () => [...document.querySelectorAll('.il-player img')].filter((img) => img.src.startsWith('https://ads-images.test/super'));
    window.sample = () => {
      context.drawImage(video, 0, 0, 16, 9);
      const data = context.getImageData(0, 0, 16, 9).data;
      const at = (x, y) => [...data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 3)];
      const [r, g, b] = at(8, 4);
      samples.push({ t: video.currentTime, r, g, b, bands: [2, 6, 10, 14].map((x) => at(x, 4)), images: image().length,
        graphic: image().some((img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width > 0 &&
          img.checkVisibility({ opacityProperty: true, visibilityProperty: true })),
        seeking: video.seeking, sinceSeek: performance.now() - seekedAt });
    };
    const frame = () => {
      window.sample();
      video.requestVideoFrameCallback(frame);
    };
    video.requestVideoFrameCallback(frame);
  });
  return seen;
}

function judge(samples) {
  let ad = 0;
  const shown = new Set();
  for (const s of samples) {
    const p = picture(s);
    expect(s.images, `one graphic at most at ${s.t}`).toBeLessThanOrEqual(1);
    if (p.ad) {
      ad++;
      expect(s.graphic, `graphic over an ad frame at ${s.t}`).toBe(false);
    } else if (s.graphic && p.segment != null && !s.seeking && s.sinceSeek > 250) {
      // Window content 10–20 s: segments 5 to 9; the content second at the frame is 2 × segment + its offset.
      const content = 2 * p.segment;
      expect(content, `graphic at ${s.t} over content segment ${p.segment}`).toBeGreaterThanOrEqual(10 - 2);
      expect(content, `graphic at ${s.t} over content segment ${p.segment}`).toBeLessThanOrEqual(20);
      if (p.segment === 10) expect(s.t - 28, `graphic at ${s.t} past the window`).toBeLessThan(EDGE);
      if (p.segment === 4) expect(14 - s.t, `graphic at ${s.t} before the window`).toBeLessThan(EDGE);
      shown.add(p.segment);
    }
  }
  return { ad, shown };
}

const play = (page) => page.getByRole('button', { name: 'Play', exact: true }).first().click();
const until = (page, t) => expect.poll(() => page.locator('video').evaluate((video) => video.currentTime),
  { timeout: 60000, intervals: [100] }).toBeGreaterThanOrEqual(t);

test('a stitched stream on hls.js: graphics follow content time, never over an ad, one request', async ({ page }) => {
  test.setTimeout(120000);
  const seen = await open(page);
  await play(page);
  await until(page, 37.5);
  const result = judge(await page.evaluate(() => window.samples));
  expect(result.ad).toBeGreaterThan(120);
  expect([...result.shown].some((segment) => segment < 7)).toBe(true);
  expect([...result.shown].some((segment) => segment >= 7)).toBe(true);
  // MediaTailor's ads are in the stream: ILPlayer never loads IMA nor asks for a video break.
  expect(seen).toEqual({ gampad: 1, ima: 0, impressions: 1 });
  await expect(page.locator('.il-player--ad-break')).toHaveCount(0);
});

test('a stitched stream opened in the middle of an ad, then seeks and a replay: nothing misplaced or repeated', async ({ page }) => {
  test.setTimeout(120000);
  const seen = await open(page);
  const video = page.locator('video');
  await video.evaluate((element) => { element.currentTime = 19; });
  await play(page);
  await until(page, 25);
  await expect.poll(() => page.evaluate(() => window.samples.at(-1).graphic)).toBe(true);
  await video.evaluate((element) => { element.currentTime = 1; });
  await until(page, 5);
  await video.evaluate((element) => { element.currentTime = 30; });
  await until(page, 32);
  await video.evaluate((element) => { element.currentTime = 0; });
  await expect.poll(() => video.evaluate((element) => element.currentTime < 5)).toBe(true);
  await until(page, 27);
  const result = judge(await page.evaluate(() => window.samples));
  expect(result.ad).toBeGreaterThan(60);
  expect(result.shown.size).toBeGreaterThan(0);
  expect(seen).toEqual({ gampad: 1, ima: 0, impressions: 1 });
});

test('a malformed stitched timeline plays the video with no ads drawn and no error', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const seen = await open(page, { kind: 'stitched', pdt_origin: 'not a date', breaks: [0, 14] });
  await play(page);
  await until(page, 16);
  const samples = await page.evaluate(() => window.samples);
  expect(samples.some((s) => s.graphic)).toBe(false);
  expect(errors).toEqual([]);
  expect(seen.gampad).toBe(0);
  await expect(page.locator('.il-player__error')).toBeHidden();
});
