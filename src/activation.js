import { createHash, randomBytes } from 'node:crypto';
import { HttpError, validText } from './http.js';
import { hashPassword, validPassword } from './passwords.js';
import { validEmail } from './email.js';

const digest = token => createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const unavailable = () => new HttpError(400, 'Link de ativação inválido, expirado ou já utilizado. Solicite um novo link ao responsável pela instalação.');

// Fecha definitivamente o primeiro acesso quando já há contas, inclusive legadas.
export async function sealActivation(db) {
  await db.query(`UPDATE initial_setup SET completed_at=COALESCE(completed_at,UTC_TIMESTAMP()),token_hash=NULL,expires_at=NULL
    WHERE id=1 AND EXISTS (SELECT 1 FROM users)`);
}

// Uso exclusivo da ferramenta local de instalação; não existe API de emissão.
export async function issueActivation(db, origin) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('Configure PUBLIC_ORIGIN antes de gerar o link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('PUBLIC_ORIGIN deve conter somente a origem HTTP/HTTPS confiável.');
  const token = randomBytes(32).toString('hex');
  const expiresAt = await db.transaction(async c => {
    await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
    const [[setup]] = await c.execute('SELECT completed_at FROM initial_setup WHERE id=1 FOR UPDATE');
    const [[users]] = await c.execute('SELECT COUNT(*) AS count FROM users');
    if (!setup || setup.completed_at || users.count) throw new Error('Já existem contas ou a ativação foi concluída. Use o login ou a recuperação de senha; nenhuma conta foi alterada.');
    await c.execute('UPDATE initial_setup SET token_hash=?,expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 24 HOUR) WHERE id=1', [digest(token)]);
    const [[row]] = await c.execute('SELECT expires_at FROM initial_setup WHERE id=1');
    return row.expires_at;
  });
  const link = new URL('/activate', url);
  link.hash = 'token=' + token;
  return { link: link.href, expiresAt };
}

export function createActivation(db) {
  // Limite global e de memória constante: vale também atrás do proxy Nginx.
  let count = 0, until = 0;
  function limit() {
    if (Date.now() >= until) { count = 0; until = Date.now() + 60000; }
    if (++count > 30) throw new HttpError(429, 'Aguarde um minuto para tentar novamente.');
  }
  async function eligible(token) {
    if (!validToken(token)) throw unavailable();
    const [row] = await db.query(`SELECT expires_at FROM initial_setup
      WHERE id=1 AND completed_at IS NULL AND token_hash=? AND expires_at>UTC_TIMESTAMP()
      AND NOT EXISTS (SELECT 1 FROM users)`, [digest(token)]);
    if (!row) throw unavailable();
    return row;
  }
  return {
    async status() {
      const [row] = await db.query('SELECT completed_at IS NULL AND NOT EXISTS (SELECT 1 FROM users) AS required FROM initial_setup WHERE id=1');
      return { required: Boolean(row?.required) };
    },
    async validate(input) {
      limit();
      const row = await eligible(input.token);
      return { valid: true, expires_at: row.expires_at };
    },
    async complete(input) {
      limit();
      await eligible(input.token); // Não deriva senhas para tentativas sem um link válido.
      const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
      const email = input.email === undefined || input.email === '' ? null : typeof input.email === 'string' ? input.email.trim().toLowerCase() : false;
      if (!validText(input.name) || !/^[a-z0-9._-]{3,64}$/.test(username)) throw new HttpError(400, 'Informe seu nome e um usuário de 3 a 64 caracteres, sem espaços ou acentos.');
      if (email !== null && !validEmail(email)) throw new HttpError(400, 'Informe um e-mail válido ou deixe o campo vazio.');
      if (!validPassword(input.password)) throw new HttpError(400, 'A senha deve ter entre 8 e 128 caracteres.');
      const passwordHash = await hashPassword(input.password);
      await db.transaction(async c => {
        // Mesmo lock das escritas administrativas e da emissão/renovação do link.
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE');
        const [[setup]] = await c.execute(`SELECT token_hash,completed_at,expires_at>UTC_TIMESTAMP() AS valid FROM initial_setup WHERE id=1 FOR UPDATE`);
        const [[users]] = await c.execute('SELECT COUNT(*) AS count FROM users');
        if (!setup || setup.completed_at || !setup.valid || setup.token_hash !== digest(input.token) || users.count) throw unavailable();
        await c.execute("INSERT INTO users (name,username,password_hash,role,active,email) VALUES (?,?,?,'admin',1,?)", [input.name.trim(), username, passwordHash, email]);
        await c.execute('UPDATE initial_setup SET completed_at=UTC_TIMESTAMP(),token_hash=NULL,expires_at=NULL WHERE id=1');
      });
      return { ok: true, username };
    },
  };
}
