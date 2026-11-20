import { attachHtmlVideo } from '@interactivelayers/player-sdk';
import '@interactivelayers/player-sdk/player.css';
import { demoAsset, demoCaptions, demoChapters, demoClock, demoFeed, demoOriginalLanguage } from './demo.js';
import { icon } from './icons.js';
import { copy, normalizeLocale } from './locale.js';
import { httpUrl, isHlsSource, loadSource } from './source.js';
import './player.css';

const defaults = { accent: '#163bff', controls: '#ffffff', background: '#101114' };
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const demoFormats = ['none', 'super', 'l'];
const mediaEvents = ['play', 'playing', 'pause', 'ended', 'timeupdate', 'seeking', 'seeked',
  'durationchange', 'loadedmetadata', 'progress', 'volumechange', 'ratechange'];
const mounted = new WeakMap();
let menuSequence = 0;

function readableTime(seconds) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const rest = String(total % 60).padStart(2, '0');
  return (hours ? hours + ':' + String(minutes).padStart(2, '0') : minutes) + ':' + rest;
}

function playbackRange(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return [0, video.duration];
  const last = video.seekable.length - 1;
  if (last >= 0) return [video.seekable.start(last), video.seekable.end(last)];
  return null;
}

function color(value, previous) {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return previous;
  return value.length === 4 ? '#' + value.slice(1).split('').map(channel => channel + channel).join('') : value;
}

function accentInk(value) {
  const rgb = [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255);
  const linear = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.179 ? '#08090c' : '#ffffff';
}

function safeTracks(video, rows, Cue) {
  if (!Cue || !Array.isArray(rows)) return [];
  return rows.flatMap(row => {
    if (typeof row?.language !== 'string' || !row.language.trim() ||
        typeof row.label !== 'string' || !row.label.trim() || !Array.isArray(row.cues)) return [];
    const cues = row.cues.filter(cue => Number.isFinite(cue?.start) && Number.isFinite(cue?.end) &&
      cue.start >= 0 && cue.end > cue.start && typeof cue.text === 'string');
    if (!cues.length) return [];
    const track = video.addTextTrack('captions', row.label, row.language);
    for (const cue of cues) {
      const escaped = cue.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
      const nativeCue = new Cue(cue.start, cue.end, escaped);
      nativeCue.line = -4;
      track.addCue(nativeCue);
    }
    track.mode = 'disabled';
    return [track];
  });
}

function cleanChapters(rows) {
  return Array.isArray(rows) ? rows.filter(row => Number.isFinite(row?.time) && row.time >= 0 &&
    typeof row.title === 'string' && !!row.title.trim()).sort((a, b) => a.time - b.time) : [];
}

function languageMatch(language, wanted) {
  const normalized = language.toLowerCase();
  return wanted === normalized || (!wanted.includes('-') && normalized.startsWith(wanted + '-')) ||
    (wanted === 'pt-br' && normalized === 'pt');
}

export function mountILPlayer(target, config) {
  return mount(target, config);
}

function mount(target, config = {}, bridge = false) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (host?.nodeType !== 1) throw new TypeError('A player mount element is required');
  mounted.get(host)?.destroy();
  config = config && typeof config === 'object' ? config : {};
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  const lifecycle = new view.AbortController();
  const bind = (node, type, callback) => node.addEventListener(type, callback, { signal: lifecycle.signal });
  const demo = config.demo === true;
  const colors = { ...defaults };
  let locale = normalizeLocale(config.locale);
  let features = config.features ?? {};
  let errorKind = null;
  let theater = false;
  let linearSeen = false;
  let linear = null;
  let openMenu = null;
  let activeTrack = null;
  let tracks = [];
  let chapters = [];
  let disposed = false;

  const node = (tag, css, parent) => {
    const element = doc.createElement(tag);
    if (css) element.className = 'il-player__' + css;
    if (parent) parent.append(element);
    return element;
  };
  const stage = node('div');
  stage.className = 'il-player';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'region');
  host.replaceChildren(stage);

  const video = node('video', 'video', stage);
  video.playsInline = true;
  video.preload = 'metadata';
  video.loop = demo && !config.src;
  const src = httpUrl(config.src ?? (demo ? demoAsset('program.mp4').href : null), doc.baseURI);
  const poster = httpUrl(config.poster ?? (demo ? demoAsset('poster.jpg').href : null), doc.baseURI);
  if (poster) video.poster = poster.href;
  const hls = isHlsSource(src, config.type);

  const textTracks = safeTracks(video, config.captions ?? (demo ? demoCaptions : []), view.VTTCue);
  const configuredChapters = Array.isArray(config.chapters) ? cleanChapters(config.chapters) : null;

  const button = (parent, css, click) => {
    const control = node('button', css, parent);
    control.type = 'button';
    bind(control, 'click', click);
    return control;
  };
  const label = (control, key) => {
    control.setAttribute('aria-label', copy[locale][key]);
    control.title = copy[locale][key];
  };
  const shape = (control, name) => {
    if (control.dataset.icon === name) return;
    control.replaceChildren(icon(doc, name));
    control.dataset.icon = name;
  };
  const range = (parent, css) => {
    const input = node('input', css, parent);
    input.type = 'range';
    return input;
  };

  const center = button(stage, 'center', toggle);
  const adStatus = node('div', 'ad-status', stage);
  adStatus.setAttribute('role', 'status');
  adStatus.hidden = true;
  const error = node('div', 'error', stage);
  error.setAttribute('role', 'status');
  error.hidden = true;

  const toolbar = node('div', 'toolbar', stage);
  const play = button(toolbar, 'button il-player__button--play', toggle);
  const timeline = node('div', 'timeline', toolbar);
  const markers = node('div', 'markers', timeline);
  markers.setAttribute('aria-hidden', 'true');
  const progress = range(timeline, 'range il-player__progress');
  progress.step = '0.01';
  progress.value = '0';
  bind(progress, 'input', () => seek(Number(progress.value)));
  const time = node('span', 'time', toolbar);
  const volumeGroup = node('div', 'volume-group', toolbar);
  const mute = button(volumeGroup, 'button', toggleMute);
  const volume = range(volumeGroup, 'range il-player__volume');
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  bind(volume, 'input', () => {
    video.volume = Number(volume.value);
    video.muted = video.volume === 0;
    if (linear) {
      linear.video.volume = video.volume;
      linear.video.muted = video.muted;
    }
    refresh();
  });

  const captionsMenu = menu('captions', 'captions');
  const chapterMenu = menu('chapters', 'chapters');
  const speedMenu = menu('speed');
  const fullscreen = button(toolbar, 'button', toggleFullscreen);

  function menu(key, glyph) {
    const wrapper = node('div', 'menu-wrap', toolbar);
    const control = button(wrapper, 'button' + (key === 'speed' ? ' il-player__speed' : ''), () => {
      if (openMenu === result) closeMenu();
      else {
        closeMenu();
        items.hidden = false;
        control.setAttribute('aria-expanded', 'true');
        openMenu = result;
        (items.querySelector('[aria-pressed="true"]') ?? items.firstElementChild)?.focus();
      }
    });
    if (glyph) shape(control, glyph);
    const items = node('div', 'menu', wrapper);
    items.setAttribute('role', 'group');
    items.id = 'il-player-menu-' + ++menuSequence;
    items.hidden = true;
    control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-controls', items.id);
    const result = { key, wrapper, control, items };
    return result;
  }

  function closeMenu(focus = false) {
    if (!openMenu) return;
    const { control, items } = openMenu;
    items.hidden = true;
    control.setAttribute('aria-expanded', 'false');
    openMenu = null;
    if (focus) control.focus();
  }

  function fillMenu(menu, options) {
    menu.items.replaceChildren();
    for (const option of options) {
      const item = button(menu.items, 'option', () => {
        option.select();
        closeMenu(true);
      });
      item.textContent = option.label;
      if (option.pressed !== undefined) item.setAttribute('aria-pressed', String(option.pressed));
      if (option.time !== undefined) {
        const clock = node('span', 'chapter-time', item);
        clock.textContent = readableTime(option.time);
      }
    }
  }

  function refreshMenus() {
    const wanted = Array.isArray(features.languages)
      ? features.languages.filter(language => typeof language === 'string').map(language => language.trim().toLowerCase())
      : null;
    tracks = features.transcription_enabled === false ? [] : textTracks.filter(
      track => !wanted || (demo && languageMatch(track.language, demoOriginalLanguage)) ||
      wanted.some(language => languageMatch(track.language, language)),
    );
    chapters = features.chapters_enabled === false ? [] : configuredChapters ?? (demo ? demoChapters(locale) : []);
    if (!tracks.includes(activeTrack)) activeTrack = null;
    updateTrackModes();
    closeMenu();
    rebuildMenus();
  }

  function rebuildMenus() {
    for (const { key, control, items } of [captionsMenu, chapterMenu, speedMenu]) {
      label(control, key);
      items.setAttribute('aria-label', copy[locale][key]);
    }
    captionsMenu.wrapper.hidden = !!linear || !tracks.length;
    chapterMenu.wrapper.hidden = !!linear || !chapters.length;
    speedMenu.wrapper.hidden = !!linear;
    fillMenu(captionsMenu, [null, ...tracks].map(track => ({
      label: track?.label ?? copy[locale].off,
      pressed: activeTrack === track,
      select() {
        activeTrack = track;
        updateTrackModes();
        rebuildMenus();
      },
    })));
    fillMenu(chapterMenu, chapters.map(chapter => ({
      label: chapter.title, time: chapter.time, select: () => seek(chapter.time),
    })));
    fillMenu(speedMenu, speeds.map(rate => ({
      label: rate + '×', pressed: video.playbackRate === rate,
      select() {
        video.playbackRate = rate;
        rebuildMenus();
      },
    })));
    markers.replaceChildren();
    if (Number.isFinite(video.duration) && video.duration > 0) {
      for (const chapter of chapters) {
        if (chapter.time <= 0 || chapter.time >= video.duration) continue;
        const mark = node('span', 'marker', markers);
        mark.style.left = chapter.time / video.duration * 100 + '%';
      }
    }
  }

  function updateTrackModes() {
    for (const track of textTracks) track.mode = !linear && activeTrack === track ? 'showing' : 'disabled';
  }

  function seek(value) {
    const bounds = playbackRange(video);
    if (!bounds || linear || !Number.isFinite(value)) return;
    video.currentTime = Math.min(bounds[1], Math.max(bounds[0], value));
    refresh();
  }

  function toggleMute() {
    const audible = !(linear?.video ?? video).muted && video.volume > 0;
    video.muted = audible;
    if (!audible && video.volume === 0) video.volume = 1;
    if (linear) {
      linear.video.muted = video.muted;
      linear.video.volume = video.volume;
    }
    refresh();
  }

  function isFullscreen() {
    return theater || (doc.fullscreenElement ?? doc.webkitFullscreenElement) === stage;
  }

  async function toggleFullscreen() {
    closeMenu();
    if (theater) theater = false;
    else {
      try {
        if (isFullscreen()) {
          await (doc.exitFullscreen ?? doc.webkitExitFullscreen).call(doc);
        } else {
          const request = stage.requestFullscreen ?? stage.webkitRequestFullscreen;
          if (request) await request.call(stage);
          else theater = true;
        }
      } catch {
        if (!isFullscreen()) theater = true;
      }
    }
    stage.classList.toggle('il-player--theater', theater);
    refresh();
  }

  function refresh() {
    if (disposed) return;
    const media = linear?.video ?? video;
    const playLabel = media.ended ? 'replay' : media.paused ? 'play' : 'pause';
    for (const control of [play, center]) {
      label(control, playLabel);
      shape(control, playLabel);
      control.disabled = !src;
    }
    center.hidden = !media.paused && !media.ended;
    const bounds = playbackRange(media);
    progress.disabled = !!linear || !bounds;
    progress.min = String(bounds?.[0] ?? 0);
    progress.max = String(bounds?.[1] ?? 1);
    progress.value = String(media.currentTime);
    progress.style.setProperty('--il-player-range', (bounds
      ? 100 * Math.max(0, Math.min(1, (media.currentTime - bounds[0]) / (bounds[1] - bounds[0])))
      : 0) + '%');
    progress.setAttribute('aria-valuetext', readableTime(media.currentTime));
    time.textContent = media.duration === Infinity ? copy[locale].live
      : readableTime(media.currentTime) + ' / ' + readableTime(media.duration);

    const silent = media.muted || media.volume === 0;
    label(mute, silent ? 'unmute' : 'mute');
    shape(mute, silent ? 'mute' : 'sound');
    volume.value = String(silent ? 0 : media.volume);
    volume.style.setProperty('--il-player-range', Number(volume.value) * 100 + '%');
    speedMenu.control.textContent = video.playbackRate + '×';
    captionsMenu.control.dataset.active = String(!!activeTrack);
    label(fullscreen, isFullscreen() ? 'exitFullscreen' : 'fullscreen');
    shape(fullscreen, isFullscreen() ? 'shrink' : 'fullscreen');
    error.hidden = !errorKind;
    error.textContent = errorKind ? copy[locale][errorKind] : '';
    adStatus.hidden = !linear;
    adStatus.textContent = linear ? copy[locale].linearAd : '';
  }

  function fail(kind) {
    errorKind = kind;
    refresh();
  }

  function playMedia(media, muteIfBlocked = false) {
    return media.play().catch(playError => {
      if (muteIfBlocked && playError.name === 'NotAllowedError') {
        media.muted = true;
        return media.play();
      }
      throw playError;
    });
  }

  function toggle() {
    const media = linear?.video ?? video;
    if (!media.paused) media.pause();
    else if (demo && config.adapter === 'vast' && !linearSeen) startLinear(true);
    else void playMedia(media).catch(playError => {
      if (!disposed && playError.name !== 'AbortError') fail('playError');
    });
  }

  function startLinear(resume) {
    if (linear || disposed) return;
    linearSeen = true;
    const ad = node('video', 'video il-player__video--linear', stage);
    ad.playsInline = true;
    ad.volume = video.volume;
    ad.muted = video.muted;
    ad.src = demoAsset('linear.mp4').href;
    const listeners = new view.AbortController();
    const listen = (event, callback) => ad.addEventListener(event, callback, { signal: listeners.signal });
    const state = { video: ad, resume, notified: false, listeners };
    linear = state;
    video.pause();
    video.hidden = true;
    closeMenu();
    updateTrackModes();
    rebuildMenus();
    for (const event of mediaEvents) listen(event, refresh);
    listen('ended', finishLinear);
    listen('error', finishLinear);
    listen('playing', () => {
      if (state.notified) return;
      state.notified = true;
      notifyDemo('linear');
    });
    refresh();
    void playMedia(ad, true).catch(() => {
      if (linear === state) finishLinear();
    });
  }

  function releaseLinear() {
    const { video: ad, resume, listeners } = linear;
    linear = null;
    listeners.abort();
    ad.pause();
    ad.remove();
    ad.removeAttribute('src');
    ad.load();
    return resume;
  }

  function finishLinear() {
    if (!linear || disposed) return;
    const resume = releaseLinear();
    video.hidden = false;
    updateTrackModes();
    rebuildMenus();
    refresh();
    if (resume) void playMedia(video, true).catch(playError => {
      if (!disposed && playError.name !== 'AbortError') fail('playError');
    });
  }

  function updateAppearance(patch = {}) {
    if (disposed || !patch || typeof patch !== 'object') return;
    if (typeof patch.locale === 'string') locale = normalizeLocale(patch.locale);
    if (patch.features && typeof patch.features === 'object') features = { ...features, ...patch.features };
    for (const key of Object.keys(colors)) {
      colors[key] = color(patch.colors?.[key], colors[key]);
      stage.style.setProperty('--il-player-' + key, colors[key]);
    }
    stage.style.setProperty('--il-player-accent-ink', accentInk(colors.accent));
    stage.lang = locale;
    stage.setAttribute('aria-label', copy[locale].player);
    label(progress, 'progress');
    label(volume, 'volume');
    if (demoFormats.includes(patch.demoAd)) feed?.configure(patch.demoAd);
    refreshMenus();
    refresh();
  }

  function simulate(format) {
    if (!demo || disposed) return;
    if (format === 'linear') startLinear(!video.paused);
    else if (!linear && (format === 'super' || format === 'l')) {
      if (Number.isFinite(video.duration) && video.currentTime + 5 >= video.duration) seek(0);
      feed.trigger(format, demoClock(video));
      void playMedia(video, true).catch(playError => {
        if (!disposed && playError.name !== 'AbortError') fail('playError');
      });
      sdk.tick();
    }
  }

  const eventsUrl = httpUrl(config.ads?.eventsUrl, doc.baseURI)?.href;
  const sessionId = typeof config.ads?.sessionId === 'string' ? config.ads.sessionId.trim() : '';
  const sdkEvents = !!eventsUrl && !!sessionId;
  const programOrigin = typeof config.programDateTime === 'string' ? Date.parse(config.programDateTime) : null;
  const feed = demo ? demoFeed(config.demoAd, () => locale) : null;
  const parentOrigin = bridge && demo ? sameOriginParent(view) : null;
  function notifyDemo(format) {
    if (parentOrigin) view.parent.postMessage({ type: 'il-player:demo-started', format }, parentOrigin);
    stage.dispatchEvent(new view.CustomEvent('il-player:demo-started', { bubbles: true, detail: { format } }));
  }
  const source = loadSource(video, src, hls, {
    onError: () => fail('loadError'),
    onManifest: !demo && !sdkEvents ? text => sdk?.updateManifest(text) : undefined,
  });
  const sdk = demo || sdkEvents || hls ? attachHtmlVideo({
    video, stage,
    programTime: demo ? () => demoClock(video) : () => source.programTime(programOrigin),
    ...(demo ? {
      eventsUrl: new URL('/il-player-demo-cues', doc.baseURI).href, sessionId: 'native-il-player-demo',
      fetchImpl: feed.fetch, refreshMs: 175, onVisible: cue => notifyDemo(cue.format),
    } : sdkEvents ? { eventsUrl, sessionId } : {}),
  }) : null;

  for (const event of mediaEvents) bind(video, event, refresh);
  bind(video, 'loadedmetadata', rebuildMenus);
  bind(video, 'error', () => fail('loadError'));
  bind(video, 'playing', () => {
    errorKind = null;
    refresh();
  });
  bind(video, 'click', toggle);
  bind(doc, 'fullscreenchange', refresh);
  bind(doc, 'webkitfullscreenchange', refresh);
  bind(doc, 'pointerdown', event => {
    if (openMenu && !openMenu.wrapper.contains(event.target)) closeMenu();
  });
  bind(stage, 'keydown', event => {
    if (event.key === 'Escape' && openMenu) {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Escape' && theater) {
      event.preventDefault();
      void toggleFullscreen();
    } else if (event.target === stage) {
      if (event.key === ' ' || event.key === 'k') toggle();
      else if (event.key === 'ArrowLeft') seek(video.currentTime - 5);
      else if (event.key === 'ArrowRight') seek(video.currentTime + 5);
      else if (event.key === 'm') toggleMute();
      else if (event.key === 'f') void toggleFullscreen();
      else return;
      event.preventDefault();
    }
  });

  if (parentOrigin) bind(view, 'message', event => {
    if (event.origin !== parentOrigin || event.source !== view.parent) return;
    if (event.data?.type === 'il-player:appearance') updateAppearance(event.data);
    if (event.data?.type === 'il-player:simulate') simulate(event.data.format);
  });

  const controller = {
    video, updateAppearance, simulate,
    destroy() {
      if (disposed) return;
      disposed = true;
      lifecycle.abort();
      sdk?.destroy();
      video.pause();
      if (linear) releaseLinear();
      source.destroy();
      stage.remove();
      mounted.delete(host);
    },
  };
  mounted.set(host, controller);
  updateAppearance(config);
  if (parentOrigin) view.parent.postMessage({ type: 'il-player:ready' }, parentOrigin);
  return controller;
}

function sameOriginParent(view) {
  try {
    if (view.parent !== view && view.parent.location.origin === view.location.origin) return view.location.origin;
  } catch {}
  return null;
}

function boot(doc) {
  const host = doc.getElementById('il-player');
  const script = doc.getElementById('il-player-config');
  if (!host || !script || script.getAttribute('type') !== 'application/json' || mounted.has(host)) return;
  let config;
  try { config = JSON.parse(script.textContent); } catch {}
  mount(host, config, true);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(document), { once: true });
  else boot(document);
}
