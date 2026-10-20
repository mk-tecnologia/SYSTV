export async function createEvents(repository) {
  let current = await repository.snapshot();
  let pending = Promise.resolve();
  const clients = new Set();
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
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      res.write(message());
      clients.add(res);
      res.on('close', () => clients.delete(res));
      res.on('error', () => clients.delete(res));
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
