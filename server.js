import { config } from './src/config.js';
import { createDatabase } from './src/database.js';
import { createApp } from './src/app.js';

const db = createDatabase();
let app;
try {
  app = await createApp(db, config);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, resolve);
  });
  console.log(`SYSTV disponível na porta ${app.server.address().port} · MariaDB`);
} catch (error) {
  console.error('Não foi possível iniciar SYSTV:', error.code || error.message);
  await app?.close();
  await db.close();
  process.exit(1);
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  try {
    await app.close();
    await db.close();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    console.error('Falha ao encerrar:', error.message);
    process.exit(1);
  }
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
