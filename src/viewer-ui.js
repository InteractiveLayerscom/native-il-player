import { viewerStorage } from './viewer-storage.js';

export function createViewerUI({ stage, video, view, metadata, emptyActions, node, button, shape, bind, seek, timeLabel, onOpen }) {
  const top = node('div', 'top', stage);
  top.hidden = true;
  const details = node('div', 'identity', top);
  const marks = node('div', 'marks', details);
  const logo = node('img', 'logo', marks);
  const wordmark = node('span', 'wordmark', marks);
  wordmark.textContent = 'ILPlayer';
  const info = node('div', 'identity-info', details);
  const avatar = node('img', 'avatar', info);
  avatar.alt = '';
  const text = node('div', 'video-details', info);
  const title = node('div', 'video-title', text);
  title.textContent = metadata.title;
  const byline = node('div', 'video-byline', text);
  const actions = node('div', 'actions', top);
  const storage = viewerStorage(view, metadata.id);

  const panel = node('section', 'viewer-panel', stage);
  panel.setAttribute('role', 'region');
  panel.hidden = true;
  const header = node('div', 'panel-header', panel);
  const heading = node('h2', 'panel-title', header);
  const closeButton = button(header, 'button', () => close(true));
  shape(closeButton, 'close');
  const body = node('div', 'panel-body', panel);
  const message = node('div', 'viewer-status', stage);
  message.setAttribute('role', 'status');
  message.hidden = true;

  let model;
  let active;
  let bookmarkReady = false;
  let messageTimer;

  const like = button(actions, 'button', () => remember('liked'));
  const later = button(actions, 'button', () => remember('watchAt'));
  const share = button(actions, 'button', () => open('share', share));
  const embedCode = button(actions, 'button', () => {
    if (open('embedCode', embedCode)) void copyText(metadata.embedHtml);
  });
  const highlights = button(actions, 'button', () => open('highlights', highlights));
  for (const [control, name] of [[like, 'heart'], [later, 'bookmark'], [share, 'share'], [embedCode, 'code'], [highlights, 'highlights']]) {
    shape(control, name);
  }

  function label(control, value) {
    control.title = value;
    control.setAttribute('aria-label', value);
  }

  function image(element, value) {
    element.hidden = !value;
    if (value && element.getAttribute('src') !== value) element.src = value;
    if (!value) element.removeAttribute('src');
  }

  for (const element of [logo, avatar]) bind(element, 'error', () => {
    element.hidden = true;
    updateHeader();
  });

  function updateHeader() {
    marks.hidden = logo.hidden && wordmark.hidden;
    info.hidden = avatar.hidden && title.hidden && byline.hidden;
    details.hidden = marks.hidden && info.hidden;
    actions.hidden = Array.from(actions.children).every(control => control.hidden);
    top.hidden = details.hidden && actions.hidden;
  }

  function update(next) {
    model = next;
    const { embed, words, linear } = model;
    const { branding, details: fields, engagement } = embed;
    logo.alt = words.publisherLogo;
    image(logo, linear ? null : branding.logo);
    wordmark.hidden = linear || !branding.show_wordmark;
    image(avatar, !linear && fields.show_avatar ? fields.avatar : null);
    title.hidden = linear || !fields.show_title || !metadata.title;
    byline.textContent = fields.byline;
    byline.hidden = linear || !fields.show_byline || !fields.byline;

    like.hidden = linear || !engagement.like || !storage;
    later.hidden = linear || !engagement.watch_later || !storage;
    share.hidden = linear || !engagement.share || (!emptyActions && !metadata.shareUrl);
    embedCode.hidden = linear || !engagement.embed_code || (!emptyActions && !metadata.embedHtml);
    share.disabled = !metadata.shareUrl;
    embedCode.disabled = !metadata.embedHtml;
    highlights.hidden = linear || !engagement.highlights || !model.highlights.length;
    for (const [control, name] of [[like, 'like'], [later, 'watchLater'], [share, 'share'],
      [embedCode, 'copyEmbed'], [highlights, 'highlights'], [closeButton, 'close']]) label(control, words[name]);
    if (share.disabled) share.title = words.shareRequired;
    if (embedCode.disabled) embedCode.title = words.embedRequired;
    updateSavedControls();
    updateHeader();
  }

  function updateSavedControls() {
    const value = storage?.get();
    like.setAttribute('aria-pressed', String(value?.liked === true));
    later.setAttribute('aria-pressed', String(value?.watchAt != null));
  }

  function announce(value) {
    view.clearTimeout(messageTimer);
    message.hidden = false;
    message.textContent = value;
    messageTimer = view.setTimeout(() => { message.hidden = true; }, 2600);
  }

  function remember(key) {
    const current = storage?.get();
    if (current == null) return announce(model.words.storageUnavailable);
    const value = key === 'liked' ? !current.liked
      : current.watchAt == null ? Math.max(0, video.currentTime || 0) : null;
    if (!storage.set({ [key]: value })) return announce(model.words.storageUnavailable);
    updateSavedControls();
    announce(value === false || value === null ? model.words.removedLocal : model.words.savedLocal);
  }

  function close(restore = false) {
    if (!active) return false;
    const { origin } = active;
    active = null;
    panel.hidden = true;
    origin.setAttribute('aria-expanded', 'false');
    if (restore && !origin.hidden) origin.focus();
    return true;
  }

  async function copyText(value) {
    const { words } = model;
    try {
      await view.navigator.clipboard.writeText(value);
      announce(words.copied);
    } catch {
      body.querySelector('textarea')?.select();
      announce(words.copyManually);
    }
  }

  function copyPanel(value, copyLabel) {
    const input = node('textarea', 'copy-field', body);
    input.readOnly = true;
    input.rows = 2;
    input.value = value;
    input.setAttribute('aria-label', heading.textContent);
    const action = button(body, 'option il-player__copy-action', () => { void copyText(value); });
    action.textContent = copyLabel;
  }

  function momentPanel(rows) {
    const list = node('ol', 'moments', body);
    for (const { time, text } of rows) {
      const item = node('li', 'moment', list);
      const option = node('button', 'option il-player__moment-option', item);
      option.type = 'button';
      option.dataset.seek = String(time);
      option.disabled = !model.embed.playback.allow_seeking;
      const clock = node('span', 'moment-time', option);
      clock.textContent = timeLabel(time);
      const content = node('span', 'moment-text', option);
      content.textContent = text;
    }
  }

  function open(type, origin) {
    if (active?.origin === origin) {
      close(true);
      return false;
    }
    close();
    onOpen();
    active = { origin };
    const { words } = model;
    heading.textContent = words[type];
    panel.setAttribute('aria-label', words[type]);
    origin.setAttribute('aria-expanded', 'true');
    body.replaceChildren();
    if (type === 'share') copyPanel(metadata.shareUrl, words.copyLink);
    else if (type === 'embedCode') copyPanel(metadata.embedHtml, words.copyEmbed);
    else momentPanel(model[type]);
    panel.hidden = false;
    (body.querySelector('button:not([disabled]),textarea') ?? closeButton).focus();
    return true;
  }

  bind(body, 'click', event => {
    const option = event.target.closest('button[data-seek]');
    if (option && !option.disabled) seek(Number(option.dataset.seek));
  });

  bind(view, 'storage', event => {
    if (!event.key || event.key === storage?.key) updateSavedControls();
  });

  function bookmark(force) {
    if (!bookmarkReady || !model?.embed.engagement.watch_later || !model.embed.playback.allow_seeking) return;
    const saved = storage?.get()?.watchAt;
    if (saved == null || !Number.isFinite(video.currentTime)) return;
    const position = video.ended ? 0 : video.currentTime;
    if (force || Math.abs(position - saved) >= 5) storage.set({ watchAt: position });
  }
  bind(video, 'timeupdate', () => bookmark(false));
  bind(video, 'pause', () => bookmark(true));
  bind(video, 'ended', () => bookmark(true));
  bind(view, 'pagehide', () => bookmark(true));

  return {
    update, close,
    openTranscript(origin) { open('transcript', origin); },
    closeOutside(target) {
      if (active && !panel.contains(target) && !active.origin.contains(target)) close();
    },
    restoreBookmark() {
      if (bookmarkReady) return;
      bookmarkReady = true;
      if (!model.embed.engagement.watch_later || !model.embed.playback.allow_seeking) return;
      const position = storage?.get()?.watchAt;
      if (position > 0 && Number.isFinite(video.duration) && position < video.duration - 0.25) seek(position);
    },
    destroy() { view.clearTimeout(messageTimer); },
  };
}
