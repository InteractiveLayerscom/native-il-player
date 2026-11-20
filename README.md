# Native ILPlayer

InteractiveLayers' embeddable HTML5 player for MP4 and HLS. The player provides play and pause, seeking, time, volume, caption languages, chapters, playback speed, and fullscreen in a 16:9 stage. It uses the InteractiveLayers SDK to render contextual Super and L creatives over the original video.

## Build and preview

Use Node.js 20.19+ or 22.12+ and npm.

```sh
npm ci
npm run build
npm run preview
```

The preview page plays an original 18-second demonstration with Spanish, English, and Brazilian Portuguese captions, three chapters, and an SDK-rendered Super. It uses assets from the checkout.

For a release, copy the build to an immutable versioned directory and preserve its relative paths. The browser loads these files from that directory.

| Build output | Purpose |
| --- | --- |
| `dist/native-il-player.js` | Self-contained ES module with the player, SDK adapter, and HLS engine |
| `dist/native-il-player.css` | Player and SDK styles |
| `dist/demo/` | Original program, poster, Super and L artwork, and the four-second linear ad |
| `dist/THIRD-PARTY-NOTICES.md` and `dist/licenses/` | Dependency notices and license text |
| `dist/index.html` | Optional standalone demo page |

Allow CORS for ES modules served from a different origin. HLS manifests, renditions, segments, and the playback session feed also need CORS when served from a different origin. A page with a Content Security Policy can allow `worker-src blob:` for the HLS engine's built-in worker and `media-src blob:` for Media Source playback.

## Embed

Load the stylesheet, add the host and configuration, and load the ES module. Give the host the desired width. The player takes its height from the 16:9 aspect ratio.

```html
<link rel="stylesheet" href="/player/v0.2.0/native-il-player.css">
<div id="il-player"></div>
<script type="application/json" id="il-player-config">
{
  "src": "https://media.example.com/series/episode.m3u8",
  "poster": "https://media.example.com/series/episode.jpg",
  "locale": "en",
  "colors": { "primary": "#1c1d21", "accent": "#163bff", "controls": "#ffffff", "background": "#101114" },
  "captions": [
    {
      "language": "en",
      "label": "English",
      "cues": [{ "start": 1, "end": 4.5, "text": "Welcome to the episode." }]
    }
  ],
  "chapters": [{ "time": 0, "title": "Introduction" }, { "time": 30, "title": "Interview" }]
}
</script>
<script type="module" src="/player/v0.2.0/native-il-player.js"></script>
```

When generating the JSON block in HTML, escape `<` as `\u003c`. With an ES module import you can mount into any element, update appearance, and release playback when your view unmounts.

```js
import { mountILPlayer } from '/player/v0.2.0/native-il-player.js';

const player = mountILPlayer('#video-host', {
  src: 'https://media.example.com/series/episode.mp4',
  locale: 'pt-BR',
});
player.updateAppearance({ colors: { accent: '#3c65ff' } });
// When the view unmounts:
player.destroy();
```

`player.video` exposes the program's original `HTMLVideoElement`. Set `type: 'hls'` for a manifest URL whose path does not end in `.m3u8`. MP4 runs through the browser's native video element. HLS uses HLS.js where Media Source Extensions are available, with browser-native HLS as a fallback.

### Appearance and metadata

Choose `locale` from `es`, `en`, and `pt-BR`. The `pt` alias selects Brazilian Portuguese. Color values accept three- or six-digit hex. `primary` sets the controls and menu surfaces, `accent` sets the play buttons and timeline fill, `controls` sets the icon and text color, and `background` sets the video stage. Without a primary color, the player derives the controls surface from the background. Caption and chapter times use media seconds. Menus appear when the corresponding data is supplied. Captions start off and viewers can choose a language.

In fullscreen the player expands the complete stage so the SDK creatives and controls remain visible. Where the browser does not allow element fullscreen, the stage expands within its document or iframe viewport.

### Embed options

`embed` accepts optional groups. Each group can include just the settings you want to override. The program opens with a clean stage until you enable branding, video details, or engagement.

| Group | Settings |
| --- | --- |
| `branding` | `logo` supplies a custom image and `show_wordmark` shows ILPlayer. |
| `details` | `show_title` uses the video title in `metadata`. `show_byline` and `show_avatar` use `byline` and `avatar` in this group. |
| `engagement` | `like`, `watch_later`, `share`, `embed_code`, and `highlights`. |
| `controls` | `play` accepts `both`, `center`, `bar`, or `hidden`. The boolean controls are `progress`, `volume`, `captions`, `transcript`, `quality`, `speed`, `audio_tracks`, `chapters`, `cast`, `airplay`, `pip`, and `fullscreen`. |
| `playback` | `autoplay`, `muted`, `loop`, `allow_seeking`, and `context_menu`. Browser autoplay rules still apply. |

The default player has both play buttons and shows progress, volume, captions, speed, chapters, and fullscreen when available. Additional controls are opt-in. Playback starts on request with sound available. Seeking and the browser context menu are enabled. The standalone sample loops when its embed settings omit `loop`.

Branding images accept base64 PNG, JPEG, or WebP data URLs up to 1 MiB in encoded length. Set the value to `null` to remove an image. Use `metadata.id` to identify the same video across visits. `metadata.title` supplies the optional displayed title. The player uses `metadata.share_url` and `metadata.embed_html` for sharing and copying embed code. Copy actions expose the supplied text for manual selection when browser clipboard access is unavailable.

Likes and Watch later use browser storage for that video on the player's origin. Watch later restores the saved position in a seekable recording when seeking is enabled. The player reports when storage is blocked by the browser or its iframe policies.

The transcript shows the video's configured caption cues. Highlights use chapters when available and sample the submitted caption cues otherwise. These actions are local and use the supplied video metadata. When seeking is disabled, viewers can still read the chapters, transcript, and highlights.

Quality and audio selections appear in Playback options when the source exposes multiple choices. HLS.js supplies rendition quality and audio selections, and supported native browsers can provide alternate audio tracks. PiP appears when the browser allows it. Cast and AirPlay depend on browser and receiver support and a source the browser can play directly. For a protected source that requires the embedding browser's session, pass `restrict_remote_playback: true`. The player disables Remote Playback and AirPlay for that source. Picture-in-picture and remote playback display the video surface. Contextual overlays and custom controls remain in the original player stage.

### Contextual ads

Provide the viewer's playback session values from your backend.

```json
{
  "ads": {
    "eventsUrl": "https://media.example.com/overlays",
    "sessionId": "viewer-playback-session"
  }
}
```

The SDK uses UTC program time in milliseconds for cue timing. HLS uses the rendition's `EXT-X-PROGRAM-DATE-TIME` via HLS.js or the native HLS clock. For an MP4 connected to a synchronous session feed, supply the UTC instant corresponding to media time zero as `programDateTime`, for example `2026-01-01T12:00:00Z`. When the player has no UTC clock, playback continues without timed overlays. HLS.js can also pass in-band InteractiveLayers `EXT-X-DATERANGE` cues to the adapter when there is no session feed. In browsers using native HLS, use the session feed.

The player bundles the SDK's `attachHtmlVideo` adapter from a pinned release revision. [InteractiveLayers Player SDK revision](https://github.com/InteractiveLayerscom/IL-VideoPlayers-SDK/tree/48677cd1c6929c3cb95f7e7f3140f900d1ba23b4).

### Console preview

Use `demo: true` to load the packaged program, poster, caption tracks, and chapters. The `il` and `sdk` preview adapters support scheduled SDK cues via `demoAd: 'super'` or `demoAd: 'l'`. Use `demoAd: 'none'` for program-only playback. The `vast` adapter previews a linear preroll using a separate simulated clip. The demo uses its own timeline and media, with no ad server calls or impression requests.

The preview keeps the original Spanish track when captions are enabled. The selected languages add English and Brazilian Portuguese when those translations are enabled.

An auto-mounted player configured with `demo: true` or `preview: true` in a same-origin iframe sends `{type: 'il-player:ready'}` to the parent. Set `preview: true` for a preview with an uploaded video. Post appearance settings to the frame's `contentWindow` using the page's origin as the target. The player applies the nested `embed` changes in place. An uploaded-video preview can show enabled Share and Embed buttons in a disabled state while their metadata is unavailable.

```js
frame.contentWindow.postMessage({
  type: 'il-player:appearance',
  locale: 'pt-BR',
  colors: { primary: '#29273a', accent: '#ff8243' },
  embed: { controls: { play: 'bar', transcript: true } },
  features: {
    transcription_enabled: true,
    languages: ['pt'],
    chapters_enabled: true,
  },
}, window.location.origin);

frame.contentWindow.postMessage({
  type: 'il-player:simulate', format: 'l',
}, window.location.origin);
```

With `demo: true`, simulation formats are `super`, `l`, and `linear`. The player sends `{type: 'il-player:demo-started', format}` when the SDK creative is visible or the linear clip starts playing. A directly mounted player exposes `player.simulate(format)` for the same demo. A linear simulation during playback pauses the original video and resumes it at the point of interruption.

## Verify and regenerate the demo

```sh
npx playwright install chromium
npm test
```

For a locally installed Google Chrome, run `IL_PLAYER_BROWSER_CHANNEL=chrome npm test`. The tests exercise the built embed with MP4 and HLS playback, actual rendition and language selections, caption and chapter seeking, appearance and live preview updates, local viewer state, metadata copy actions, remote playback configuration, Super and L through the SDK, and a linear break.

With Python 3, Pillow 12, and FFmpeg with libx264, run `python3 scripts/make-demo.py` to regenerate the procedural video, audio, poster and creatives, plus the HLS test rendition. The media and artwork use the generator's own shapes, palettes, and synthesized audio.
