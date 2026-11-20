export const copy = {
  en: {
    player: 'Video player', play: 'Play', pause: 'Pause', replay: 'Replay',
    progress: 'Playback position', live: 'Live', mute: 'Mute', unmute: 'Unmute',
    volume: 'Volume', captions: 'Captions', off: 'Off', speed: 'Playback speed',
    chapters: 'Chapters', fullscreen: 'Fullscreen', exitFullscreen: 'Exit fullscreen',
    loadError: 'The video could not be loaded.', playError: 'Playback could not start.',
    linearAd: 'Simulated ad',
    publisherLogo: 'Publisher logo', like: 'Like', watchLater: 'Watch later', share: 'Share',
    copyLink: 'Copy link', embedCode: 'Embed code', copyEmbed: 'Copy embed code', highlights: 'Highlights',
    transcript: 'Transcript', close: 'Close', savedLocal: 'Saved on this browser.',
    removedLocal: 'Removed from this browser.', storageUnavailable: 'Browser storage is unavailable.',
    copied: 'Copied.', copyManually: 'Select and copy the text manually.',
    shareRequired: 'A share link is required.', embedRequired: 'Generated embed code is required.',
    options: 'Playback options', quality: 'Quality', auto: 'Auto', audioTrack: 'Audio track',
    pip: 'Picture in picture', cast: 'Cast', airplay: 'AirPlay', optionError: 'This option is unavailable.',
  },
  es: {
    player: 'Reproductor de video', play: 'Reproducir', pause: 'Pausar', replay: 'Volver a reproducir',
    progress: 'Posición de reproducción', live: 'En vivo', mute: 'Silenciar', unmute: 'Activar sonido',
    volume: 'Volumen', captions: 'Subtítulos', off: 'Desactivados', speed: 'Velocidad de reproducción',
    chapters: 'Capítulos', fullscreen: 'Pantalla completa', exitFullscreen: 'Salir de pantalla completa',
    loadError: 'No se pudo cargar el video.', playError: 'No se pudo iniciar la reproducción.',
    linearAd: 'Anuncio simulado',
    publisherLogo: 'Logo del editor', like: 'Me gusta', watchLater: 'Ver más tarde', share: 'Compartir',
    copyLink: 'Copiar enlace', embedCode: 'Código de inserción', copyEmbed: 'Copiar código de inserción',
    highlights: 'Momentos destacados', transcript: 'Transcripción', close: 'Cerrar',
    savedLocal: 'Guardado en este navegador.', removedLocal: 'Eliminado de este navegador.',
    storageUnavailable: 'El almacenamiento del navegador no está disponible.',
    copied: 'Copiado.', copyManually: 'Seleccioná y copiá el texto manualmente.',
    shareRequired: 'Se requiere un enlace para compartir.', embedRequired: 'Se requiere un código de inserción generado.',
    options: 'Opciones de reproducción', quality: 'Calidad', auto: 'Automática', audioTrack: 'Pista de audio',
    pip: 'Imagen en imagen', cast: 'Transmitir', airplay: 'AirPlay', optionError: 'Esta opción no está disponible.',
  },
  'pt-BR': {
    player: 'Reprodutor de vídeo', play: 'Reproduzir', pause: 'Pausar', replay: 'Reproduzir novamente',
    progress: 'Posição da reprodução', live: 'Ao vivo', mute: 'Silenciar', unmute: 'Ativar som',
    volume: 'Volume', captions: 'Legendas', off: 'Desativadas', speed: 'Velocidade de reprodução',
    chapters: 'Capítulos', fullscreen: 'Tela cheia', exitFullscreen: 'Sair da tela cheia',
    loadError: 'Não foi possível carregar o vídeo.', playError: 'Não foi possível iniciar a reprodução.',
    linearAd: 'Anúncio simulado',
    publisherLogo: 'Logotipo do editor', like: 'Curtir', watchLater: 'Assistir mais tarde', share: 'Compartilhar',
    copyLink: 'Copiar link', embedCode: 'Código de incorporação', copyEmbed: 'Copiar código de incorporação',
    highlights: 'Destaques', transcript: 'Transcrição', close: 'Fechar',
    savedLocal: 'Salvo neste navegador.', removedLocal: 'Removido deste navegador.',
    storageUnavailable: 'O armazenamento do navegador não está disponível.',
    copied: 'Copiado.', copyManually: 'Selecione e copie o texto manualmente.',
    shareRequired: 'É necessário um link para compartilhar.', embedRequired: 'É necessário gerar o código de incorporação.',
    options: 'Opções de reprodução', quality: 'Qualidade', auto: 'Automática', audioTrack: 'Faixa de áudio',
    pip: 'Imagem em imagem', cast: 'Transmitir', airplay: 'AirPlay', optionError: 'Esta opção não está disponível.',
  },
};

export function normalizeLocale(input) {
  const language = typeof input === 'string' ? input.toLowerCase().split('-')[0] : '';
  if (language === 'pt') return 'pt-BR';
  return language === 'en' ? 'en' : 'es';
}
