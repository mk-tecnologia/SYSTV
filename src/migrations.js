import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function migrate(db) {
  const connection = await db.pool.getConnection();
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('systv_migrations', 30) AS acquired");
    if (!lock.acquired) throw new Error('Outra migração está em execução. Tente novamente.');
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(120) PRIMARY KEY, checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const directory = new URL('../database/migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(new URL(file, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const [[existing]] = await connection.execute('SELECT checksum FROM schema_migrations WHERE version=?', [file]);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Migração ${file} já aplicada foi modificada. Crie uma nova migração.`);
        continue;
      }
      // MariaDB faz commit implícito de DDL. Cada instrução inicial é idempotente.
      for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) {
        await connection.query(statement);
      }
      await connection.execute('INSERT INTO schema_migrations (version, checksum) VALUES (?,?)', [file, checksum]);
      console.log(`Migração aplicada: ${file}`);
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('systv_migrations')").catch(() => {});
    connection.release();
  }
}
