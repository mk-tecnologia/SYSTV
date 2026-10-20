import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpError, validText } from './http.js';
import { verifyPassword, hashPassword, validPassword } from './passwords.js';
import { validEmail } from './email.js';

const digest = token => createHash('sha256').update(token).digest('hex');
const sessionToken = req => (req.headers.cookie || '').split(/;\s*/).find(cookie => cookie.startsWith('session='))?.slice(8);
const dummyHash = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
const maskedEmail = email => email.replace(/^(.)(.*)(@.*)$/, '$1***$3');

export function createAuth(db, config, mailer) {
  const attempts = new Map();
  const cookie = (token, maxAge) => `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config.secureCookie ? '; Secure' : ''}`;
  function limit(req, scope, max = 10) {
    const address = scope + ':' + req.socket.remoteAddress, now = Date.now();
    let history = attempts.get(address);
    if (!history || history.until < now) history = { count: 0, until: now + 60000 };
    attempts.set(address, history);
    if (++history.count > max) throw new HttpError(429, 'Aguarde um minuto para tentar novamente.');
  }
  async function session(req, res, user) {
    const token = randomBytes(32).toString('hex');
    await db.transaction(async c => {
      const [[current]] = await c.execute('SELECT active,password_hash,two_factor_enabled FROM users WHERE id=? FOR UPDATE', [user.id]);
      if (!current?.active || current.password_hash !== user.password_hash || current.two_factor_enabled) throw new HttpError(401, 'A segurança da conta foi alterada. Entre novamente.');
      await c.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))', [digest(token), user.id]);
      const previous = sessionToken(req);
      if (previous) await c.execute('DELETE FROM sessions WHERE token_hash=?', [digest(previous)]);
    });
    res.setHeader('Set-Cookie', cookie(token, 43200));
  }
  async function passwordUser(userId, password) {
    if (typeof password !== 'string' || password.length > 128) throw new HttpError(400, 'Informe sua senha atual.');
    const [user] = await db.query('SELECT * FROM users WHERE id=? AND active=1', [userId]);
    if (!user || !await verifyPassword(password, user.password_hash)) throw new HttpError(400, 'Senha atual incorreta.');
    return user;
  }
  async function issue(user, purpose) {
    if (!validEmail(user.email)) throw new HttpError(400, 'Cadastre um e-mail na sua conta antes de continuar.');
    if (!await mailer.configured()) throw new HttpError(503, 'O envio de e-mails ainda não está configurado. Solicite ao administrador.');
    const token = randomBytes(32).toString('hex'), code = purpose === 'reset' ? null : String(randomInt(0, 1000000)).padStart(6, '0');
    await db.transaction(async c => {
      await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [user.id]);
      const [[recent]] = await c.execute('SELECT token_hash FROM auth_challenges WHERE user_id=? AND purpose=? AND created_at>UTC_TIMESTAMP() - INTERVAL 30 SECOND LIMIT 1', [user.id, purpose]);
      if (recent) throw new HttpError(429, 'Aguarde 30 segundos antes de solicitar outro e-mail.');
      await c.execute('DELETE FROM auth_challenges WHERE user_id=? AND purpose=?', [user.id, purpose]);
      await c.execute('INSERT INTO auth_challenges (token_hash,user_id,purpose,code_hash,email,password_fingerprint,expires_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP() + INTERVAL 10 MINUTE)', [digest(token), user.id, purpose, code ? createHmac('sha256', token).update(code).digest('hex') : null, user.email, digest(user.password_hash)]);
    });
    try {
      if (purpose === 'reset') {
        if (!config.origin || !/^https?:\/\//.test(config.origin)) throw new HttpError(503, 'Configure PUBLIC_ORIGIN para os links de recuperação.');
        const link = new URL('/admin', config.origin); link.hash = 'reset=' + token;
        await mailer.send(user.email, 'SYSTV · Recuperação de senha', `Foi solicitada uma nova senha para sua conta SYSTV.\n\nAcesse o link abaixo em até 10 minutos:\n${link.href}\n\nSe você não solicitou, ignore este e-mail. O 2FA permanece ativo caso esteja habilitado.`);
      } else await mailer.send(user.email, purpose === 'enable' ? 'SYSTV · Confirme a ativação do 2FA' : 'SYSTV · Código de acesso', `Seu código SYSTV é: ${code}\n\nEle vale por 10 minutos e só pode ser usado uma vez. Não compartilhe este código.\n\nSe você não solicitou, ignore este e-mail.`);
    } catch (error) { await db.query('DELETE FROM auth_challenges WHERE token_hash=?', [digest(token)]); throw error; }
    return { challenge: token, email: maskedEmail(user.email), expires_in: 600 };
  }
  // Erros de código são retornados após o commit: as tentativas não podem ser desfeitas por rollback.
  async function consume(input, purpose, work, actorId) {
    if (typeof input.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(input.challenge)) throw new HttpError(400, 'Solicitação inválida ou expirada.');
    const outcome = await db.transaction(async c => {
      const [[challenge]] = await c.execute(`SELECT *, expires_at>UTC_TIMESTAMP() AS valid FROM auth_challenges WHERE token_hash=? FOR UPDATE`, [digest(input.challenge)]);
      if (!challenge || challenge.purpose !== purpose || !challenge.valid || challenge.attempts >= 5 || actorId && challenge.user_id !== actorId) return { error: 'Solicitação inválida ou expirada. Solicite novamente.' };
      const [[user]] = await c.execute('SELECT * FROM users WHERE id=? FOR UPDATE', [challenge.user_id]);
      if (!user?.active || challenge.email !== user.email || challenge.password_fingerprint !== digest(user.password_hash)) {
        await c.execute('DELETE FROM auth_challenges WHERE token_hash=?', [challenge.token_hash]); return { error: 'A conta foi alterada. Solicite novamente.' };
      }
      if (purpose !== 'reset') {
        const candidate = createHmac('sha256', input.challenge).update(typeof input.code === 'string' ? input.code : '').digest('hex');
        if (!/^[0-9]{6}$/.test(input.code || '') || !timingSafeEqual(Buffer.from(candidate), Buffer.from(challenge.code_hash))) {
          await c.execute('UPDATE auth_challenges SET attempts=attempts+1 WHERE token_hash=?', [challenge.token_hash]); return { error: 'Código incorreto. Após 5 tentativas, solicite um novo código.' };
        }
      }
      await work(c, user);
      await c.execute('DELETE FROM auth_challenges WHERE token_hash=?', [challenge.token_hash]);
      return { user };
    });
    if (outcome.error) throw new HttpError(400, outcome.error);
    return outcome.user;
  }
  return {
    async currentUser(req) {
      const token = sessionToken(req);
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      const [user] = await db.query(`SELECT u.id,u.name,u.username,u.role,u.email,u.two_factor_enabled FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.active=1`, [digest(token)]);
      if (!user) return null;
      const permissions = await db.query('SELECT screen_id FROM user_screens WHERE user_id=? ORDER BY screen_id', [user.id]);
      return { ...user, two_factor_enabled: Boolean(user.two_factor_enabled), screens: permissions.map(p => p.screen_id) };
    },
    async login(req, res, input) {
      limit(req, 'login');
      if (typeof input.username !== 'string' || !/^[a-zA-Z0-9._-]{3,64}$/.test(input.username) || typeof input.password !== 'string' || input.password.length > 128) throw new HttpError(401, 'Usuário ou senha incorretos.');
      const [user] = await db.query('SELECT * FROM users WHERE username=?', [input.username.toLowerCase()]);
      const valid = await verifyPassword(input.password, user?.password_hash || dummyHash);
      if (!user?.active || !valid) throw new HttpError(401, 'Usuário ou senha incorretos.');
      if (user.two_factor_enabled) return { two_factor_required: true, ...await issue(user, 'login') };
      await session(req, res, user); return { ok: true };
    },
    async verifyLogin(req, res, input) {
      limit(req, 'verify', 20);
      // A sessão é inserida dentro da transação que consome o código, evitando reuso e corridas.
      const token = randomBytes(32).toString('hex');
      await consume(input, 'login', async (c, user) => {
        if (!user.two_factor_enabled) throw new HttpError(400, 'O 2FA desta conta foi alterado. Entre novamente.');
        await c.execute('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,UTC_TIMESTAMP() + INTERVAL 12 HOUR)', [digest(token), user.id]);
        const previous = sessionToken(req); if (previous) await c.execute('DELETE FROM sessions WHERE token_hash=?', [digest(previous)]);
      });
      res.setHeader('Set-Cookie', cookie(token, 43200)); return { ok: true };
    },
    async forgot(req, input) {
      limit(req, 'forgot', 5);
      if (!validEmail(input.email)) throw new HttpError(400, 'Informe um e-mail válido.');
      const [user] = await db.query('SELECT * FROM users WHERE email=? AND active=1', [input.email.toLowerCase().trim()]);
      if (user) { try { await issue(user, 'reset'); } catch { /* Resposta uniforme: não revela contas nem estado do SMTP. */ } }
      return { ok: true, message: 'Se este e-mail estiver cadastrado, enviaremos um link de recuperação. Confira também o spam.' };
    },
    async reset(req, input) {
      limit(req, 'reset', 10);
      if (!validPassword(input.password)) throw new HttpError(400, 'A senha deve ter entre 8 e 128 caracteres.');
      const hashed = await hashPassword(input.password);
      await consume(input, 'reset', async (c, user) => { await c.execute('UPDATE users SET password_hash=? WHERE id=?', [hashed, user.id]); await c.execute('DELETE FROM sessions WHERE user_id=?', [user.id]); await c.execute('DELETE FROM auth_challenges WHERE user_id=? AND purpose<>?', [user.id, 'reset']); });
      return { ok: true };
    },
    async account(user) { return { email: user.email, two_factor_enabled: user.two_factor_enabled, mail_ready: await mailer.configured() }; },
    async updateEmail(req, actor, input) {
      limit(req, 'profile', 10);
      const user = await passwordUser(actor.id, input.password);
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      if (!validEmail(email)) throw new HttpError(400, 'Informe um e-mail válido.');
      await db.transaction(async c => {
        const [[current]] = await c.execute('SELECT * FROM users WHERE id=? FOR UPDATE', [user.id]);
        if (!current.active || current.password_hash !== user.password_hash) throw new HttpError(401, 'Entre novamente.');
        if (current.two_factor_enabled && current.email !== email) throw new HttpError(409, 'Desative o 2FA antes de alterar seu e-mail.');
        const [[duplicate]] = await c.execute('SELECT id FROM users WHERE email=? AND id<>?', [email, user.id]);
        if (duplicate) throw new HttpError(409, 'Este e-mail já está em uso.');
        await c.execute('UPDATE users SET email=? WHERE id=?', [email, user.id]);
        await c.execute('DELETE FROM auth_challenges WHERE user_id=?', [user.id]);
      }); return { ok: true };
    },
    async updateProfile(req, actor, input) {
      limit(req, 'profile', 10);
      const user = await passwordUser(actor.id, input.current_password);
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() || null : null;
      if (!validText(input.name) || email !== null && !validEmail(email)) throw new HttpError(400, 'Confira o nome e o e-mail.');
      if (input.password && !validPassword(input.password)) throw new HttpError(400, 'A nova senha deve ter entre 8 e 128 caracteres.');
      const hashed = input.password ? await hashPassword(input.password) : null;
      await db.transaction(async c => {
        const [[current]] = await c.execute('SELECT * FROM users WHERE id=? FOR UPDATE', [user.id]);
        if (!current?.active || current.password_hash !== user.password_hash) throw new HttpError(401, 'Entre novamente.');
        if (current.two_factor_enabled && current.email !== email) throw new HttpError(409, 'Desative o 2FA antes de alterar seu e-mail.');
        if (email) { const [[duplicate]] = await c.execute('SELECT id FROM users WHERE email=? AND id<>?', [email, user.id]); if (duplicate) throw new HttpError(409, 'Este e-mail já está em uso.'); }
        await c.execute('UPDATE users SET name=?,email=?,password_hash=COALESCE(?,password_hash) WHERE id=?', [input.name.trim(), email, hashed, user.id]);
        await c.execute('DELETE FROM auth_challenges WHERE user_id=?', [user.id]);
        await c.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [user.id, digest(sessionToken(req) || '')]);
      }); return { ok: true };
    },
    async enableStart(req, actor, input) { limit(req, 'enable', 5); const user = await passwordUser(actor.id, input.password); if (user.two_factor_enabled) throw new HttpError(409, 'O 2FA já está ativo.'); return issue(user, 'enable'); },
    async enableConfirm(req, actor, input) {
      limit(req, 'enable-confirm', 20);
      await consume(input, 'enable', async (c, user) => {
        await c.execute('UPDATE users SET two_factor_enabled=1 WHERE id=?', [user.id]);
        await c.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [user.id, digest(sessionToken(req) || '')]);
        await c.execute('DELETE FROM auth_challenges WHERE user_id=? AND purpose<>?', [user.id, 'enable']);
      }, actor.id); return { ok: true };
    },
    async disable(req, actor, input) {
      limit(req, 'disable', 5); const user = await passwordUser(actor.id, input.password);
      await db.transaction(async c => { const [[current]] = await c.execute('SELECT * FROM users WHERE id=? FOR UPDATE', [user.id]); if (!current.active || current.password_hash !== user.password_hash) throw new HttpError(401, 'Entre novamente.'); await c.execute('UPDATE users SET two_factor_enabled=0 WHERE id=?', [user.id]); await c.execute('DELETE FROM auth_challenges WHERE user_id=?', [user.id]); await c.execute('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [user.id, digest(sessionToken(req) || '')]); }); return { ok: true };
    },
    async logout(req, res) { await db.query('DELETE FROM sessions WHERE token_hash=?', [digest(sessionToken(req) || '')]); res.setHeader('Set-Cookie', cookie('', 0)); },
    async cleanup() { await db.query('DELETE FROM sessions WHERE expires_at<=UTC_TIMESTAMP()'); await db.query('DELETE FROM auth_challenges WHERE expires_at<=UTC_TIMESTAMP()'); for (const [address, history] of attempts) if (history.until < Date.now()) attempts.delete(address); },
  };
}
