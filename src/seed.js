import { demoProducts } from '../database/demo.js';

export async function seed(db) {
  return db.transaction(async connection => {
    const [existing] = await connection.execute('SELECT id FROM settings WHERE id=1');
    if (existing.length) return false;
    await connection.execute('INSERT INTO settings (id,name,message) VALUES (1,?,?)', ['Casa de Carnes Silva', 'Qualidade e frescor todos os dias']);
    await connection.execute('INSERT INTO screens (id,name) VALUES (?,?)', ['tv01', 'Balcão principal']);
    for (const product of demoProducts) {
      await connection.execute('INSERT INTO products (name,price,unit,screen,highlight,position) VALUES (?,?,?,?,?,?)',
        [product.name, product.price, product.unit, product.screen, product.highlight, product.position]);
    }
    return true;
  });
}
