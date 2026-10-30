import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { requireScreen } from './users.js';
import { clientAddress, createRateLimit } from './security.js';
import { HttpError } from './http.js';

const digest = value => createHash('sha256').update(value).digest('hex');

export function createPresence(db, config = {}) {
  const requests = createRateLimit();
  function linkSecret(screen, nonce, device = '') {
    if (!/^[a-f0-9]{64}$/i.test(config.mailEncryptionKey || '')) throw new HttpError(503, 'A chave de proteção do servidor não está configurada.');
    const key = createHmac('sha256', Buffer.from(config.mailEncryptionKey, 'hex')).update('systv-display-key-v1').digest();
    return createHmac('sha256', key).update(JSON.stringify([device ? 'device' : 'link', screen, nonce, device])).digest('hex');
  }
  function validDevice(input) {
    if (typeof input?.device !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.device)) throw new HttpError(400, 'Identificação do painel inválida.');
  }
  async function register(connection, screen, device, token) {
    await connection.execute('DELETE FROM screen_devices WHERE screen_id=? AND (expires_at<=UTC_TIMESTAMP() OR device_id=?)', [screen, device]);
    const [[count]] = await connection.execute('SELECT COUNT(*) AS total FROM screen_devices WHERE screen_id=?', [screen]);
    if (count.total >= 100) throw new HttpError(409, 'Limite de dispositivos atingido para esta TV.');
    await connection.execute('INSERT INTO screen_devices (token_hash,device_id,screen_id,expires_at) VALUES (?,?,?,UTC_TIMESTAMP() + INTERVAL 90 DAY)', [digest(token), device, screen]);
  }
  return {
    async displayLink(screen, input, user) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Opção de link inválida.');
      if (input.renew !== undefined && typeof input.renew !== 'boolean') throw new HttpError(400, 'Opção de renovação inválida.');
      return db.transaction(async c => {
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        await requireScreen(c, user, screen);
        const [[exists]] = await c.execute('SELECT id FROM screens WHERE id=? FOR UPDATE', [screen]);
        if (!exists) throw new HttpError(404, 'TV não encontrada.');
        const [[current]] = await c.execute('SELECT nonce FROM screen_display_links WHERE screen_id=?', [exists.id]);
        const nonce = !current || input.renew ? randomBytes(32).toString('hex') : current.nonce;
        const token = linkSecret(exists.id, nonce);
        if (!current || input.renew) {
          await c.execute('INSERT INTO screen_display_links (screen_id,nonce) VALUES (?,?) ON DUPLICATE KEY UPDATE nonce=VALUES(nonce)', [exists.id, nonce]);
        }
        if (input.renew) {
          await c.execute('DELETE FROM screen_devices WHERE screen_id=?', [exists.id]);
          await c.execute('DELETE FROM screen_presence WHERE screen_id=?', [exists.id]);
        }
        return { path: '/tv?screen=' + encodeURIComponent(exists.id) + '#display=' + token };
      });
    },
    async enrollDisplay(screen, input, req) {
      validDevice(input);
      requests.check('display:' + clientAddress(req, config), 120);
      if (typeof input.key !== 'string' || !/^[a-f0-9]{64}$/.test(input.key)) throw new HttpError(403, 'Use o link de exibição copiado no painel.');
      return db.transaction(async c => {
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        const [[link]] = await c.execute('SELECT screen_id,nonce FROM screen_display_links WHERE screen_id=? FOR UPDATE', [screen]);
        if (!link || !timingSafeEqual(Buffer.from(input.key, 'hex'), Buffer.from(linkSecret(link.screen_id, link.nonce), 'hex'))) throw new HttpError(403, 'O link de exibição foi renovado ou é inválido. Copie o link atual no painel.');
        const token = linkSecret(link.screen_id, link.nonce, input.device);
        await register(c, link.screen_id, input.device, token);
        return { token };
      });
    },
    async enroll(screen, input, user) {
      if (typeof input?.device !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.device)) throw new HttpError(400, 'Identificação do painel inválida.');
      const token = randomBytes(32).toString('hex');
      await db.transaction(async c => {
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        await requireScreen(c, user, screen);
        const [[exists]] = await c.execute('SELECT id FROM screens WHERE id=? FOR UPDATE', [screen]);
        if (!exists) throw new HttpError(404, 'TV não encontrada.');
        await register(c, screen, input.device, token);
      });
      return { token };
    },
    async revoke(screen, user) {
      await db.transaction(async c => {
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        await requireScreen(c, user, screen);
        await c.execute('DELETE FROM screen_display_links WHERE screen_id=?', [screen]);
        await c.execute('DELETE FROM screen_devices WHERE screen_id=?', [screen]);
        await c.execute('DELETE FROM screen_presence WHERE screen_id=?', [screen]);
      });
    },
    async report(screen, input) {
      if (typeof input?.device !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.device)) throw new HttpError(400, 'Identificação do painel inválida.');
      if (typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) throw new HttpError(401, 'Autorize este dispositivo pelo painel administrativo.');
      const hash = digest(input.token);
      requests.check(hash, 12);
      await db.transaction(async c => {
        const [[credential]] = await c.execute('SELECT device_id FROM screen_devices WHERE token_hash=? AND screen_id=? AND device_id=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE', [hash, screen, input.device]);
        if (!credential) throw new HttpError(401, 'Autorização do dispositivo inválida ou expirada.');
        if (input.disconnected === true) {
          await c.execute('DELETE FROM screen_presence WHERE device_id=? AND screen_id=?', [input.device, screen]);
        } else {
          await c.execute(`INSERT INTO screen_presence (device_id, screen_id, last_seen_at) VALUES (?, ?, UTC_TIMESTAMP(3))
            ON DUPLICATE KEY UPDATE screen_id=VALUES(screen_id),last_seen_at=VALUES(last_seen_at)`, [input.device, screen]);
          await c.execute('UPDATE screen_devices SET expires_at=UTC_TIMESTAMP() + INTERVAL 90 DAY WHERE token_hash=?', [hash]);
        }
      });
    },
    async list(user) {
      const rows = await db.query(`SELECT s.id, COUNT(p.device_id) AS connected_devices FROM screens s
        LEFT JOIN screen_presence p ON p.screen_id = s.id AND p.last_seen_at > UTC_TIMESTAMP(3) - INTERVAL 45 SECOND
        AND EXISTS (SELECT 1 FROM screen_devices d WHERE d.screen_id=s.id AND d.device_id=p.device_id AND d.expires_at>UTC_TIMESTAMP())
        GROUP BY s.id`);
      return rows.filter(row => user.role === 'admin' || user.screens.includes(row.id))
        .map(row => ({ id: row.id, online: row.connected_devices > 0, connected_devices: Number(row.connected_devices) }));
    },
    async cleanup() {
      requests.cleanup();
      await db.query('DELETE FROM screen_presence WHERE last_seen_at < UTC_TIMESTAMP() - INTERVAL 2 MINUTE');
      await db.query('DELETE FROM screen_devices WHERE expires_at<=UTC_TIMESTAMP()');
    },
  };
}
