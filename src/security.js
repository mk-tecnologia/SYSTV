import { isIP } from 'node:net';
import { HttpError } from './http.js';

const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
// O Nginx gerenciado sobrescreve X-Real-IP. Nunca confiar em cabeçalhos de acesso direto.
export function clientAddress(req, config = {}) {
  const peer = req.socket.remoteAddress || 'unknown';
  const forwarded = req.headers['x-real-ip'];
  return config.trustProxy === true && loopback(peer) && typeof forwarded === 'string' && isIP(forwarded)
    ? forwarded : peer;
}

export function createRateLimit({ capacity = 10000, now = Date.now } = {}) {
  const entries = new Map();
  function cleanup() {
    const time = now();
    for (const [key, entry] of entries) if (entry.until <= time) entries.delete(key);
  }
  return {
    check(key, max, duration = 60000) {
      const time = now();
      let entry = entries.get(key);
      if (!entry || entry.until <= time) {
        if (!entry && entries.size >= capacity) cleanup();
        if (!entry && entries.size >= capacity) throw new HttpError(429, 'Muitas solicitações. Tente novamente em um minuto.');
        entry = { count: 0, until: time + duration };
        entries.set(key, entry);
      }
      if (++entry.count > max) throw new HttpError(429, 'Aguarde um minuto para tentar novamente.');
    },
    cleanup,
  };
}

export function validateDeployment(config) {
  if (!config.production) return;
  let origin;
  try { origin = new URL(config.origin); } catch { throw new Error('Produção exige PUBLIC_ORIGIN válida.'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.origin !== config.origin) throw new Error('PUBLIC_ORIGIN deve conter somente a origem HTTP/HTTPS canônica.');
  if (origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) throw new Error('Produção exige HTTPS para acesso pela rede.');
  if (origin.protocol === 'https:' && !config.secureCookie) throw new Error('HTTPS exige COOKIE_SECURE=true.');
}
