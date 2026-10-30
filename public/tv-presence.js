// Credencial de exibição independente da sessão administrativa.
export function createTVPresence({ screen, key, preview = false, ready = () => true, onStatus = () => {},
  fetch: request = globalThis.fetch, storage = () => globalThis.localStorage, timers = globalThis,
  now = () => globalThis.performance.now(), randomUUID = () => globalThis.crypto.randomUUID() }) {
  const storageKey = 'systv-device:' + screen;
  const validKey = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  let saved;
  try { if (!preview) saved = JSON.parse(storage().getItem(storageKey)); } catch {}
  const device = typeof saved?.device === 'string' && /^[a-f0-9-]{36}$/i.test(saved.device) ? saved.device : randomUUID();
  const supplied = validKey(key) ? key : null;
  const displayKey = supplied || (validKey(saved?.displayKey) ? saved.displayKey : undefined);
  let token = supplied && supplied !== saved?.displayKey ? null : validKey(saved?.token) ? saved.token : null;
  let active = false, timer, enrolling = false, reporting = false, invalidLink = false, lastReportAt = -Infinity;
  function save() {
    if (preview) return;
    try { storage().setItem(storageKey, JSON.stringify({ device, token, displayKey })); } catch {}
  }
  save();
  async function enroll() {
    if (!active || preview || token || enrolling || invalidLink) return;
    if (!displayKey) { onStatus('link_required'); return; }
    enrolling = true;
    try {
      const response = await request('/api/screens/' + encodeURIComponent(screen) + '/display-devices', {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device, key: displayKey }), signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        invalidLink = response.status === 403;
        onStatus(invalidLink ? 'invalid_link' : 'reconnecting'); return;
      }
      const result = await response.json();
      if (!validKey(result.token)) throw new Error('Credencial inválida.');
      token = result.token; save(); onStatus('ready');
    } catch { onStatus('reconnecting'); }
    finally { enrolling = false; }
  }
  async function report() {
    if (!active || preview || !token || !ready() || reporting || now() - lastReportAt < 10000) return;
    lastReportAt = now(); reporting = true;
    try {
      const response = await request('/api/screens/' + encodeURIComponent(screen) + '/heartbeat', {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device, token }), signal: AbortSignal.timeout(8000),
      });
      if (response.status === 401) { token = null; save(); onStatus('reconnecting'); }
      else onStatus(response.ok ? 'ready' : 'reconnecting');
    } catch { onStatus('reconnecting'); }
    finally { reporting = false; }
  }
  async function tick() { await enroll(); if (active) await report(); }
  return {
    start() {
      if (active) return;
      active = true;
      if (preview) { onStatus('preview'); return; }
      void tick(); timer = timers.setInterval(() => { void tick(); }, 15000);
    },
    stop() {
      active = false; timers.clearInterval(timer); timer = undefined;
      // A presença expira no servidor. Fechar uma aba não desconecta outra
      // que esteja exibindo a mesma TV com a mesma identificação do navegador.
    },
    report,
  };
}
