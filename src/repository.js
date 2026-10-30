import { TV_PALETTES } from '../public/tv-palettes.js';
import { randomBytes } from 'node:crypto';
import { HttpError, validText, validId } from './http.js';
import { requireAdmin, requireCurrentAdmin, requireScreen } from './users.js';

function validatePalette(value) {
  if (value !== undefined && !TV_PALETTES.some(palette => palette.id === value)) throw new HttpError(400, 'Selecione um esquema de cores válido.');
}

function validateInterval(value) {
  if (value !== undefined && (!Number.isInteger(value) || value < 5 || value > 300)) {
    throw new HttpError(400, 'O intervalo deve ser um número inteiro entre 5 e 300 segundos.');
  }
}

async function stageProductOrder(connection, screen) {
  const [products] = await connection.execute('SELECT id,position FROM products WHERE screen=? ORDER BY position,id', [screen]);
  if (products.length) {
    const offset = products.at(-1).position + 2;
    if (products.at(-1).position + offset > 4294967295) throw new HttpError(409, 'Não foi possível reorganizar este catálogo.');
    // Libera as posições finais sem violar o índice único durante o movimento.
    await connection.execute('UPDATE products SET position=position+? WHERE screen=? ORDER BY position DESC', [offset, screen]);
  }
  return products.map(product => product.id);
}

async function finishProductOrder(connection, ids, savedId) {
  for (const [position, id] of ids.entries()) {
    if (id !== savedId) await connection.execute('UPDATE products SET position=? WHERE id=?', [position, id]);
  }
}

export function createRepository(db) {
  // Serializa alterações do catálogo para proteger a regra de manter ao menos uma TV.
  const write = work => db.transaction(async connection => {
    await connection.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
    return work(connection);
  });
  return {
    async health() { await db.query('SELECT 1'); },
    async snapshot() {
      return db.transaction(async connection => {
        const [[settings]] = await connection.execute('SELECT name,message FROM settings WHERE id=1');
        if (!settings) throw new Error('Banco não inicializado. Execute npm run db:migrate e npm run db:seed.');
        const [screens] = await connection.execute('SELECT id,name,page_interval_seconds,color_scheme FROM screens ORDER BY id');
        const [products] = await connection.execute('SELECT id,name,price,unit,screen,highlight,position FROM products ORDER BY position,id');
        const [logos] = await connection.execute('SELECT side,etag FROM logos');
        settings.left_logo = null;
        settings.right_logo = null;
        for (const logo of logos) settings[`${logo.side}_logo`] = `/api/logos/${logo.side}?v=${logo.etag}`;
        const [units] = await connection.execute('SELECT code,name FROM units ORDER BY code');
        return { settings, screens, products, units };
      });
    },
    async saveUnit(input, original, actor) {
      requireAdmin(actor);
      const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
      if (!/^[A-Z0-9]{1,8}$/.test(code) || !validText(input.name, 80)) throw new HttpError(400, 'Informe uma sigla de até 8 letras ou números e uma descrição de até 80 caracteres.');
      return write(async connection => {
        await requireCurrentAdmin(connection, actor);
        if (original) {
          const [[existing]] = await connection.execute('SELECT code FROM units WHERE code=?', [original]);
          if (!existing) throw new HttpError(404, 'Unidade não encontrada.');
        }
        const [[duplicate]] = await connection.execute('SELECT code FROM units WHERE code=?', [code]);
        if (duplicate && duplicate.code !== original) throw new HttpError(409, 'Já existe uma unidade com esta sigla.');
        if (original) await connection.execute('UPDATE units SET code=?,name=? WHERE code=?', [code, input.name.trim(), original]);
        else await connection.execute('INSERT INTO units (code,name) VALUES (?,?)', [code, input.name.trim()]);
        return code;
      });
    },
    async deleteUnit(code, actor) {
      requireAdmin(actor);
      await write(async connection => {
        await requireCurrentAdmin(connection, actor);
        const [[existing]] = await connection.execute('SELECT code FROM units WHERE code=?', [code]);
        if (!existing) throw new HttpError(404, 'Unidade não encontrada.');
        const [[used]] = await connection.execute('SELECT id FROM products WHERE unit=? LIMIT 1', [existing.code]);
        if (used) throw new HttpError(409, 'Esta unidade está em uso. Altere a unidade dos produtos antes de excluí-la.');
        const [[count]] = await connection.execute('SELECT COUNT(*) AS total FROM units');
        if (count.total <= 1) throw new HttpError(409, 'Mantenha pelo menos uma unidade cadastrada.');
        await connection.execute('DELETE FROM units WHERE code=?', [existing.code]);
      });
    },
    async saveSettings(input, actor) {
      requireAdmin(actor);
      if (!validText(input.name) || !validText(input.message, 180)) throw new HttpError(400, 'Preencha o nome e a mensagem.');
      await write(async c => {
        await requireCurrentAdmin(c, actor);
        await c.execute('UPDATE settings SET name=?,message=? WHERE id=1', [input.name.trim(), input.message.trim()]);
      });
    },
    async addScreen(input, actor) {
      requireAdmin(actor);
      validateInterval(input.page_interval_seconds);
      validatePalette(input.color_scheme);
      if (!validText(input.name, 50)) throw new HttpError(400, 'Nome da TV inválido.');
      if (/^tv[\s_-]*\d+$/i.test(input.name.trim())) throw new HttpError(400, 'Use um nome de localização, como “Balcão do açougue” ou “Entrada da loja”.');
      const id = `tv-${randomBytes(4).toString('hex')}`;
      await write(async c => {
        await requireCurrentAdmin(c, actor);
        const [[duplicate]] = await c.execute('SELECT id FROM screens WHERE name=?', [input.name.trim()]);
        if (duplicate) throw new HttpError(409, 'Já existe uma TV com este nome. Use um nome que diferencie o local.');
        await c.execute('INSERT INTO screens (id,name,page_interval_seconds,color_scheme) VALUES (?,?,?,?)', [id, input.name.trim(), input.page_interval_seconds ?? 15, input.color_scheme ?? 'classic']);
      });
      return id;
    },
    async renameScreen(id, input, actor) {
      requireAdmin(actor);
      validateInterval(input.page_interval_seconds);
      validatePalette(input.color_scheme);
      if (!validText(input.name, 50)) throw new HttpError(400, 'Preencha um nome de até 50 caracteres.');
      const name = input.name.trim();
      if (/^tv[\s_-]*\d+$/i.test(name)) throw new HttpError(400, 'Use um nome de localização, como “Balcão do açougue” ou “Entrada da loja”.');
      await write(async connection => {
        await requireCurrentAdmin(connection, actor);
        const [[screen]] = await connection.execute('SELECT id FROM screens WHERE id=?', [id]);
        if (!screen) throw new HttpError(404, 'TV não encontrada.');
        const [[duplicate]] = await connection.execute('SELECT id FROM screens WHERE name=? AND id<>?', [name, id]);
        if (duplicate) throw new HttpError(409, 'Já existe uma TV com este nome. Use um nome que diferencie o local.');
        await connection.execute('UPDATE screens SET name=?,page_interval_seconds=COALESCE(?,page_interval_seconds),color_scheme=COALESCE(?,color_scheme) WHERE id=?', [name, input.page_interval_seconds ?? null, input.color_scheme ?? null, id]);
      });
      return id;
    },
    async deleteScreen(id, actor) {
      requireAdmin(actor);
      await write(async connection => {
        await requireCurrentAdmin(connection, actor);
        const [screens] = await connection.execute('SELECT id FROM screens ORDER BY id FOR UPDATE');
        if (!screens.some(screen => screen.id === id)) throw new HttpError(404, 'TV não encontrada.');
        if (screens.length <= 1) throw new HttpError(409, 'Mantenha pelo menos uma TV.');
        await connection.execute('DELETE FROM screens WHERE id=?', [id]);
      });
    },
    async saveProduct(input, update, actor) {
      if (!validText(input.name) || !validText(input.unit, 8)
        || !Number.isSafeInteger(input.price) || input.price < 0 || input.price > 99999999
        || !Number.isSafeInteger(input.position) || input.position < 0 || input.position > 4294967295
        || typeof input.highlight !== 'boolean' || !validText(input.screen, 32)) {
        throw new HttpError(400, 'Confira nome, preço, unidade, TV, destaque e ordem.');
      }
      const id = update ? validId(input.id) : undefined;
      return write(async connection => {
        const [[screen]] = await connection.execute('SELECT id FROM screens WHERE id=?', [input.screen]);
        if (!screen) throw new HttpError(400, 'TV não encontrada.');
        const targetScreen = screen.id;
        await requireScreen(connection, actor, targetScreen);
        const [[unit]] = await connection.execute('SELECT code FROM units WHERE code=?', [input.unit]);
        if (!unit) throw new HttpError(400, 'Selecione uma unidade cadastrada.');
        let product;
        if (update) {
          [[product]] = await connection.execute('SELECT id,screen FROM products WHERE id=?', [id]);
          if (!product) throw new HttpError(404, 'Produto não encontrado.');
          await requireScreen(connection, actor, product.screen);
        }
        const orders = new Map();
        for (const screen of new Set([targetScreen, ...(product ? [product.screen] : [])])) {
          orders.set(screen, (await stageProductOrder(connection, screen)).filter(productId => productId !== id));
        }
        const target = orders.get(targetScreen);
        const position = Math.min(input.position, target.length);
        const values = [input.name.trim(), input.price, unit.code, targetScreen, input.highlight ? 1 : 0, position];
        let savedId = id;
        if (update) await connection.execute('UPDATE products SET name=?,price=?,unit=?,screen=?,highlight=?,position=? WHERE id=?', [...values, id]);
        else {
          const [result] = await connection.execute('INSERT INTO products (name,price,unit,screen,highlight,position) VALUES (?,?,?,?,?,?)', values);
          savedId = result.insertId;
        }
        target.splice(position, 0, savedId);
        for (const ids of orders.values()) await finishProductOrder(connection, ids, savedId);
        return savedId;
      });
    },
    async moveProduct(value, input, actor) {
      const id = validId(value);
      if (!Number.isSafeInteger(input.position) || input.position < 0 || input.position > 4294967295 || !validText(input.screen, 32)) {
        throw new HttpError(400, 'Informe uma posição válida para o produto.');
      }
      await write(async connection => {
        const [[product]] = await connection.execute('SELECT screen FROM products WHERE id=?', [id]);
        if (!product) throw new HttpError(404, 'Produto não encontrado.');
        await requireScreen(connection, actor, product.screen);
        if (product.screen !== input.screen) throw new HttpError(409, 'O produto mudou de TV. Atualize o catálogo e tente novamente.');
        const ids = (await stageProductOrder(connection, product.screen)).filter(productId => productId !== id);
        ids.splice(Math.min(input.position, ids.length), 0, id);
        await finishProductOrder(connection, ids);
      });
    },
    async deleteProduct(value, actor) {
      const id = validId(value);
      await write(async connection => {
        const [[product]] = await connection.execute('SELECT screen FROM products WHERE id=?', [id]);
        if (!product) throw new HttpError(404, 'Produto não encontrado.');
        await requireScreen(connection, actor, product.screen);
        const [result] = await connection.execute('DELETE FROM products WHERE id=?', [id]);
        if (!result.affectedRows) throw new HttpError(404, 'Produto não encontrado.');
        await finishProductOrder(connection, await stageProductOrder(connection, product.screen));
      });
    },
  };
}
