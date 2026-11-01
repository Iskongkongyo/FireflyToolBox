(() => {
  if (window.top !== window || window.__fireflyBlobDownload) return;
  const bridge = window.FireflyBlobDownload;
  if (!bridge) return;
  const objects = new Map(), links = new Map();
  const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
  const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
  const blobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get;
  let active;
  URL.createObjectURL = function (value) {
    const url = create.call(this, value);
    try {
      // Blob/File objects from another frame fail instanceof in this realm.
      // Use the native getter's brand check; MediaSource URLs need no cache.
      blobSize.call(value);
      objects.set(url, typeof WeakRef === 'function' ? new WeakRef(value) : { deref: () => value });
      if (objects.size > 64) objects.delete(objects.keys().next().value);
    } catch {}
    return url;
  };
  function remember(anchor) {
    if (!anchor?.href?.startsWith('blob:')) return;
    const entry = { name: anchor.download || '', blob: objects.get(anchor.href)?.deref() };
    clearTimeout(links.get(anchor.href)?.timer);
    links.set(anchor.href, entry);
    if (links.size > 64) links.delete(links.keys().next().value);
    const url = anchor.href;
    entry.timer = setTimeout(() => { if (links.get(url) === entry && active?.url !== url) links.delete(url); }, 10000);
  }
  HTMLAnchorElement.prototype.click = function () {
    remember(this);
    const result = click.call(this);
    remember(this);
    return result;
  };
  HTMLAnchorElement.prototype.dispatchEvent = function (event) {
    if (event?.type === 'click') remember(this);
    const result = dispatch.call(this, event);
    if (event?.type === 'click') remember(this);
    return result;
  };
  document.addEventListener('click', event => remember(event.target?.closest?.('a[href]')), true);
  document.addEventListener('click', event => remember(event.target?.closest?.('a[href]')));
  bridge.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!active || message.id !== active.id) return;
    const session = active, waiter = session.waiter;
    session.waiter = null;
    if (message.error) {
      session.error = new Error(message.error);
      session.cancelRead?.(session.error);
      active = null;
      waiter?.reject(session.error);
    } else waiter?.resolve(message);
  };
  function read(session, operation) {
    if (session.error) return Promise.reject(session.error);
    return new Promise((resolve, reject) => {
      const clear = () => { if (session.cancelRead === cancel) session.cancelRead = null; };
      const cancel = error => { clear(); reject(error); };
      session.cancelRead = cancel;
      Promise.resolve().then(() => {
        if (session.error) throw session.error;
        return operation();
      }).then(value => { clear(); resolve(value); }, cancel);
    });
  }
  function request(session, values) {
    if (session.error) return Promise.reject(session.error);
    return new Promise((resolve, reject) => {
      session.waiter = { resolve, reject };
      try { bridge.postMessage(JSON.stringify({ id: session.id, ...values })); }
      catch (error) { session.waiter = null; reject(error); }
    });
  }
  async function start(id, url, fallbackMime) {
    if (active || typeof id !== 'string' || !url.startsWith('blob:')) return;
    const session = active = { id, url, waiter: null };
    try {
      const entry = links.get(url);
      if (entry) clearTimeout(entry.timer);
      const blob = entry?.blob || objects.get(url)?.deref() || await read(session, async () => (await fetch(url)).blob());
      await request(session, { operation: 'begin', size: blob.size, name: entry?.name || '', mime: blob.type || fallbackMime || 'application/octet-stream' });
      for (let offset = 0; offset < blob.size; offset += 262144) {
        const bytes = new Uint8Array(await read(session, () => blob.slice(offset, offset + 262144).arrayBuffer()));
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
        const reply = await request(session, { operation: 'chunk', offset, data: btoa(binary) });
        if (reply.written !== offset + bytes.length) throw new Error('File transfer offset mismatch');
      }
      await request(session, { operation: 'finish' });
    } catch {
      try { bridge.postMessage(JSON.stringify({ id, operation: 'error' })); } catch {}
    } finally {
      links.delete(url); objects.delete(url);
      if (active === session) active = null;
    }
  }
  window.addEventListener('pagehide', () => {
    if (active) {
      active.error = new Error('Page closed');
      active.cancelRead?.(active.error);
      try { bridge.postMessage(JSON.stringify({ id: active.id, operation: 'error' })); } catch {}
      active.waiter?.reject(new Error('Page closed'));
      active = null;
    }
    links.clear(); objects.clear();
  });
  Object.defineProperty(window, '__fireflyBlobDownload', { value: Object.freeze({ start }) });
})();
