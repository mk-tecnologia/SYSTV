import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../src/database.js';
import { config } from '../src/config.js';
import { issueActivation } from '../src/activation.js';

const db = createDatabase();
try {
  if (process.getuid?.() !== 0) throw new Error('Execute como root no servidor de instalação.');
  const result = await issueActivation(db, config.origin);
  const temporary = '/etc/systv/.activation-link-' + randomBytes(8).toString('hex');
  try {
    await writeFile(temporary, result.link + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temporary, '/etc/systv/activation-link.txt');
  } finally { await unlink(temporary).catch(() => {}); }
  // Saída somente por solicitação explícita do operador; nunca pelo servidor/logs.
  console.log(result.link);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await db.close(); }
