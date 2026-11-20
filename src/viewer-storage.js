const empty = { liked: false, watchAt: null };

export function viewerStorage(view, id) {
  if (!id) return null;
  const key = 'interactivelayers.il-player:v1:' + id;

  function get() {
    let raw;
    try { raw = view.localStorage.getItem(key); } catch { return null; }
    try {
      const stored = raw && JSON.parse(raw);
      if (stored) return {
        liked: stored.liked === true,
        watchAt: Number.isFinite(stored.watchAt) && stored.watchAt >= 0 ? stored.watchAt : null,
      };
    } catch {}
    return { ...empty };
  }

  function set(patch) {
    const previous = get();
    if (previous === null) return false;
    try {
      view.localStorage.setItem(key, JSON.stringify({ ...previous, ...patch }));
      return true;
    } catch { return false; }
  }

  return { key, get, set };
}
