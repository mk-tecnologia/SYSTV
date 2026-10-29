import { createDatabase } from '../src/database.js';
const screen = process.argv[2];
if (process.getuid?.() !== 0 || typeof screen !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(screen)) {
  console.error('Execute como root: systvctl revoke-devices ID-DA-TV');
  process.exit(1);
}
const db = createDatabase();
try {
  await db.transaction(async c => {
    await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
    const [[exists]] = await c.execute('SELECT id FROM screens WHERE id=? FOR UPDATE', [screen]);
    if (!exists) throw new Error('TV não encontrada.');
    await c.execute('DELETE FROM screen_devices WHERE screen_id=?', [screen]);
    await c.execute('DELETE FROM screen_presence WHERE screen_id=?', [screen]);
  });
  console.log('Autorizações de presença revogadas. Autorize novamente os dispositivos desejados pelo painel.');
} catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
finally { await db.close(); }
