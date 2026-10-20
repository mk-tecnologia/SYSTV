import { validEmail } from './email.js';
import { randomBytes } from 'node:crypto';
import { hashPassword, validPassword } from './passwords.js';
import { HttpError, validText, validId } from './http.js';

export function requireAdmin(user) {
  if (user?.role !== 'admin') throw new HttpError(403, 'Apenas administradores podem realizar esta ação.');
}

export async function requireCurrentAdmin(connection, user) {
  const [[current]] = await connection.execute('SELECT role,active FROM users WHERE id=?', [user.id]);
  if (!current?.active || current.role !== 'admin') throw new HttpError(403, 'Apenas administradores podem realizar esta ação.');
}

export async function requireScreen(connection, user, screen) {
  // Consulta a permissão dentro da transação da escrita, inclusive ao mover um produto.
  const [[current]] = await connection.execute('SELECT role,active FROM users WHERE id=?', [user.id]);
  if (!current?.active) throw new HttpError(401, 'Entre para continuar.');
  if (current.role === 'admin') return;
  const [permission] = await connection.execute('SELECT user_id FROM user_screens WHERE user_id=? AND screen_id=?', [user.id, screen]);
  if (!permission.length) throw new HttpError(403, 'Você não tem permissão para alterar esta TV.');
}

export async function bootstrapAdmin(db, config) {
  const [{ count }] = await db.query('SELECT COUNT(*) AS count FROM users');
  if (count > 0) return;
  // Produção só cria o primeiro administrador pela ativação de uso único.
  if (config.production) return;
  const password = config.password || randomBytes(16).toString('base64url');
  if (!config.password) console.log(`Senha inicial do administrador: ${password}`);
  const username = config.adminUsername || 'admin';
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username) || !validPassword(password)) throw new Error('Administrador inicial exige login válido e senha de 8 a 128 caracteres.');
  const hashed = await hashPassword(password);
  await db.transaction(async connection => {
    // O mesmo bloqueio usado para todas as alterações de usuários e permissões.
    await connection.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
    const [[existing]] = await connection.execute('SELECT COUNT(*) AS count FROM users');
    if (!existing.count) {
      await connection.execute('INSERT INTO users (name,username,password_hash,role) VALUES (?,?,?,?)',
        ['Administrador', username.toLowerCase(), hashed, 'admin']);
      console.log(`Administrador inicial criado: ${username}.`);
    }
  });
}

export function createUsers(db) {
  return {
    async list(actor) {
      requireAdmin(actor);
      const users = await db.query('SELECT id,name,username,role,active,email,two_factor_enabled FROM users ORDER BY name,id');
      const permissions = await db.query('SELECT user_id,screen_id FROM user_screens');
      return users.map(user => ({ ...user, active: Boolean(user.active), two_factor_enabled: Boolean(user.two_factor_enabled), screens: permissions.filter(p => p.user_id === user.id).map(p => p.screen_id) }));
    },
    async save(input, update, actor) {
      requireAdmin(actor);
      if (!validText(input.name) || typeof input.username !== 'string' || !/^[a-zA-Z0-9._-]{3,64}$/.test(input.username)
        || !['admin', 'editor'].includes(input.role) || typeof input.active !== 'boolean'
        || !Array.isArray(input.screens) || input.screens.length > 1000 || input.screens.some(id => !validText(id, 32))) {
        throw new HttpError(400, 'Confira nome, login, perfil, status e TVs permitidas.');
      }
      const id = update ? validId(input.id) : undefined;
      const email = input.email === undefined ? undefined : input.email === null ? null : typeof input.email === 'string' ? input.email.trim().toLowerCase() || null : false;
      if (email !== undefined && email !== null && !validEmail(email)) throw new HttpError(400, 'Informe um e-mail válido.');
      const changePassword = input.password !== undefined && input.password !== '';
      if ((!update || changePassword) && !validPassword(input.password)) throw new HttpError(400, 'A senha deve ter entre 8 e 128 caracteres.');
      const passwordHash = !update || changePassword ? await hashPassword(input.password) : undefined;
      return db.transaction(async connection => {
        await connection.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        const [[currentActor]] = await connection.execute('SELECT role,active FROM users WHERE id=?', [actor.id]);
        if (!currentActor?.active || currentActor.role !== 'admin') throw new HttpError(403, 'Apenas administradores podem realizar esta ação.');
        let existing;
        if (update) {
          [[existing]] = await connection.execute('SELECT id,role,active,email,two_factor_enabled FROM users WHERE id=?', [id]);
          if (!existing) throw new HttpError(404, 'Usuário não encontrado.');
          if (id === actor.id && (!input.active || input.role !== 'admin')) throw new HttpError(409, 'Você não pode desativar ou remover o seu próprio perfil de administrador.');
          if (existing.role === 'admin' && existing.active && (!input.active || input.role !== 'admin')) {
            const [[admins]] = await connection.execute("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1");
            if (admins.count <= 1) throw new HttpError(409, 'Mantenha pelo menos um administrador ativo.');
          }
        }
        if (update && existing.two_factor_enabled && email !== undefined && email !== existing.email) throw new HttpError(409, 'O usuário precisa desativar seu 2FA antes de alterar o e-mail.');
        if (email) { const [[duplicateEmail]] = await connection.execute('SELECT id FROM users WHERE email=?', [email]); if (duplicateEmail && duplicateEmail.id !== id) throw new HttpError(409, 'Este e-mail já está em uso.'); }
        const username = input.username.toLowerCase();
        const [[duplicate]] = await connection.execute('SELECT id FROM users WHERE username=?', [username]);
        if (duplicate && duplicate.id !== id) throw new HttpError(409, 'Este login já está em uso.');
        const screens = input.role === 'admin' ? [] : [...new Set(input.screens)];
        for (const screen of screens) {
          const [[valid]] = await connection.execute('SELECT id FROM screens WHERE id=?', [screen]);
          if (!valid) throw new HttpError(400, 'Uma das TVs selecionadas não existe mais.');
        }
        let savedId = id;
        if (update) {
          await connection.execute('UPDATE users SET name=?,username=?,role=?,active=? WHERE id=?', [input.name.trim(), username, input.role, input.active ? 1 : 0, id]);
          if (email !== undefined) await connection.execute('UPDATE users SET email=? WHERE id=?', [email, id]);
          await connection.execute('DELETE FROM auth_challenges WHERE user_id=?', [id]);
          if (passwordHash) await connection.execute('UPDATE users SET password_hash=? WHERE id=?', [passwordHash, id]);
          await connection.execute('DELETE FROM user_screens WHERE user_id=?', [id]);
          // Alterações de perfil, permissão, status ou senha encerram as sessões desse usuário.
          await connection.execute('DELETE FROM sessions WHERE user_id=?', [id]);
        } else {
          const [result] = await connection.execute('INSERT INTO users (name,username,password_hash,role,active,email) VALUES (?,?,?,?,?,?)',
            [input.name.trim(), username, passwordHash, input.role, input.active ? 1 : 0, email ?? null]);
          savedId = result.insertId;
        }
        for (const screen of screens) await connection.execute('INSERT INTO user_screens (user_id,screen_id) VALUES (?,?)', [savedId, screen]);
        return savedId;
      });
    },
    async delete(value, actor) {
      requireAdmin(actor);
      const id = validId(value);
      if (id === actor.id) throw new HttpError(409, 'Você não pode excluir seu próprio usuário.');
      await db.transaction(async connection => {
        await connection.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        const [[currentActor]] = await connection.execute('SELECT role,active FROM users WHERE id=?', [actor.id]);
        if (!currentActor?.active || currentActor.role !== 'admin') throw new HttpError(403, 'Apenas administradores podem realizar esta ação.');
        const [[user]] = await connection.execute('SELECT role,active FROM users WHERE id=?', [id]);
        if (!user) throw new HttpError(404, 'Usuário não encontrado.');
        if (user.role === 'admin' && user.active) {
          const [[admins]] = await connection.execute("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1");
          if (admins.count <= 1) throw new HttpError(409, 'Mantenha pelo menos um administrador ativo.');
        }
        await connection.execute('DELETE FROM users WHERE id=?', [id]);
      });
    },
  };
}
