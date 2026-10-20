import { HttpError } from './http.js';

export function createPresence(db) {
  return {
    async report(screen, input) {
      if (typeof input.device !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.device)) throw new HttpError(400, 'Identificação do painel inválida.');
      if (!(await db.query('SELECT id FROM screens WHERE id = ?', [screen])).length) throw new HttpError(404, 'TV não encontrada.');
      if (input.disconnected === true) {
        await db.query('DELETE FROM screen_presence WHERE device_id = ? AND screen_id = ?', [input.device, screen]);
      } else {
        await db.query(`INSERT INTO screen_presence (device_id, screen_id, last_seen_at) VALUES (?, ?, UTC_TIMESTAMP(3))
          ON DUPLICATE KEY UPDATE screen_id = VALUES(screen_id), last_seen_at = VALUES(last_seen_at)`, [input.device, screen]);
      }
    },
    async list(user) {
      const rows = await db.query(`SELECT s.id, COUNT(p.device_id) AS connected_devices FROM screens s
        LEFT JOIN screen_presence p ON p.screen_id = s.id AND p.last_seen_at > UTC_TIMESTAMP(3) - INTERVAL 45 SECOND
        GROUP BY s.id`);
      return rows.filter(row => user.role === 'admin' || user.screens.includes(row.id))
        .map(row => ({ id: row.id, online: row.connected_devices > 0, connected_devices: Number(row.connected_devices) }));
    },
    async cleanup() { await db.query('DELETE FROM screen_presence WHERE last_seen_at < UTC_TIMESTAMP() - INTERVAL 1 DAY'); },
  };
}
