import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { makeStitched } from './stitched-fixture.mjs';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.css': 'text/css', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t',
};
const files = resolve('dist');
const fixtures = resolve('test/fixtures');
// A stream with ads stitched in as MediaTailor does it, made with ffmpeg on first use (see stitched-fixture.mjs).
makeStitched(resolve(fixtures, 'stitched'));

function serve(path, req, res) {
  try {
    const { size } = statSync(path);
    const type = types[extname(path)];
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end) return res.writeHead(416, { 'Content-Range': 'bytes */' + size }).end();
    const headers = { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' };
    if (match) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    res.writeHead(match ? 206 : 200, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(path, { start, end }).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}

// The Content-Security-Policy of the page the Console hosts (`_player_page` in backend/api/workspace_il_player.py),
// with the player's files on the page's own origin, so a style or request the hosted page blocks fails here too.
// Applied to pages with an ad plan only: without a plan the hosted policy has no `blob:` in media-src, which
// blocks HLS through Media Source (reported to the Console; the plan-less tests keep their current server).
const googleScripts = ['https://imasdk.googleapis.com', 'https://securepubads.g.doubleclick.net',
  'https://pagead2.googlesyndication.com', 'https://tpc.googlesyndication.com'];
function hostedPolicy(config) {
  const ads = config?.ads && typeof config.ads === 'object' && 'plan' in config.ads;
  if (!ads) return null;
  const scripts = ' ' + googleScripts.join(' ');
  return [
    "default-src 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
    "frame-ancestors 'self' https://publisher.test",
    `script-src 'self' 'nonce-test'${scripts}`, "style-src 'self' 'nonce-test'",
    "media-src 'self' https: blob:", "img-src 'self' data: https:", "connect-src 'self' https:",
    'frame-src https:', "style-src-attr 'unsafe-inline'",
  ].join('; ');
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/embed') {
    const config = JSON.parse(url.searchParams.get('config') ?? '{}');
    const json = JSON.stringify(config).replaceAll('<', '\\u003c');
    const html = '<!doctype html><meta charset=utf-8><link rel=stylesheet href=/native-il-player.css>' +
      '<div id=il-player></div><script id=il-player-config type=application/json>' + json +
      '</script><script type=module src=/native-il-player.js></script>';
    const policy = hostedPolicy(config);
    return res.writeHead(200, { 'Content-Type': types['.html'], ...(policy ? { 'Content-Security-Policy': policy } : {}) }).end(html);
  }
  if (url.pathname === '/host') {
    return res.writeHead(200, { 'Content-Type': types['.html'] }).end('<!doctype html><body></body>');
  }
  const isFixture = url.pathname.startsWith('/fixtures/');
  const root = isFixture ? fixtures : files;
  const path = resolve(root, '.' + (isFixture ? url.pathname.slice('/fixtures'.length) : url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(root + sep)) return res.writeHead(404).end();
  serve(path, req, res);
}).listen(Number(process.argv[2]), '127.0.0.1');
