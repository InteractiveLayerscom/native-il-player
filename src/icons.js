const paths = {
  play: ['M8 5v14l11-7z'],
  pause: ['M8 5v14M16 5v14'],
  replay: ['M4.5 10a7.5 7.5 0 1 1 1.6 6.8M4.5 4.5V10H10'],
  sound: ['M4 9v6h4l4 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12'],
  mute: ['M4 9v6h4l4 4V5L8 9H4zM16 10l5 5m0-5-5 5'],
  captions: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM10 10a2.3 2.3 0 1 0 0 4m7-4a2.3 2.3 0 1 0 0 4'],
  chapters: ['M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01'],
  fullscreen: ['M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5'],
  shrink: ['M4 9h5V4m11 5h-5V4M9 20v-5H4m11 5v-5h5'],
  heart: ['M12 20S4 15.5 4 9.5a4 4 0 0 1 8-1.2 4 4 0 0 1 8 1.2c0 6-8 10.5-8 10.5z'],
  bookmark: ['M6 4h12v16l-6-4-6 4z'],
  share: ['M12 15V3m-4 4 4-4 4 4M6 11H4v9h16v-9h-2'],
  code: ['m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14'],
  highlights: ['m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z'],
  transcript: ['M7 4h10m-12 5h14M5 14h14m-14 5h10'],
  close: ['m6 6 12 12m0-12L6 18'],
  settings: ['M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-6 1v4'],
  pip: ['M4 5h16v14H4zM11 11h9v8h-9z'],
  cast: ['M4 6h16v12h-5M4 10a8 8 0 0 1 8 8m-8-4a4 4 0 0 1 4 4m-4 0h.01'],
  airplay: ['M7 16H4V5h16v11h-3m-5-1 5 5H7z'],
};

export function icon(doc, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const data of paths[name]) {
    const path = doc.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', data);
    if (name === 'play') path.setAttribute('fill', 'currentColor');
    else {
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', name === 'pause' ? '2.7' : '1.8');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.append(path);
  }
  return svg;
}
