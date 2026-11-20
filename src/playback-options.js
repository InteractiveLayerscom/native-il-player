export function createPlaybackOptions({ video, view, menu, node, button, shape, bind, onFailure }) {
  const doc = video.ownerDocument;
  let source;
  let flags;
  let words;
  let linear = false;
  let receiver;
  let castAvailable = false;
  let airPlayAvailable = true;
  let remoteWatch;

  menu.items.classList.add('il-player__playback-options');
  const quality = field(value => source.setQuality(Number(value)));
  const audio = field(value => source.setAudio(Number(value)));
  const pip = action('pip', () => {
    attempt(() => {
      if (doc.pictureInPictureElement === video) return doc.exitPictureInPicture();
      if (doc.pictureInPictureEnabled && video.requestPictureInPicture) return video.requestPictureInPicture();
      video.webkitSetPresentationMode(webKitPip() ? 'inline' : 'picture-in-picture');
    });
  });
  const cast = action('cast', () => attempt(() => receiver.prompt()));
  const airPlay = action('airplay', () => attempt(() => video.webkitShowPlaybackTargetPicker()));

  function field(onSelect) {
    const wrapper = node('label', 'playback-field', menu.items);
    const label = node('span', 'playback-label', wrapper);
    const select = node('select', 'playback-select', wrapper);
    bind(select, 'change', () => {
      onSelect(select.value);
      render();
    });
    return { wrapper, label, select, signature: null };
  }

  function action(glyph, onClick) {
    const control = button(menu.items, 'option il-player__playback-action', onClick);
    const symbol = node('span', 'playback-symbol', control);
    shape(symbol, glyph);
    const text = node('span', 'playback-action-label', control);
    return { control, text };
  }

  function attempt(operation) {
    try {
      void Promise.resolve(operation()).catch(error => {
        if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') onFailure();
      });
    } catch { onFailure(); }
  }

  function webKitPip() {
    return video.webkitPresentationMode === 'picture-in-picture';
  }

  function hasPip() {
    return video.readyState > 0 && Boolean(
      (doc.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') ||
      (video.webkitSupportsPresentationMode?.('picture-in-picture') && typeof video.webkitSetPresentationMode === 'function'),
    );
  }

  function renderField(field, label, choices, selected) {
    field.wrapper.hidden = !choices.length;
    field.label.textContent = label;
    const signature = JSON.stringify(choices);
    if (signature !== field.signature) {
      field.signature = signature;
      field.select.replaceChildren();
      for (const { value, label: title } of choices) {
        const option = node('option', null, field.select);
        option.value = String(value);
        option.textContent = title;
      }
    }
    field.select.value = String(selected);
  }

  function render() {
    if (!flags) return;
    const qualities = flags.quality ? source.qualities() : [];
    const tracks = flags.audio_tracks ? source.audioChoices() : [];
    renderField(quality, words.quality, qualities.length > 1
      ? [{ value: -1, label: words.auto }, ...qualities]
      : [], source.activeQuality());
    renderField(audio, words.audioTrack, tracks.length > 1
      ? tracks.map(choice => ({ ...choice, label: choice.label || words.audioTrack + ' ' + (choice.value + 1) }))
      : [], source.activeAudio());
    pip.text.textContent = words.pip;
    pip.control.hidden = !flags.pip || !hasPip();
    pip.control.setAttribute('aria-pressed', String(doc.pictureInPictureElement === video || webKitPip()));
    cast.text.textContent = words.cast;
    cast.control.hidden = !flags.cast || !receiver || (!castAvailable && receiver.state === 'disconnected');
    airPlay.text.textContent = words.airplay;
    airPlay.control.hidden = !flags.airplay || !source.direct || video.disableRemotePlayback ||
      typeof video.webkitShowPlaybackTargetPicker !== 'function' || !airPlayAvailable;
    menu.wrapper.hidden = linear || [quality.wrapper, audio.wrapper, pip.control, cast.control, airPlay.control]
      .every(control => control.hidden);
  }

  function cancelWatch() {
    const previous = remoteWatch;
    remoteWatch = null;
    castAvailable = false;
    if (previous?.id != null) void receiver.cancelWatchAvailability(previous.id).catch(() => {});
  }

  function updateReceiver() {
    if (!flags.cast || linear || !source.direct || video.disableRemotePlayback ||
        typeof video.webkitShowPlaybackTargetPicker === 'function') {
      cancelWatch();
      receiver = null;
      return;
    }
    if (receiver) return;
    const remote = video.remote;
    if (typeof remote?.prompt !== 'function' || typeof remote.watchAvailability !== 'function') return;
    receiver = remote;
    const watch = {};
    remoteWatch = watch;
    try {
      void remote.watchAvailability(available => {
        if (remoteWatch !== watch) return;
        castAvailable = available;
        render();
      }).then(id => {
        if (remoteWatch === watch) watch.id = id;
        else void remote.cancelWatchAvailability(id).catch(() => {});
      }).catch(() => {});
    } catch {}
  }

  bind(video, 'webkitplaybacktargetavailabilitychanged', event => {
    airPlayAvailable = event.availability === 'available';
    render();
  });
  for (const event of ['enterpictureinpicture', 'leavepictureinpicture', 'webkitpresentationmodechanged']) {
    bind(video, event, render);
  }

  return {
    update(nextSource, nextFlags, nextWords, interruption) {
      source = nextSource;
      flags = nextFlags;
      words = nextWords;
      linear = interruption;
      video.disablePictureInPicture = !flags.pip;
      updateReceiver();
      render();
    },
    destroy() { cancelWatch(); },
  };
}
