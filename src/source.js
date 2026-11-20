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

export function loadSource(video, url, hlsSource, { onError, onManifest }) {
  let engine;
  if (!url) onError();
  else if (!hlsSource) video.src = url.href;
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
    engine.loadSource(url.href);
    engine.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url.href;
  } else onError();
  return {
    programTime(origin) {
      const hlsTime = engine?.playingDate?.getTime();
      if (Number.isFinite(hlsTime)) return Math.round(hlsTime);
      const nativeTime = video.getStartDate?.()?.getTime();
      const epoch = Number.isFinite(nativeTime) ? nativeTime : origin;
      return Number.isSafeInteger(epoch) ? Math.round(epoch + video.currentTime * 1000) : null;
    },
    destroy() {
      engine?.destroy();
      video.removeAttribute('src');
      video.load();
    },
  };
}
