import { expect, test } from '@playwright/test';

function embed(config) {
  return '/embed?config=' + encodeURIComponent(JSON.stringify(config));
}

async function loadPreview(page, config = {}) {
  await page.goto('/host');
  await page.evaluate(src => {
    const frame = document.createElement('iframe');
    frame.title = 'ILPlayer preview';
    frame.src = src;
    frame.width = 832;
    frame.height = 472;
    window.previewEvents = [];
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.source === frame.contentWindow) window.previewEvents.push(event.data);
    });
    document.body.append(frame);
  }, embed({ demo: true, locale: 'en', ...config }));
  return page.frameLocator('iframe');
}

async function message(page, data) {
  await page.evaluate(value => {
    document.querySelector('iframe').contentWindow.postMessage(value, location.origin);
  }, data);
}

test('loads the original MP4 demo with keyboard controls and no header', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4);
  await expect(page.getByRole('heading')).toHaveCount(0);
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Mute', exact: true }).press('Enter');
  await expect(page.locator('video')).toHaveJSProperty('muted', true);
  await page.getByRole('button', { name: 'Playback speed' }).click();
  await page.getByRole('button', { name: '1.5×', exact: true }).click();
  await expect(page.locator('video')).toHaveJSProperty('playbackRate', 1.5);
  await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
});

test('switches caption language and seeks through the chapter list', async ({ page }) => {
  await page.goto(embed({ demo: true, locale: 'en' }));
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4);
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await page.getByRole('button', { name: 'Português (Brasil)', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate(video =>
    [...video.textTracks].find(track => track.mode === 'showing')?.language
  )).toBe('pt-BR');
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  await page.getByRole('button', { name: /The valley/ }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeCloseTo(12, 1);
});

test('updates iframe preview colors, language, chapters and track availability from its parent', async ({ page }) => {
  const player = await loadPreview(page);
  await expect.poll(() => page.evaluate(() => window.previewEvents))
    .toContainEqual({ type: 'il-player:ready' });
  await expect(player.getByRole('button', { name: 'Chapters', exact: true })).toBeVisible();
  await message(page, {
    type: 'il-player:appearance',
    locale: 'pt',
    colors: { accent: '#ff33aa', controls: '#fcfcfc', background: '#202027' },
    features: { transcription_enabled: true, languages: ['pt'], chapters_enabled: false },
  });
  await expect(player.getByRole('button', { name: 'Capítulos', exact: true })).toHaveCount(0);
  await expect(player.getByRole('button', { name: 'Reproduzir', exact: true }).first())
    .toHaveCSS('background-color', 'rgb(255, 51, 170)');
  await player.getByRole('button', { name: 'Legendas', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Português (Brasil)', exact: true })).toBeVisible();
  await expect(player.getByRole('button', { name: 'English', exact: true })).toHaveCount(0);
  await expect(player.getByRole('button', { name: 'Español', exact: true })).toBeVisible();
  await message(page, { type: 'il-player:appearance', features: { languages: [] } });
  const captions = player.getByRole('button', { name: 'Legendas', exact: true });
  await expect(captions).toHaveAttribute('aria-expanded', 'false');
  await captions.click();
  await expect(player.getByRole('button', { name: 'Español', exact: true })).toBeVisible();
  await expect(player.getByRole('button', { name: 'Português (Brasil)', exact: true })).toHaveCount(0);
  await message(page, { type: 'il-player:appearance', features: { transcription_enabled: false } });
  await expect(player.getByRole('button', { name: 'Legendas', exact: true })).toHaveCount(0);
});

test('renders SDK Super and L cues and returns to the full size of the same video', async ({ page }) => {
  const player = await loadPreview(page, { adapter: 'sdk', demoAd: 'none' });
  const video = player.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await message(page, { type: 'il-player:simulate', format: 'super' });
  await expect(player.locator('.il-scene')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.previewEvents))
    .toContainEqual({ type: 'il-player:demo-started', format: 'super' });
  expect(await video.evaluate(element => element.style.width)).toBe('');
  await message(page, { type: 'il-player:simulate', format: 'l' });
  await expect.poll(() => video.evaluate(element => element.style.width)).toBe('75%');
  await video.evaluate(element => { element.currentTime = 15; });
  await expect.poll(() => video.evaluate(element => element.style.width)).toBe('');
  await expect(player.locator('.il-scene')).toHaveCount(0);
  await expect(video).toHaveCount(1);
});

test('interrupts the demo with a separate linear ad clip and resumes the exact program', async ({ page }) => {
  const player = await loadPreview(page, { adapter: 'vast', demoAd: 'none' });
  const program = player.locator('video').first();
  await expect(program).toHaveJSProperty('readyState', 4);
  // Explicit play runs a preroll first. This test triggers a separate linear break on a playing program.
  await player.getByRole('button', { name: 'Play', exact: true }).first().click();
  await expect(player.locator('video')).toHaveCount(2);
  await expect(player.locator('video')).toHaveCount(1, { timeout: 8000 });
  await program.evaluate(video => { video.currentTime = 6; });
  await expect(program).toHaveJSProperty('paused', false);
  await message(page, { type: 'il-player:simulate', format: 'linear' });
  await expect(player.getByRole('status')).toContainText('Simulated ad');
  await expect(program).toHaveJSProperty('paused', true);
  await expect(player.locator('video').last()).toHaveJSProperty('paused', false);
  await expect.poll(() => page.evaluate(() => window.previewEvents))
    .toContainEqual({ type: 'il-player:demo-started', format: 'linear' });
  const interruption = await program.evaluate(video => video.currentTime);
  await expect(player.locator('video')).toHaveCount(1, { timeout: 8000 });
  await expect(program).toHaveJSProperty('paused', false);
  const resumed = await program.evaluate(video => video.currentTime);
  expect(resumed).toBeGreaterThanOrEqual(interruption);
  expect(resumed - interruption).toBeLessThan(1);
});

test('passes HLS program date time to the SDK session feed', async ({ page }) => {
  await page.route('**/playback-events?**', route => route.fulfill({ json: [] }));
  const requested = page.waitForRequest('**/playback-events?**');
  await page.goto(embed({
    src: '/fixtures/hls/index.m3u8', locale: 'en',
    ads: { eventsUrl: '/playback-events', sessionId: 'playback-001' },
  }));
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const request = new URL((await requested).url());
  expect(request.searchParams.get('sid')).toBe('playback-001');
  expect(Number(request.searchParams.get('time'))).toBeGreaterThanOrEqual(Date.parse('2026-01-01T12:00:00Z'));
  expect(Number(request.searchParams.get('time'))).toBeLessThan(Date.parse('2026-01-01T12:00:05Z'));
});
