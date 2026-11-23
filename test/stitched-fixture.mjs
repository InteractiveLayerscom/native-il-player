// A stitched HLS stream as MediaTailor personalizes it, made with ffmpeg for the browser tests.
// Content (30 s): each 2 s segment shows its number plus one in binary as four black or white vertical bands
// (band k white when bit k is set), so a frame tells which content segment is on screen whatever the browser's
// color conversion. Ads (4 s each): flat red. Stream: pre-roll 0–4, content 0–14 at 4–18,
// mid-roll 18–22, content 14–30 at 22–38. Content segments carry the PDT IL writes (pdt_origin + content start)
// and the #EXT-X-ASSET marker MediaTailor keeps; ad segments sit between discontinuities without PDT, wrapped in
// the DATERANGE and CUE-OUT / CUE-OUT-CONT / CUE-IN lines MediaTailor writes when ad markers are on.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ORIGIN = '2000-01-01T00:00:00.000Z';
export const LAYOUT = { preroll: [0, 4], content1: [4, 18], midroll: [18, 22], content2: [22, 38] };

function ffmpeg(dir, args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { cwd: dir });
}

const encode = ['-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.0', '-pix_fmt', 'yuv420p', '-g', '50',
  '-keyint_min', '50', '-sc_threshold', '0', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod'];

export function makeStitched(dir) {
  if (existsSync(join(dir, 'master.m3u8'))) return dir;
  mkdirSync(dir, { recursive: true });
  ffmpeg(dir, ['-f', 'lavfi', '-i', "color=c=black:s=160x90:r=25:d=30,geq=lum='16+219*mod(floor((floor(T/2)+1)/pow(2\\,floor(X/40)))\\,2)':cb=128:cr=128",
    ...encode, '-hls_segment_filename', 'c-%02d.ts', 'content.m3u8']);
  ffmpeg(dir, ['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=25:d=4', ...encode, '-hls_segment_filename', 'a-%02d.ts', 'ad.m3u8']);
  const segments = (name) => {
    const lines = readFileSync(join(dir, name), 'utf8').split('\n');
    const out = [];
    lines.forEach((line, i) => {
      if (line.startsWith('#EXTINF:')) out.push({ extinf: line, uri: lines[i + 1] });
    });
    return out;
  };
  const content = segments('content.m3u8');
  const ad = segments('ad.m3u8');
  const pdt = (seconds) => new Date(Date.parse(ORIGIN) + seconds * 1000).toISOString();
  const out = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-DISCONTINUITY-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  const pod = (id, at) => {
    out.push(`#EXT-X-DATERANGE:ID="${id}",START-DATE="${pdt(at)}",DURATION=4.000`, '#EXT-X-CUE-OUT:4.000');
    ad.forEach((segment, i) => {
      if (i) out.push(`#EXT-X-CUE-OUT-CONT:ElapsedTime=${(2 * i).toFixed(3)},Duration=4.000`);
      out.push(segment.extinf, segment.uri);
    });
    out.push('#EXT-X-CUE-IN');
  };
  let at = 0;
  const play = (from, to, marker) => {
    content.slice(from, to).forEach((segment, i) => {
      out.push('#EXT-X-PROGRAM-DATE-TIME:' + pdt(at));
      if (!i && marker) out.push(`#EXT-X-ASSET:IL_ASSET=asset-1,IL_CUE=${at},IL_BREAK=${marker},IL_POS=midroll`);
      out.push(segment.extinf, segment.uri);
      at += Number.parseFloat(segment.extinf.slice(8));
    });
  };
  pod('pre', -4);
  out.push('#EXT-X-DISCONTINUITY');
  play(0, 7, null);
  out.push('#EXT-X-DISCONTINUITY');
  pod('mid', 14);
  out.push('#EXT-X-DISCONTINUITY');
  play(7, 15, 2);
  out.push('#EXT-X-ENDLIST', '');
  writeFileSync(join(dir, 'v.m3u8'), out.join('\n'));
  writeFileSync(join(dir, 'master.m3u8'),
    '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=160x90,CODECS="avc1.42e01e"\nv.m3u8\n');
  return dir;
}
