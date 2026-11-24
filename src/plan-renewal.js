// The embed supplies a signed, same-origin URL. Expiry removes ads before this fetch begins.
export function planRenewal({ url, origin, assetId, fetchImpl = globalThis.fetch, onPlan }) {
  let target, disposed = false, pending = false, retry, abort;
  try {
    target = new URL(url, origin);
    if (!url || target.origin !== origin || target.username || target.password) target = null;
  } catch { target = null; }
  function later(delay) {
    if (!disposed) {
      retry = setTimeout(expired, delay);
      retry.unref?.();
    }
  }
  async function expired() {
    if (disposed || pending || !target) return;
    clearTimeout(retry);
    pending = true;
    abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);
    timeout.unref?.();
    let again = 15000;
    try {
      const response = await fetchImpl(target.href, {
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: abort.signal,
      });
      if (response.status === 403 || response.status === 404) { disposed = true; return; }
      if (response.status === 204) { again = 5000; return; }
      if (!response.ok) return;
      const plan = await response.json();
      const expiry = Date.parse(plan?.expires_at);
      const now = Date.now();
      if (plan?.asset_id !== assetId || !Number.isFinite(expiry) || expiry <= now ||
          (plan.version !== 1 && plan.version !== 2) ||
          (plan.version === 2 && (plan.native_gam?.contract !== 'native-gam-plan-v1' || expiry > now + 120000))) return;
      if (disposed) return;
      await onPlan(plan);
      again = 0; // The SDK reports the next expiry; never renew an active plan in a loop.
    } catch { /* Continue content without ads until a later successful renewal. */ }
    finally {
      clearTimeout(timeout);
      pending = false;
      if (again) later(again);
    }
  }
  return {
    expired,
    destroy() { disposed = true; clearTimeout(retry); abort?.abort(); },
  };
}
