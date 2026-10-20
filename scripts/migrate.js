import { createDatabase } from '../src/database.js';
import { migrate } from '../src/migrations.js';

const db = createDatabase();
try { await migrate(db); } finally { await db.close(); }
