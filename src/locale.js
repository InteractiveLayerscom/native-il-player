export const copy = {
  en: {
    player: 'Video player', play: 'Play', pause: 'Pause', replay: 'Replay',
    progress: 'Playback position', live: 'Live', mute: 'Mute', unmute: 'Unmute',
    volume: 'Volume', captions: 'Captions', off: 'Off', speed: 'Playback speed',
    chapters: 'Chapters', fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen',
    loadError: 'The video could not be loaded.', playError: 'Playback could not start.',
    linearAd: 'Simulated ad',
  },
  es: {
    player: 'Reproductor de video', play: 'Reproducir', pause: 'Pausar', replay: 'Volver a reproducir',
    progress: 'Posición de reproducción', live: 'En vivo', mute: 'Silenciar', unmute: 'Activar sonido',
    volume: 'Volumen', captions: 'Subtítulos', off: 'Desactivados', speed: 'Velocidad de reproducción',
    chapters: 'Capítulos', fullscreen: 'Pantalla completa', exitFullscreen: 'Salir de pantalla completa',
    loadError: 'No se pudo cargar el video.', playError: 'No se pudo iniciar la reproducción.',
    linearAd: 'Anuncio simulado',
  },
  'pt-BR': {
    player: 'Reprodutor de vídeo', play: 'Reproduzir', pause: 'Pausar', replay: 'Reproduzir novamente',
    progress: 'Posição da reprodução', live: 'Ao vivo', mute: 'Silenciar', unmute: 'Ativar som',
    volume: 'Volume', captions: 'Legendas', off: 'Desativadas', speed: 'Velocidade de reprodução',
    chapters: 'Capítulos', fullscreen: 'Tela cheia', exitFullscreen: 'Sair da tela cheia',
    loadError: 'Não foi possível carregar o vídeo.', playError: 'Não foi possível iniciar a reprodução.',
    linearAd: 'Anúncio simulado',
  },
};

export function normalizeLocale(input) {
  const language = typeof input === 'string' ? input.toLowerCase().split('-')[0] : '';
  if (language === 'pt') return 'pt-BR';
  return language === 'en' ? 'en' : 'es';
}
