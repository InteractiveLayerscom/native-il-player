const fixtureOrigin = Date.parse('2026-01-01T12:00:00Z');
const cues = [
  {
    language: 'es', label: 'Español',
    cues: [
      { start: 0.5, end: 4.8, text: 'La primera luz alcanza la cordillera.' },
      { start: 6.4, end: 10.8, text: 'La niebla se desplaza sobre el agua.' },
      { start: 12.4, end: 17.7, text: 'El valle despierta bajo el sol.' },
    ],
  },
  {
    language: 'en', label: 'English',
    cues: [
      { start: 0.5, end: 4.8, text: 'The first light reaches the mountains.' },
      { start: 6.4, end: 10.8, text: 'Mist drifts over the water.' },
      { start: 12.4, end: 17.7, text: 'The valley wakes under the sun.' },
    ],
  },
  {
    language: 'pt-BR', label: 'Português (Brasil)',
    cues: [
      { start: 0.5, end: 4.8, text: 'A primeira luz alcança as montanhas.' },
      { start: 6.4, end: 10.8, text: 'A névoa se move sobre a água.' },
      { start: 12.4, end: 17.7, text: 'O vale desperta sob o sol.' },
    ],
  },
];
const chapters = {
  es: ['La cordillera', 'El río', 'El valle'],
  en: ['The mountains', 'The river', 'The valley'],
  'pt-BR': ['As montanhas', 'O rio', 'O vale'],
};
const adCopy = {
  es: ['PUBLICIDAD CONTEXTUAL', 'Recorré la cordillera', 'Explorá nuevas rutas', 'DEMOSTRACIÓN'],
  en: ['CONTEXTUAL AD', 'Explore the mountains', 'Find your next trail', 'DEMO CREATIVE'],
  'pt-BR': ['PUBLICIDADE CONTEXTUAL', 'Explore as montanhas', 'Encontre novas trilhas', 'DEMONSTRAÇÃO'],
};

export const demoCaptions = cues;
export const demoOriginalLanguage = 'es';
export const demoChapters = locale => chapters[locale].map((title, index) => ({ title, time: index * 6 }));
export const demoAsset = name => new URL('./demo/' + name, import.meta.url);
export const demoClock = video => Math.round(fixtureOrigin + video.currentTime * 1000);

function layer(id, type, x, y, width, height, props) {
  return { id, type, x, y, width, height, ...props };
}

function sceneFor(format, locale, durationMs) {
  const [tag, headline, supporting, badge] = adCopy[locale];
  const t = (id, x, y, width, height, text, fill, size, fontWeight = 500) =>
    layer(id, 'text', x, y, width, height, { text, fill, fontSize: size, fontWeight, fontFamily: 'system-ui, sans-serif' });
  const rect = (id, x, y, width, height, fill, options) =>
    layer(id, 'rect', x, y, width, height, { fill, ...options });
  if (format === 'super') return {
    format, width: 1200, height: 180, durationMs, layers: [
      rect('background', 0, 0, 1200, 180, '#112b30', {
        radius: 18, gradient: { from: '#162942', to: '#165451', angle: 106 },
      }),
      rect('rule', 0, 0, 10, 180, '#94efd4'),
      t('tag', 42, 26, 910, 30, tag, '#a4eedc', 23, 650),
      t('headline', 42, 63, 1070, 110, headline, '#ffffff', 55, 700),
    ],
  };
  return {
    format, width: 1280, height: 720, durationMs, layers: [
      rect('background', 0, 0, 1280, 720, '#112b30', {
        gradient: { from: '#172845', to: '#145957', angle: 108 },
      }),
      rect('divider', 0, 540, 1280, 3, '#94efd4'),
      rect('side-divider', 960, 0, 3, 540, '#94efd4'),
      t('side-tag', 992, 38, 255, 50, badge, '#a4eedc', 20, 700),
      layer('sun', 'ellipse', 1049, 127, 152, 152, { fill: '#aff1d6' }),
      layer('ridge', 'line', 1018, 263, 225, 64, { rotation: -20, stroke: '#65b8a9', strokeWidth: 6 }),
      layer('ridge-accent', 'line', 1035, 294, 152, 55, { rotation: -20, stroke: '#b9f8e5', strokeWidth: 3 }),
      t('side-copy', 992, 378, 270, 155, supporting, '#e5faf4', 31, 650),
      t('tag', 32, 560, 1180, 31, tag, '#a4eedc', 20, 700),
      t('headline', 32, 587, 1180, 116, headline, '#ffffff', 47, 700),
    ],
  };
}

export function demoFeed(format, getLocale) {
  const windows = { super: [3300, 9100], l: [7200, 13200] };
  let override;
  let currentFormat = format;
  let sequence = 0;
  return {
    fetch: async () => {
      const range = Object.hasOwn(windows, currentFormat) ? windows[currentFormat] : null;
      const scheduled = range && {
        id: 'demo-' + currentFormat, format: currentFormat,
        start: fixtureOrigin + range[0], end: fixtureOrigin + range[1],
      };
      const cue = override ?? scheduled;
      if (!cue) return new Response('[]');
      const scene = sceneFor(cue.format, getLocale(), cue.end - cue.start);
      const image = demoAsset(cue.format + '.png');
      return new Response(JSON.stringify([{
        ...cue, scene,
        // A still is available on HTTPS for renderers without scene support.
        ...(image.protocol === 'https:' ? { imageUrl: image.href, mimeType: 'image/png' } : {}),
      }]));
    },
    configure(value) {
      currentFormat = value;
      override = null;
    },
    trigger(value, time) {
      override = { id: 'demo-user-' + ++sequence, format: value, start: time - 100, end: time + 4800 };
    },
  };
}
