import { createDatabase } from '../src/database.js';
import { seed } from '../src/seed.js';

const db = createDatabase();
try {
  console.log(await seed(db) ? 'Catálogo inicial criado.' : 'Banco já inicializado; dados preservados.');
} finally { await db.close(); }
