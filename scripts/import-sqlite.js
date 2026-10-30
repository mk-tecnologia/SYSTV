import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDatabase } from '../src/database.js';

const optional = process.argv.includes('--if-present');
const filename = resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'data/prices.sqlite');
if (!existsSync(filename)) {
  if (!optional) throw new Error(`SQLite não encontrado: ${filename}`);
  console.log('Sem banco SQLite para importar.');
} else {
  const db = createDatabase();
  let sqlite;
  try {
    const existing = await db.query('SELECT id FROM settings LIMIT 1');
    if (existing.length) {
      if (!optional) throw new Error('O MariaDB já contém dados. A importação exige um banco vazio.');
      console.log('MariaDB já inicializado; importação ignorada.');
    } else {
      const { DatabaseSync } = await import('node:sqlite');
      sqlite = new DatabaseSync(filename, { readOnly: true });
      const settings = sqlite.prepare('SELECT id,name,message FROM settings').all();
      const screens = sqlite.prepare('SELECT id,name FROM screens').all();
      const products = sqlite.prepare('SELECT id,name,price,unit,screen,highlight,position FROM products ORDER BY screen,position,id').all();
      if (settings.length) {
        await db.transaction(async connection => {
          for (const s of settings) await connection.execute('INSERT INTO settings (id,name,message) VALUES (?,?,?)', [s.id,s.name,s.message]);
          for (const s of screens) await connection.execute('INSERT INTO screens (id,name) VALUES (?,?)', [s.id,s.name]);
          const positions = new Map();
          for (const p of products) {
            const position = positions.get(p.screen) || 0;
            positions.set(p.screen, position + 1);
            await connection.execute('INSERT INTO products (id,name,price,unit,screen,highlight,position) VALUES (?,?,?,?,?,?,?)', [p.id,p.name,p.price,p.unit,p.screen,p.highlight,position]);
          }
        });
        console.log(`SQLite importado: ${screens.length} TVs e ${products.length} produtos. Arquivo original preservado.`);
      }
    }
  } finally {
    sqlite?.close();
    await db.close();
  }
}
