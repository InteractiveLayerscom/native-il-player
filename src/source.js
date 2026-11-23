import Hls from 'hls.js';

export function httpUrl(input, base) {
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    const url = new URL(input, base);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {}
  return null;
}

export function isHlsSource(url, type) {
  return !!url && (type === 'hls' || (type !== 'mp4' && /\.m3u8$/i.test(url.pathname)));
}

export function loadSource(video, url, hlsSource, { onError, onManifest, onChoices, preferNative }) {
  let engine;
  if (!url) onError();
  else if (!hlsSource) video.src = url.href;
  else if (preferNative && video.canPlayType('application/vnd.apple.mpegurl')) video.src = url.href;
  else if (Hls.isSupported()) {
    engine = new Hls();
    let recovered = false;
    engine.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
        recovered = true;
        engine.recoverMediaError();
      } else {
        engine.stopLoad();
        onError();
      }
    });
    if (onManifest) engine.on(Hls.Events.LEVEL_LOADED, (_, data) => {
      const text = data.networkDetails?.responseText;
      if (typeof text === 'string') onManifest(text);
    });
    for (const event of [Hls.Events.MANIFEST_PARSED, Hls.Events.LEVELS_UPDATED, Hls.Events.LEVEL_SWITCHED,
      Hls.Events.AUDIO_TRACKS_UPDATED, Hls.Events.AUDIO_TRACK_SWITCHED]) engine.on(event, onChoices);
    engine.loadSource(url.href);
    engine.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url.href;
  } else onError();
  const nativeAudio = !engine ? video.audioTracks : null;
  const trackEvents = ['addtrack', 'removetrack', 'change'];
  for (const event of trackEvents) nativeAudio?.addEventListener(event, onChoices);
  const audio = () => Array.from(engine?.audioTracks ?? nativeAudio ?? []);
  return {
    direct: !!url && !engine,
    // The hls.js instance, when it plays the source (the content clock reads its fragments).
    hls: engine ?? null,
    qualities() {
      const levels = engine?.levels ?? [];
      return levels.map((level, value) => {
        const resolution = level.height ? level.height + 'p' : '';
        const duplicate = level.height && levels.some((other, index) => index !== value && other.height === level.height);
        const bitrate = Math.round(level.bitrate / 1000) + ' kbps';
        return { value, label: resolution && duplicate ? resolution + ' · ' + bitrate : resolution || bitrate };
      });
    },
    activeQuality() { return engine?.manualLevel ?? -1; },
    setQuality(value) {
      if (engine && Number.isInteger(value) && value >= -1 && value < engine.levels.length) engine.currentLevel = value;
    },
    audioChoices() {
      return audio().map((track, value) => ({ value, label: track.name || track.label || track.lang || track.language }));
    },
    activeAudio() { return engine ? engine.audioTrack : audio().findIndex(track => track.enabled); },
    setAudio(value) {
      if (!Number.isInteger(value) || value < 0 || value >= audio().length) return;
      if (engine) engine.audioTrack = value;
      else audio().forEach((track, index) => { track.enabled = index === value; });
    },
    programTime(origin) {
      const hlsTime = engine?.playingDate?.getTime();
      if (Number.isFinite(hlsTime)) return Math.round(hlsTime);
      const nativeTime = video.getStartDate?.()?.getTime();
      const epoch = Number.isFinite(nativeTime) ? nativeTime : origin;
      return Number.isSafeInteger(epoch) ? Math.round(epoch + video.currentTime * 1000) : null;
    },
    destroy() {
      for (const event of trackEvents) nativeAudio?.removeEventListener(event, onChoices);
      engine?.destroy();
      video.removeAttribute('src');
      video.load();
    },
  };
}
