import { createDatabase } from '../src/database.js';

// Catálogo vazio em produção; não carrega produtos nem identidade de demonstração.
const db = createDatabase();
try {
  await db.transaction(async connection => {
    const [rows] = await connection.execute('SELECT id FROM settings WHERE id=1');
    if (rows.length) return;
    await connection.execute('INSERT INTO settings (id,name,message) VALUES (1,?,?)', ['Minha empresa', 'Bem-vindo']);
    await connection.execute('INSERT INTO screens (id,name) VALUES (?,?)', ['tv01', 'Balcão principal']);
  });
} finally { await db.close(); }
