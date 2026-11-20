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
  await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    for (const format of ['super', 'l']) {
      const action = document.createElement('button');
      action.textContent = 'Simulate ' + format;
      action.onclick = () => frame.contentWindow.postMessage({ type: 'il-player:simulate', format }, location.origin);
      document.body.append(action);
    }
  });
  await page.getByRole('button', { name: 'Simulate super', exact: true }).click();
  await expect(player.locator('.il-scene')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.previewEvents))
    .toContainEqual({ type: 'il-player:demo-started', format: 'super' });
  expect(await video.evaluate(element => element.style.width)).toBe('');
  await page.getByRole('button', { name: 'Simulate l', exact: true }).click();
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

const samplePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const program = '/demo/program.mp4';
const preparedCaptions = [{ language: 'en', label: 'English', cues: [
  { start: 1, end: 4, text: 'The first rays reach the mountains.' },
  { start: 10, end: 13, text: 'Fog drifts across the river.' },
] }];

test('renders configured branding, video details, play placement and primary color', async ({ page }) => {
  await page.goto(embed({
    src: program, locale: 'en', colors: { primary: '#272536' },
    metadata: { title: 'Andes at dawn' },
    embed: {
      branding: { logo: samplePng, show_wordmark: true },
      details: { show_title: true, show_avatar: true, avatar: samplePng, show_byline: true, byline: 'Sierra Studio' },
      controls: { play: 'bar', progress: false, volume: false, speed: false },
    },
  }));
  await expect(page.getByText('ILPlayer', { exact: true })).toBeVisible();
  await expect(page.getByText('Andes at dawn', { exact: true })).toBeVisible();
  await expect(page.getByText('Sierra Studio', { exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.il-player__top img').evaluateAll(images =>
    images.filter(image => image.complete && image.naturalWidth > 0).length)).toBe(2);
  await expect(page.locator('.il-player__toolbar')).toHaveCSS('background-color', 'rgb(39, 37, 54)');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(1);
  await expect(page.locator('.il-player__center')).toBeHidden();
  await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mute', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Playback speed' })).toHaveCount(0);
});

test('updates an uploaded-video preview without replacing the video element or playhead', async ({ page }) => {
  const player = await loadPreview(page, {
    demo: false, preview: true, src: program, restrict_remote_playback: true,
    captions: [{ ...preparedCaptions[0], language: 'und', label: 'Original' }],
    features: { transcription_enabled: true },
  });
  await expect.poll(() => page.evaluate(() => window.previewEvents))
    .toContainEqual({ type: 'il-player:ready' });
  const video = player.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await video.evaluate(media => { media.currentTime = 6; media.dataset.original = 'true'; });
  await message(page, {
    type: 'il-player:appearance', colors: { primary: '#182b33' },
    embed: {
      controls: { play: 'center', volume: false, cast: true, airplay: true, transcript: true },
      playback: { muted: true }, engagement: { share: true, embed_code: true },
    },
    features: { transcription_enabled: true, chapters_enabled: false },
  });
  await expect(player.locator('.il-player__toolbar')).toHaveCSS('background-color', 'rgb(24, 43, 51)');
  await expect(player.getByRole('button', { name: 'Play', exact: true })).toHaveCount(1);
  await expect(player.getByRole('button', { name: 'Mute', exact: true })).toHaveCount(0);
  await expect(player.getByRole('button', { name: 'Playback options' })).toHaveCount(0);
  await expect(video).toHaveAttribute('data-original', 'true');
  await expect(video).toHaveAttribute('disableremoteplayback', '');
  await expect(video).toHaveAttribute('x-webkit-airplay', 'deny');
  await expect(video).toHaveJSProperty('muted', true);
  await expect.poll(() => video.evaluate(media => media.currentTime)).toBeCloseTo(6, 2);
  const share = player.getByRole('button', { name: 'Share', exact: true });
  await expect(share).toBeVisible();
  await expect(share).toBeDisabled();
  await expect(share).toHaveAttribute('title', 'A share link is required.');
  await expect(player.getByRole('button', { name: 'Copy embed code', exact: true })).toBeDisabled();
  await player.getByRole('button', { name: 'Captions', exact: true }).click();
  await player.getByRole('button', { name: 'Original', exact: true }).click();
  await expect.poll(() => video.evaluate(media => Array.from(media.textTracks).find(track => track.mode === 'showing')?.language))
    .toBe('und');
  await player.getByRole('button', { name: 'Transcript', exact: true }).click();
  await expect(player.getByRole('region', { name: 'Transcript' })).toContainText('Fog drifts across the river.');
});

test('shows actual transcript and highlights, then seeks to the selected cue or chapter', async ({ page }) => {
  await page.goto(embed({
    src: program, locale: 'en', captions: preparedCaptions, chapters: [{ time: 12, title: 'The valley' }],
    embed: { controls: { transcript: true }, engagement: { highlights: true } },
  }));
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4);
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  await page.getByRole('button', { name: /Fog drifts across the river/ }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeCloseTo(10, 2);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Highlights', exact: true }).click();
  await page.getByRole('region', { name: 'Highlights' }).getByRole('button', { name: /The valley/ }).click();
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeCloseTo(12, 2);
});

test('applies autoplay, mute, loop, seek lock and context menu policy', async ({ page }) => {
  await page.goto(embed({
    src: program, locale: 'en', captions: preparedCaptions, chapters: [{ time: 12, title: 'The valley' }],
    embed: {
      controls: { play: 'hidden', transcript: true },
      playback: { autoplay: true, muted: true, loop: true, allow_seeking: false, context_menu: false },
    },
  }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('paused', false);
  await expect(video).toHaveJSProperty('muted', true);
  await expect(video).toHaveJSProperty('loop', true);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Playback position' })).toBeDisabled();
  await video.evaluate(media => media.pause());
  await page.getByRole('button', { name: 'Chapters', exact: true }).click();
  await expect(page.getByRole('button', { name: /The valley/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  await expect(page.getByRole('button', { name: /Fog drifts/ })).toBeDisabled();
  await expect(video.evaluate(media => media.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true,
  })))).resolves.toBe(false);
});

test('saves likes and a resume position only in the current browser', async ({ page }) => {
  await page.goto(embed({
    src: program, locale: 'en', metadata: { id: 'andine-sample' },
    embed: { engagement: { like: true, watch_later: true } },
  }));
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  await video.evaluate(media => { media.currentTime = 6; });
  await page.getByRole('button', { name: 'Like', exact: true }).click();
  await page.getByRole('button', { name: 'Watch later', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved on this browser');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Like', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Watch later', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => video.evaluate(media => media.currentTime)).toBeCloseTo(6, 2);
});

test('copies only the supplied share and embed metadata', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const shareUrl = 'https://publisher.example/video/andes';
  const html = '<iframe title="Andes" src="https://publisher.example/embed/andes"></iframe>';
  await page.goto(embed({
    src: program, locale: 'en', metadata: { share_url: shareUrl, embed_html: html },
    embed: { engagement: { share: true, embed_code: true } },
  }));
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Share' }).getByRole('textbox')).toHaveValue(shareUrl);
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
  await page.getByRole('button', { name: 'Copy embed code', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(html);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.goto(embed({
    src: program, locale: 'en', metadata: { share_url: 'ftp://publisher.example/andre' },
    embed: { engagement: { share: true, embed_code: true } },
  }));
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy embed code', exact: true })).toHaveCount(0);
});

test('shows only actual quality and audio choices offered by a rendition', async ({ page }) => {
  await page.goto(embed({
    src: '/fixtures/hls/master-options.m3u8', locale: 'en',
    embed: { controls: { quality: true, audio_tracks: true } },
  }));
  await page.getByRole('button', { name: 'Playback options', exact: true }).click();
  const quality = page.getByRole('combobox', { name: 'Quality', exact: true });
  await expect(quality.locator('option')).toHaveText(['Auto', '270p', '540p']);
  await quality.selectOption({ label: '270p' });
  await expect(quality).toHaveValue('0');
  const audio = page.getByRole('combobox', { name: 'Audio track', exact: true });
  await expect(audio.locator('option')).toHaveText(['English', 'Español']);
  const switched = page.waitForRequest('**/audio-options.m3u8?language=es');
  await audio.selectOption({ label: 'Español' });
  await switched;
  await page.goto(embed({
    src: program, locale: 'en', embed: { controls: { quality: true, audio_tracks: true } },
  }));
  await expect(page.locator('video')).toHaveJSProperty('readyState', 4);
  await expect(page.getByRole('button', { name: 'Playback options', exact: true })).toHaveCount(0);
});

test('reports blocked browser storage and ignores branding outside the allowed raster formats', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.goto(embed({
    src: program, locale: 'en', metadata: { id: 'blocked-storage' },
    embed: {
      branding: { logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' },
      details: { show_avatar: true, avatar: 'data:image/png;base64,ZmFrZSBpbWFnZSBkYXRh' },
      engagement: { watch_later: true },
    },
  }));
  await expect(page.getByRole('img')).toHaveCount(0);
  const later = page.getByRole('button', { name: 'Watch later', exact: true });
  await later.click();
  await expect(later).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status')).toContainText('Browser storage is unavailable');
});

test('shows remote playback only after receiver detection and honors hard publisher restrictions', async ({ page }) => {
  await page.addInitScript(() => {
    window.remoteActions = [];
    const receiver = new EventTarget();
    Object.assign(receiver, {
      state: 'disconnected',
      watchAvailability(onAvailable) {
        window.remoteActions.push('watch');
        queueMicrotask(() => onAvailable(true));
        return Promise.resolve(1);
      },
      cancelWatchAvailability() { return Promise.resolve(); },
      prompt() { window.remoteActions.push('prompt'); return Promise.resolve(); },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'remote', { get() { return receiver; } });
  });
  const config = { src: program, locale: 'en', embed: { controls: { cast: true } } };
  await page.goto(embed(config));
  await page.getByRole('button', { name: 'Playback options', exact: true }).click();
  await page.getByRole('button', { name: 'Cast', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.remoteActions)).toEqual(['watch', 'prompt']);

  await page.goto(embed({ ...config, restrict_remote_playback: true }));
  await expect(page.locator('video')).toHaveAttribute('disableremoteplayback', '');
  await expect(page.getByRole('button', { name: 'Playback options', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.remoteActions)).toEqual([]);
});
