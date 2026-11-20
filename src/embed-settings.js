import { httpUrl } from './source.js';

const placements = new Set(['both', 'center', 'bar', 'hidden']);
const rasterPrefix = /^data:image\/(png|jpeg|webp);base64,/;
const maximumRasterLength = 1024 * 1024;

function raster(input) {
  if (typeof input !== 'string' || input.length > maximumRasterLength) return null;
  const match = rasterPrefix.exec(input);
  if (!match) return null;
  const data = input.slice(match[0].length);
  if (data.length < 16 || data.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(data)) return null;
  try {
    const signature = atob(data.slice(0, 16));
    if (match[1] === 'png' && signature.startsWith('\x89PNG\r\n\x1a\n')) return input;
    if (match[1] === 'jpeg' && signature.startsWith('\xff\xd8\xff')) return input;
    if (match[1] === 'webp' && signature.startsWith('RIFF') && signature.slice(8) === 'WEBP') return input;
  } catch {}
  return null;
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export function initialEmbed(demoLoop) {
  return {
    branding: { logo: null, show_wordmark: false },
    details: { show_title: false, show_byline: false, show_avatar: false, byline: '', avatar: null },
    engagement: { like: false, watch_later: false, share: false, embed_code: false, highlights: false },
    controls: {
      play: 'both', progress: true, volume: true, captions: true, transcript: false,
      quality: false, speed: true, audio_tracks: false, chapters: true,
      cast: false, airplay: false, pip: false, fullscreen: true,
    },
    playback: { autoplay: false, muted: false, loop: demoLoop, allow_seeking: true, context_menu: true },
  };
}

export function mergeEmbed(previous, patch) {
  const result = { ...previous };
  for (const [name, group] of Object.entries(previous)) {
    const incoming = patch?.[name];
    if (!incoming || typeof incoming !== 'object') continue;
    const target = { ...group };
    for (const key of Object.keys(group)) {
      const value = incoming[key];
      if (value === group[key]) continue;
      if (typeof group[key] === 'boolean' && typeof value === 'boolean') target[key] = value;
      if (key === 'play' && placements.has(value)) target[key] = value;
      if (key === 'byline' && typeof value === 'string') target[key] = text(value, 200);
      if ((key === 'logo' || key === 'avatar') && (typeof value === 'string' || value === null)) target[key] = raster(value);
    }
    result[name] = target;
  }
  return result;
}

export function embedMetadata(data, base, demo) {
  return {
    id: text(data?.id, 256) || (demo ? 'native-il-player-demo' : ''),
    title: text(data?.title, 300),
    shareUrl: typeof data?.share_url === 'string' && data.share_url.length <= 2048
      ? httpUrl(data.share_url, base)?.href ?? '' : '',
    embedHtml: typeof data?.embed_html === 'string' && data.embed_html.length <= 16384 && data.embed_html.trim()
      ? data.embed_html : '',
  };
}
