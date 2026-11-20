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
