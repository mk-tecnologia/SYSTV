import { HttpError } from './http.js';
import { clientAddress } from './security.js';

export async function createEvents(repository, config = {}) {
  let current = await repository.snapshot();
  let pending = Promise.resolve();
  const clients = new Set();
  const addresses = new Map();
  const message = () => `data: ${JSON.stringify(current)}\n\n`;
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || !clients.size) return;
    checking = true;
    let ok = true;
    try { await repository.health(); } catch { ok = false; }
    for (const client of clients) client.write(`event: heartbeat\ndata: ${JSON.stringify({ ok })}\n\n`);
    checking = false;
  }, 20000);
  timer.unref();
  return {
    subscribe(req, res) {
      const address = clientAddress(req, config);
      if (clients.size >= 500 || (addresses.get(address) || 0) >= 50) throw new HttpError(429, 'Limite de conexões atingido.');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      res.write(message());
      clients.add(res);
      addresses.set(address, (addresses.get(address) || 0) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true; clients.delete(res);
        const count = addresses.get(address) - 1;
        if (count) addresses.set(address, count); else addresses.delete(address);
      };
      res.on('close', release);
      res.on('error', release);
    },
    refresh() {
      const update = pending.catch(() => {}).then(async () => {
        current = await repository.snapshot();
        const data = message();
        for (const client of clients) {
          // Uma TV lenta reconecta e recebe o estado mais recente, sem acumular buffers.
          if (client.writableLength > 1024 * 1024) { clients.delete(client); client.destroy(); }
          else client.write(data);
        }
      });
      pending = update;
      return update;
    },
    close() {
      clearInterval(timer);
      for (const client of clients) client.end();
      clients.clear();
    },
  };
}
