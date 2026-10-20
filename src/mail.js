import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { validEmail } from './email.js';
import nodemailer from 'nodemailer';
import { HttpError, validText } from './http.js';
import { requireAdmin, requireCurrentAdmin } from './users.js';


const secretFields = ['password', 'client_secret', 'refresh_token'];
export function createMailer(db, config, dependencies = {}) {
  const key = config.mailEncryptionKey;
  const getKey = () => { if (!/^[a-f0-9]{64}$/i.test(key || '')) throw new HttpError(503, 'Configure MAIL_ENCRYPTION_KEY no servidor antes de salvar credenciais de e-mail.'); return Buffer.from(key, 'hex'); };
  function encrypt(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', getKey(), iv); const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return [iv, cipher.getAuthTag(), bytes].map(v => v.toString('base64')).join('.'); }
  function decrypt(value) { if (!value) return {}; const [iv, tag, bytes] = value.split('.').map(v => Buffer.from(v, 'base64')); const cipher = createDecipheriv('aes-256-gcm', getKey(), iv); cipher.setAuthTag(tag); return JSON.parse(Buffer.concat([cipher.update(bytes), cipher.final()]).toString()); }
  async function load() { const [row] = await db.query('SELECT config_json,secrets_encrypted FROM mail_settings WHERE id=1'); return row ? { settings: { microsoft_account: 'business', ...JSON.parse(row.config_json) }, secrets: decrypt(row.secrets_encrypted) } : { settings: { enabled: false, provider: 'custom', microsoft_account: 'business', host: '', port: 587, security: 'starttls', auth: 'password', username: '', from_email: '', from_name: 'SYSTV', client_id: '', tenant_id: '' }, secrets: {} }; }
  async function oauth(settings, secrets) {
    const google = settings.provider === 'gmail';
    const endpoint = google ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${encodeURIComponent(settings.tenant_id || 'common')}/oauth2/v2.0/token`;
    const params = new URLSearchParams({ client_id: settings.client_id, client_secret: secrets.client_secret, grant_type: settings.auth === 'microsoft-app' ? 'client_credentials' : 'refresh_token' });
    if (settings.auth === 'microsoft-app') params.set('scope', 'https://outlook.office365.com/.default');
    else params.set('refresh_token', secrets.refresh_token);
    const response = await (dependencies.fetch || fetch)(endpoint, { method: 'POST', body: params, signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw new HttpError(502, 'Não foi possível autenticar no provedor OAuth. Confira as credenciais e permissões do aplicativo.');
    if (data.refresh_token && data.refresh_token !== secrets.refresh_token) {
      await db.transaction(async c => { const [[row]] = await c.execute('SELECT config_json,secrets_encrypted FROM mail_settings WHERE id=1 FOR UPDATE'); if (row && row.secrets_encrypted && JSON.stringify(JSON.parse(row.config_json)) === JSON.stringify(settings)) { const latest = decrypt(row.secrets_encrypted); if (latest.refresh_token === secrets.refresh_token) { latest.refresh_token = data.refresh_token; await c.execute('UPDATE mail_settings SET secrets_encrypted=? WHERE id=1', [encrypt(latest)]); } } });
    }
    return data.access_token;
  }
  async function send(to, subject, text) {
    const { settings, secrets } = await load();
    if (!settings.enabled) throw new HttpError(503, 'O envio de e-mails ainda não está configurado. Solicite ao administrador.');
    if (!validEmail(to)) throw new HttpError(400, 'E-mail de destino inválido.');
    let auth;
    if (settings.auth === 'password') auth = { user: settings.username, pass: secrets.password };
    else if (settings.auth !== 'none') auth = { type: 'OAuth2', user: settings.username, accessToken: await oauth(settings, secrets) };
    const transport = (dependencies.createTransport || nodemailer.createTransport)({ host: settings.host, port: settings.port, secure: settings.security === 'tls', requireTLS: settings.security === 'starttls', ignoreTLS: settings.security === 'none', auth, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false });
    try { return await transport.sendMail({ from: { name: settings.from_name, address: settings.from_email }, to, subject, text, disableFileAccess: true, disableUrlAccess: true }); }
    catch { throw new HttpError(502, 'Falha no envio SMTP. Confira servidor, porta, autenticação e permissões do remetente.'); }
    finally { transport.close(); }
  }
  return {
    send,
    async configured() { return (await load()).settings.enabled === true; },
    async get(actor) { requireAdmin(actor); const { settings, secrets } = await load(); return { ...settings, stored_secrets: Object.fromEntries(secretFields.map(field => [field, Boolean(secrets[field])])) }; },
    async save(input, actor) {
      requireAdmin(actor);
      const settings = {};
      for (const field of ['provider','host','security','auth','username','from_email','from_name','client_id','tenant_id','microsoft_account']) settings[field] = typeof input[field] === 'string' ? input[field].trim() : '';
      settings.microsoft_account = input.microsoft_account || 'business';
      if (!['business','personal'].includes(settings.microsoft_account)) throw new HttpError(400, 'Selecione o tipo de conta Microsoft.');
      settings.enabled = input.enabled === true; settings.port = Number(input.port);
      if (!['custom','gmail','microsoft'].includes(settings.provider) || !['tls','starttls','none'].includes(settings.security) || !['password','none','oauth','microsoft-app'].includes(settings.auth) || !Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) throw new HttpError(400, 'Confira provedor, porta e autenticação.');
      if (settings.auth === 'microsoft-app' && settings.provider !== 'microsoft' || settings.auth === 'oauth' && settings.provider === 'custom') throw new HttpError(400, 'OAuth está disponível para Gmail e Microsoft.');
      if (settings.provider === 'gmail') { settings.host = 'smtp.gmail.com'; if (!['password','oauth'].includes(settings.auth)) throw new HttpError(400, 'Gmail exige senha de aplicativo ou OAuth.'); }
      if (settings.provider === 'microsoft') { settings.host = settings.microsoft_account === 'personal' ? 'smtp-mail.outlook.com' : 'smtp.office365.com';
        if (settings.microsoft_account === 'personal') { settings.tenant_id = 'consumers'; if (settings.auth !== 'oauth') throw new HttpError(400, 'Outlook pessoal exige OAuth por consentimento do usuário.'); } if (!['oauth','microsoft-app'].includes(settings.auth)) throw new HttpError(400, 'Use OAuth para autenticação Microsoft.'); }
      if (!validText(settings.host, 253) || !/^[a-zA-Z0-9.-]+$/.test(settings.host) || !validEmail(settings.from_email) || !validText(settings.from_name, 120)) throw new HttpError(400, 'Informe servidor, nome e e-mail do remetente.');
      if (settings.security === 'none' && (settings.provider !== 'custom' || settings.auth !== 'none')) throw new HttpError(400, 'Credenciais exigem uma conexão TLS. Sem TLS é permitido apenas para relay local sem autenticação.');
      if (settings.auth !== 'none' && (settings.provider === 'custom' ? !validText(settings.username, 254) : !validEmail(settings.username))) throw new HttpError(400, 'Informe o e-mail da conta SMTP.');
      if (settings.auth === 'oauth' || settings.auth === 'microsoft-app') {
        if (settings.auth === 'microsoft-app' && !/^[a-f0-9-]{36}$/i.test(settings.tenant_id)) throw new HttpError(400, 'OAuth de aplicativo exige o ID do diretório Microsoft empresarial.');
        if (!validText(settings.client_id, 200) || settings.provider === 'microsoft' && !/^(common|organizations|consumers|[a-f0-9-]{36})$/i.test(settings.tenant_id)) throw new HttpError(400, 'Confira Client ID e Tenant ID do aplicativo.');
      }
      await db.transaction(async c => {
        await c.execute('SELECT id FROM settings WHERE id=1 FOR UPDATE'); await requireCurrentAdmin(c, actor);
        const [[row]] = await c.execute('SELECT config_json,secrets_encrypted FROM mail_settings WHERE id=1 FOR UPDATE');
        const previous = row ? JSON.parse(row.config_json) : {};
        const sameAccount = ['provider','auth','username','client_id','tenant_id','microsoft_account'].every(field => previous[field] === settings[field]);
        const secrets = sameAccount && row ? decrypt(row.secrets_encrypted) : {};
        for (const field of secretFields) { if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 12000)) throw new HttpError(400, 'Credencial inválida.'); if (input[field]) secrets[field] = input[field]; }
        if (settings.enabled && (settings.auth === 'password' && !secrets.password || settings.auth !== 'none' && settings.auth !== 'password' && (!secrets.client_secret || settings.auth === 'oauth' && !secrets.refresh_token))) throw new HttpError(400, 'Preencha as credenciais necessárias para ativar o envio.');
        if (!settings.enabled) { const [[used]] = await c.execute('SELECT id FROM users WHERE two_factor_enabled=1 AND active=1 LIMIT 1'); if (used) throw new HttpError(409, 'Há usuários com 2FA ativo. Desative o 2FA dessas contas antes de desligar os e-mails.'); }
        await c.execute('INSERT INTO mail_settings (id,config_json,secrets_encrypted) VALUES (1,?,?) ON DUPLICATE KEY UPDATE config_json=VALUES(config_json),secrets_encrypted=VALUES(secrets_encrypted)', [JSON.stringify(settings), Object.keys(secrets).length ? encrypt(secrets) : null]);
      });
    },
    async test(input, actor) { requireAdmin(actor); if (!validEmail(input.email)) throw new HttpError(400, 'Informe o e-mail que receberá o teste.'); await send(input.email, 'SYSTV · Teste de envio', 'A configuração SMTP do SYSTV enviou este e-mail de teste com sucesso.'); },
  };
}
