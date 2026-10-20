// Mantém a conexão de preços, incluindo conexões que param sem emitir erro.
export function createTVConnection({
  onState, onStatus, lastSyncedAt = null,
  createSource = () => new EventSource('/api/events'),
  fetchState = async signal => {
    const response = await fetch('/api/state', { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Servidor indisponível.');
    return response.json();
  },
  now = () => Date.now(),
  timers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: id => globalThis.clearTimeout(id),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: id => globalThis.clearInterval(id),
  },
}) {
  let source, retryTimer, request, watchdog, generation = 0, attempts = 0;
  let lastTraffic = now(), stopped = false, polling = false;
  const publish = (phase, nextRetryAt = null) => onStatus({ phase, lastSyncedAt, nextRetryAt, attempts });
  const closeSource = () => { source?.close(); source = null; };
  const cancelRequest = () => { request?.abort(); request = null; };
  function accept(snapshot) {
    if (!snapshot?.settings || typeof snapshot.settings.name !== 'string'
      || !Array.isArray(snapshot.screens) || !Array.isArray(snapshot.products)) throw new Error('Dados inválidos.');
    lastSyncedAt = now();
    onState(snapshot, lastSyncedAt);
  }
  function failed(token) {
    if (stopped || token !== generation) return;
    generation++; closeSource();
    timers.clearTimeout(retryTimer);
    const delay = Math.min(30000, 2000 * 2 ** Math.min(attempts++, 4));
    publish(polling ? 'polling' : 'offline', now() + delay);
    retryTimer = timers.setTimeout(recover, delay);
  }
  function connect() {
    if (stopped) return;
    closeSource();
    const token = ++generation;
    lastTraffic = now();
    publish(polling ? 'polling' : 'connecting');
    try {
      source = createSource();
      source.onmessage = event => {
        if (stopped || token !== generation) return;
        try {
          accept(JSON.parse(event.data));
          lastTraffic = now(); polling = false; attempts = 0;
          timers.clearTimeout(retryTimer);
          publish('live');
        } catch { polling = false; failed(token); }
      };
      source.addEventListener('heartbeat', event => {
        if (stopped || token !== generation) return;
        try {
          if (JSON.parse(event.data).ok !== true) throw new Error();
          lastTraffic = now();
        } catch { polling = false; failed(token); }
      });
      source.onerror = () => failed(token);
    } catch { failed(token); }
  }
  async function recover() {
    if (stopped) return;
    timers.clearTimeout(retryTimer);
    closeSource(); cancelRequest();
    const token = ++generation;
    const controller = new AbortController(); request = controller;
    publish(polling ? 'polling' : 'connecting');
    const timeout = timers.setTimeout(() => controller.abort(), 8000);
    try {
      const snapshot = await fetchState(controller.signal);
      if (stopped || token !== generation) return;
      accept(snapshot); polling = true;
    } catch {
      if (stopped || token !== generation) return;
      polling = false; failed(token); return;
    } finally {
      timers.clearTimeout(timeout);
      if (request === controller) request = null;
    }
    connect();
  }
  function check() {
    if (source && now() - lastTraffic > 45000) { polling = false; failed(generation); }
  }
  return {
    start() {
      if (watchdog) return;
      stopped = false;
      watchdog = timers.setInterval(check, 5000);
      connect();
    },
    retry: recover,
    check,
    offline() { polling = false; cancelRequest(); failed(generation); },
    stop() {
      stopped = true; generation++;
      closeSource(); cancelRequest();
      timers.clearTimeout(retryTimer); timers.clearInterval(watchdog); watchdog = null;
    },
  };
}
