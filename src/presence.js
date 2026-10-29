import { createHash, randomBytes } from 'node:crypto';
import { requireScreen } from './users.js';
import { createRateLimit } from './security.js';
import { HttpError } from './http.js';

const digest = value => createHash('sha256').update(value).digest('hex');

export function createPresence(db) {
  const requests = createRateLimit();
  return {
    async enroll(screen, input, user) {
      if (typeof input.device !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.device)) throw new HttpError(400, 'Identificação do painel inválida.');
      const token = randomBytes(32).toString('hex');
      await db.transaction(async c => {
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        await requireScreen(c, user, screen);
        const [[exists]] = await c.execute('SELECT id FROM screens WHERE id=? FOR UPDATE', [screen]);
        if (!exists) throw new HttpError(404, 'TV não encontrada.');
        await c.execute('DELETE FROM screen_devices WHERE screen_id=? AND (expires_at<=UTC_TIMESTAMP() OR device_id=?)', [screen, input.device]);
        const [[count]] = await c.execute('SELECT COUNT(*) AS total FROM screen_devices WHERE screen_id=?', [screen]);
        if (count.total >= 100) throw new HttpError(409, 'Limite de dispositivos atingido. Revogue os dispositivos antigos desta TV.');
        await c.execute('INSERT INTO screen_devices (token_hash,device_id,screen_id,expires_at) VALUES (?,?,?,UTC_TIMESTAMP() + INTERVAL 90 DAY)', [digest(token), input.device, screen]);
      });
      return { token };
    },
    async revoke(screen, user) {
      await db.transaction(async c => {
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        await requireScreen(c, user, screen);
        await c.execute('DELETE FROM screen_devices WHERE screen_id=?', [screen]);
        await c.execute('DELETE FROM screen_presence WHERE screen_id=?', [screen]);
      });
    },
    async report(screen, input) {
      if (typeof input.device !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.device)) throw new HttpError(400, 'Identificação do painel inválida.');
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
