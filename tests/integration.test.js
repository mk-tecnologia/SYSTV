import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';

test('API com MariaDB real, múltiplas TVs e sessões persistentes', { timeout: 30000 }, async t => {
  const name = `systv_test_${randomBytes(8).toString('hex')}`;
  const admin = await mysql.createConnection({
    host: config.database.host, port: config.database.port,
    user: process.env.TEST_DB_USER || 'root',
    password: process.env.TEST_DB_PASSWORD || 'root',
  });
  let db, app, base, cookie;
  const controllers = [];
  const sentMail = [], smtpOptions = [];
  const mailDependencies = {
    createTransport: options => { smtpOptions.push(options); return { sendMail: async message => { sentMail.push(message); return { messageId: 'local-test' }; }, close() {} }; },
    fetch: async () => ({ ok: true, json: async () => ({ access_token: 'test-oauth-token' }) }),
  };
  async function start() {
    db = createDatabase({ ...config.database, database: name,
      user: process.env.TEST_DB_USER || 'root', password: process.env.TEST_DB_PASSWORD || 'root' });
    app = await createApp(db, { ...config, password: 'integration-password', secureCookie: false, origin: 'https://systv.example', production: false, mailEncryptionKey: 'a'.repeat(64) }, { mail: mailDependencies });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function call(route, method = 'GET', data, authenticated = true, extra = {}) {
    return fetch(`${base}/api/${route}`, {
      method, headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { Cookie: cookie } : {}), ...extra },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
  }
  async function connectTV() {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = response.body.getReader(); let buffer = '';
    return async function next() {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const event = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          if (event.startsWith('data: ')) return JSON.parse(event.slice(6));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('Conexão da TV encerrada antes da atualização.');
        buffer += new TextDecoder().decode(value);
      }
    };
  }
  try {
    await admin.query(`CREATE DATABASE ${admin.escapeId(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    db = createDatabase({ ...config.database, database: name, user: process.env.TEST_DB_USER || 'root', password: process.env.TEST_DB_PASSWORD || 'root' });
    await migrate(db); await migrate(db);
    assert.equal((await db.query('SELECT * FROM schema_migrations')).length, 8);
    assert.equal(await seed(db), true); assert.equal(await seed(db), false);
    await db.close(); db = undefined;
    await start();

    await t.test('páginas, saúde do banco e controle de acesso', async () => {
      assert.equal((await fetch(base)).status, 200);
      assert.equal((await fetch(base + '/tv?screen=tv01')).status, 200);
      assert.deepEqual(await (await call('health')).json(), { status: 'ok', database: 'mariadb' });
      const initial = await (await call('state')).json(); assert.equal(initial.products.length, 24);
      assert.equal((await call('products', 'POST', {}, false)).status, 401);
      assert.equal((await call('login', 'POST', { username: 'admin', password: 'wrong' }, false)).status, 401);
      assert.equal((await call('login', 'POST', { username: 'admin', password: 'integration-password' }, false, { Origin: 'https://externo.example' })).status, 403);
      const login = await call('login', 'POST', { username: 'admin', password: 'integration-password' }, false);
      assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
      const sessions = await db.query('SELECT token_hash FROM sessions');
      assert.notEqual(sessions[0].token_hash, cookie.slice(8));
      assert.equal((await (await call('session')).json()).authenticated, true);
    });

    const product = { name: "Coração d'água 🥩", price: 1234, unit: 'UN', screen: 'tv01', highlight: true, position: 100 };
    let productId;
    await t.test('cores individuais por TV e validação de esquema', async () => {
      const screen = (await (await call('state')).json()).screens.find(screen => screen.id === 'tv01');
      assert.equal(screen.color_scheme, 'classic');
      assert.equal((await call('screens/tv01', 'PUT', { name: screen.name, color_scheme: 'invalid' })).status, 400);
      for (const color_scheme of ['navy', 'graphite', 'forest', 'plum', 'ivory', 'classic']) {
        assert.equal((await call('screens/tv01', 'PUT', { name: screen.name, color_scheme })).status, 200);
        assert.equal((await (await call('state')).json()).screens.find(screen => screen.id === 'tv01').color_scheme, color_scheme);
      }
    });

    await t.test('unidades dinâmicas, validação, sigla em cascata e exclusão protegida', async () => {
      const initial = await (await call('state')).json();
      assert.equal(initial.units.length, 6);
      assert.ok(initial.products.every(product => initial.units.some(unit => unit.code === product.unit)));
      assert.equal((await call('units', 'POST', { code: 'fd', name: 'Fardo' })).status, 200);
      assert.equal((await call('units', 'POST', { code: 'FD', name: 'Duplicada' })).status, 409);
      assert.equal((await call('units', 'POST', { code: 'LONGASIGLA', name: 'Inválida' })).status, 400);
      assert.equal((await call('units', 'POST', { code: 'X', name: '' })).status, 400);
      assert.equal((await call('units', 'POST', { code: 'X', name: 'Sem login' }, false)).status, 401);
      const product = { name: 'Teste fardo', price: 1000, unit: 'FD', screen: 'tv01', highlight: false, position: 100 };
      assert.equal((await call('products', 'POST', { ...product, unit: 'XXX' })).status, 400);
      const saved = await call('products', 'POST', product); assert.equal(saved.status, 200);
      const id = (await saved.json()).id;
      assert.equal((await call('units/FD', 'DELETE')).status, 409);
      assert.equal((await call('units/FD', 'PUT', { code: 'FDO', name: 'Fardo completo' })).status, 200);
      assert.equal((await (await call('state')).json()).products.find(product => product.id === id).unit, 'FDO');
      assert.equal((await call('units/FDO', 'PUT', { code: 'KG', name: 'Duplicada' })).status, 409);
      await call('products/' + id, 'DELETE');
      assert.equal((await call('units/FDO', 'DELETE')).status, 200);
      assert.equal((await call('units/FDO', 'DELETE')).status, 404);
    });

    await t.test('presença real por painel, expiração e múltiplas TVs', async () => {
      const device = '11111111-1111-4111-8111-111111111111';
      const second = '22222222-2222-4222-8222-222222222222';
      const status = async () => (await (await call('screens/status')).json()).find(row => row.id === 'tv01');
      assert.equal((await call('screens/status', 'GET', undefined, false)).status, 401);
      assert.equal((await status()).online, false);
      assert.equal((await call('screens/tv01/heartbeat', 'POST', { device: 'invalid' }, false)).status, 400);
      assert.equal((await call('screens/missing/heartbeat', 'POST', { device }, false)).status, 404);
      assert.equal((await call('screens/tv01/heartbeat', 'POST', { device }, false)).status, 200);
      await call('screens/tv01/heartbeat', 'POST', { device: second }, false);
      assert.equal((await status()).connected_devices, 2);
      await call('screens/tv01/heartbeat', 'POST', { device, disconnected: true }, false);
      assert.equal((await status()).online, true);
      await db.query('UPDATE screen_presence SET last_seen_at = UTC_TIMESTAMP() - INTERVAL 46 SECOND');
      assert.equal((await status()).online, false);
      await call('screens/tv01/heartbeat', 'POST', { device: second }, false);
      assert.equal((await status()).online, true);
      await call('screens/tv01/heartbeat', 'POST', { device: second, disconnected: true }, false);
      assert.equal((await status()).online, false);
    });

    await t.test('validação, centavos e atualização simultânea de duas TVs', async () => {
      const nextTV1 = await connectTV(); const nextTV2 = await connectTV();
      assert.equal((await nextTV1()).products.length, 24); await nextTV2();
      for (const invalid of [{ price: -1 }, { price: 12.34 }, { unit: 'INVALID' }, { screen: 'missing' }, { position: -1 }]) {
        assert.equal((await call('products', 'POST', { ...product, ...invalid })).status, 400);
      }
      const saved = await call('products', 'POST', product); assert.equal(saved.status, 200);
      productId = (await saved.json()).id;
      for (const next of [nextTV1, nextTV2]) {
        const update = await next();
        assert.equal(update.products.find(p => p.id === productId).name, product.name);
        assert.equal(update.products.find(p => p.id === productId).price, 1234);
      }
      assert.equal((await call('products', 'PUT', { ...product, id: productId, price: 5678 })).status, 200);
      for (const next of [nextTV1, nextTV2]) assert.equal((await next()).products.find(p => p.id === productId).price, 5678);
      // Salvar sem alterar os valores também é uma operação válida no MariaDB.
      assert.equal((await call('products', 'PUT', { ...product, id: productId, price: 5678 })).status, 200);
      for (const controller of controllers) controller.abort();
    });

    await t.test('dados e sessão continuam válidos ao reiniciar a aplicação', async () => {
      await app.close(); app = undefined; await db.close(); db = undefined;
      await start();
      assert.equal((await (await call('state')).json()).products.find(p => p.id === productId).price, 5678);
      assert.equal((await (await call('session')).json()).authenticated, true);
      assert.equal(await seed(db), false);
      assert.equal((await (await call('state')).json()).products.find(p => p.id === productId).price, 5678);
    });

    await t.test('usuários, permissões por TV e bloqueio de acesso direto à API', async () => {
      const extraScreen = (await (await call('screens', 'POST', { name: 'TV restrita' })).json()).id;
      const restrictedId = (await (await call('products', 'POST', { ...product, screen: extraScreen })).json()).id;
      const editor = { name: 'Operador', username: 'operador', password: 'editor-password', role: 'editor', active: true, screens: ['tv01'] };
      const saved = await call('users', 'POST', editor); assert.equal(saved.status, 200);
      const userId = (await saved.json()).id;
      assert.equal((await call('users', 'POST', editor)).status, 409);
      assert.equal((await call('users', 'POST', { ...editor, username: 'invalidtv', screens: ['missing'] })).status, 400);
      const list = await (await call('users')).json();
      assert.ok(list.every(user => !('password_hash' in user)));
      const [stored] = await db.query('SELECT password_hash FROM users WHERE id=?', [userId]);
      assert.ok(stored.password_hash.startsWith('scrypt:')); assert.notEqual(stored.password_hash, editor.password);
      const login = await call('login', 'POST', { username: editor.username, password: editor.password }, false);
      assert.equal(login.status, 200); let editorCookie = login.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('units', 'POST', { code: 'FD', name: 'Fardo' }, false, { Cookie: editorCookie })).status, 403);
      assert.equal((await call('units/KG', 'PUT', { code: 'KG', name: 'Alterada' }, false, { Cookie: editorCookie })).status, 403);
      assert.equal((await call('units/KG', 'DELETE', undefined, false, { Cookie: editorCookie })).status, 403);
      const asEditor = (route, method='GET', data) => call(route, method, data, false, { Cookie: editorCookie });
      assert.deepEqual((await (await asEditor('session')).json()).user.screens, ['tv01']);
      assert.equal((await asEditor('products', 'PUT', { ...product, id: productId, price: 5678 })).status, 200);
      assert.equal((await asEditor('products', 'POST', { ...product, screen: extraScreen })).status, 403);
      assert.equal((await asEditor('products', 'PUT', { ...product, id: restrictedId })).status, 403);
      assert.equal((await asEditor('products', 'PUT', { ...product, id: productId, screen: extraScreen })).status, 403);
      assert.equal((await asEditor('products/' + restrictedId, 'DELETE')).status, 403);
      assert.equal((await asEditor('users')).status, 403);
      assert.equal((await asEditor('users', 'POST', { ...editor, username: 'newadmin', role: 'admin' })).status, 403);
      assert.equal((await asEditor('users/' + list.find(u => u.role === 'admin').id, 'DELETE')).status, 403);
      assert.equal((await asEditor('settings', 'PUT', { name: 'Inválido', message: 'Inválido' })).status, 403);
      assert.equal((await asEditor('screens', 'POST', { name: 'Inválida' })).status, 403);
      assert.equal((await asEditor('screens/tv01', 'PUT', { name: 'Nome não permitido' })).status, 403);
      assert.equal((await asEditor('screens/' + extraScreen, 'DELETE')).status, 403);
      assert.equal((await asEditor('logos/left', 'DELETE')).status, 403);
      const adminUser = list.find(u => u.role === 'admin');
      assert.equal((await call('users/' + adminUser.id, 'DELETE')).status, 409);
      assert.equal((await call('users', 'PUT', { ...adminUser, active: false })).status, 409);
      assert.equal((await call('users', 'PUT', { ...adminUser, role: 'editor' })).status, 409);

      await call('users', 'PUT', { ...editor, id: userId, password: '', screens: [] });
      assert.equal((await (await asEditor('session')).json()).authenticated, false);
      const renewed = await call('login', 'POST', { username: editor.username, password: editor.password }, false);
      editorCookie = renewed.headers.get('set-cookie').split(';')[0];
      assert.deepEqual((await (await asEditor('session')).json()).user.screens, []);
      assert.equal((await asEditor('products', 'PUT', { ...product, id: productId })).status, 403);
      await call('users', 'PUT', { ...editor, id: userId, password: '', active: false });
      assert.equal((await (await asEditor('session')).json()).authenticated, false);
      assert.equal((await call('login', 'POST', { username: editor.username, password: editor.password }, false)).status, 401);
      await call('users', 'PUT', { ...editor, id: userId, password: 'new-password' });
      assert.equal((await call('login', 'POST', { username: editor.username, password: editor.password }, false)).status, 401);
      assert.equal((await call('login', 'POST', { username: editor.username, password: 'new-password' }, false)).status, 200);
      assert.equal((await call('users/' + userId, 'DELETE')).status, 200);
      assert.equal((await db.query('SELECT user_id FROM sessions WHERE user_id=?', [userId])).length, 0);
      await call('screens/' + extraScreen, 'DELETE');
    });

    await t.test('renomear TV preserva produtos, identificadores e permissões e envia SSE', async () => {
      const before = await (await call('state')).json();
      const next = await connectTV(); await next();
      const saved = await call('screens/tv01', 'PUT', { name: 'Balcão do açougue' });
      assert.equal(saved.status, 200); assert.equal((await saved.json()).id, 'tv01');
      const update = await next(); assert.equal(update.screens.find(s => s.id === 'tv01').name, 'Balcão do açougue');
      assert.deepEqual(update.products, before.products);
      assert.equal((await call('screens/tv01', 'PUT', { name: 'TV02' })).status, 400);
      assert.equal((await call('screens', 'POST', { name: 'TV 02' })).status, 400);
      assert.equal((await call('screens', 'POST', { name: 'balcão do açougue' })).status, 409);
      const other = (await (await call('screens', 'POST', { name: 'Entrada da loja' })).json()).id;
      assert.equal((await call('screens/' + other, 'PUT', { name: 'Balcão do açougue' })).status, 409);
      assert.equal((await call('screens/missing', 'PUT', { name: 'Outra localização' })).status, 404);
      await call('screens/' + other, 'DELETE');
      for (const controller of controllers) controller.abort();
    });

    await t.test('intervalo de páginas por TV, validação e atualização por SSE', async () => {
      const before = await (await call('state')).json();
      const name = before.screens.find(screen => screen.id === 'tv01').name;
      assert.equal(before.screens.find(screen => screen.id === 'tv01').page_interval_seconds, 15);
      const next = await connectTV(); await next();
      assert.equal((await call('screens/tv01', 'PUT', { name, page_interval_seconds: 30 })).status, 200);
      assert.equal((await next()).screens.find(screen => screen.id === 'tv01').page_interval_seconds, 30);
      assert.equal((await call('screens/tv01', 'PUT', { name })).status, 200);
      assert.equal((await next()).screens.find(screen => screen.id === 'tv01').page_interval_seconds, 30);
      for (const seconds of [0, 4, 301, 15.5, '30', null]) {
        assert.equal((await call('screens/tv01', 'PUT', { name, page_interval_seconds: seconds })).status, 400);
      }
      const response = await call('screens', 'POST', { name: 'Setor de frutas', page_interval_seconds: 45 });
      assert.equal(response.status, 200); const id = (await response.json()).id;
      const update = await next();
      assert.equal(update.screens.find(screen => screen.id === id).page_interval_seconds, 45);
      assert.equal(update.screens.find(screen => screen.id === 'tv01').page_interval_seconds, 30);
      assert.equal((await db.query('SELECT page_interval_seconds FROM screens WHERE id=?', ['tv01']))[0].page_interval_seconds, 30);
      await call('screens/' + id, 'DELETE');
      for (const controller of controllers) controller.abort();
    });

    await t.test('nome e duas logos, redimensionamento real e atualização por SSE', async () => {
      const next = await connectTV(); await next();
      const name = 'Mercado e Açougue da Família';
      assert.equal((await call('settings', 'PUT', { name, message: 'Bem-vindo!' })).status, 200);
      assert.equal((await next()).settings.name, name);
      const image = await sharp({ create: { width: 2400, height: 1200, channels: 4, background: '#009e93' } }).png().toBuffer();
      const upload = (side, data, mime = 'image/png') => fetch(`${base}/api/logos/${side}`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': mime }, body: data });
      assert.equal((await upload('left', Buffer.from('<svg></svg>'))).status, 415);
      assert.equal((await upload('left', image, 'image/svg+xml')).status, 415);
      assert.equal((await upload('left', Buffer.alloc(5 * 1024 * 1024 + 1))).status, 413);
      assert.equal((await upload('left', image)).status, 200);
      const leftState = await next(); assert.ok(leftState.settings.left_logo); assert.equal(leftState.settings.right_logo, null);
      assert.equal((await upload('right', image)).status, 200);
      const both = await next(); assert.ok(both.settings.right_logo);
      for (const url of [both.settings.left_logo, both.settings.right_logo]) {
        const response = await fetch(base + url); assert.equal(response.headers.get('content-type'), 'image/png');
        const resized = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
        assert.equal(resized.width, 640); assert.equal(resized.height, 320);
      }
      const previous = both.settings.left_logo;
      const replacement = await sharp({ create: { width: 1200, height: 2400, channels: 4, background: '#ffffff' } }).png().toBuffer();
      assert.equal((await upload('left', replacement)).status, 200);
      const changed = await next(); assert.notEqual(changed.settings.left_logo, previous);
      const imageResponse = await fetch(base + changed.settings.left_logo);
      const portrait = await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();
      assert.equal(portrait.width, 160); assert.equal(portrait.height, 320);
      assert.equal((await call('logos/left', 'DELETE')).status, 200);
      const removed = await next(); assert.equal(removed.settings.left_logo, null); assert.ok(removed.settings.right_logo);
      assert.equal((await fetch(base + '/api/logos/left')).status, 404);
      for (const controller of controllers) controller.abort();
    });

    await t.test('catálogos independentes, exclusão em cascata e proteção da última TV', async () => {
      const response = await call('screens', 'POST', { name: 'TV 02 · Balcão' });
      const screen = (await response.json()).id;
      const saved = await call('products', 'POST', { ...product, screen });
      const secondId = (await saved.json()).id;
      const state = await (await call('state')).json();
      assert.equal(state.products.filter(p => p.screen === screen).length, 1);
      assert.equal(state.products.filter(p => p.screen === 'tv01').length, 25);
      const deletions = await Promise.all([call(`screens/${screen}`, 'DELETE'), call('screens/tv01', 'DELETE')]);
      assert.deepEqual(deletions.map(r => r.status).sort(), [200, 409]);
      const after = await (await call('state')).json(); assert.equal(after.screens.length, 1);
      assert.ok(after.products.every(p => p.screen === after.screens[0].id));
      if (after.screens[0].id === 'tv01') assert.ok(!after.products.some(p => p.id === secondId));
      assert.equal((await call(`screens/${after.screens[0].id}`, 'DELETE')).status, 409);
    });

    await t.test('SMTP protegido, Gmail/Microsoft, recuperação e 2FA opcional escolhido pelo usuário', async () => {
      // Reiniciar limpa apenas o rate limit em memória, preservando a sessão MariaDB do administrador.
      await app.close(); await db.close(); await start();
      assert.equal((await call('mail-settings', 'GET', undefined, false)).status, 401);
      const relay = { enabled: true, provider: 'custom', host: '127.0.0.1', port: 1025, security: 'none', auth: 'none', username: '', from_email: 'systv@example.com', from_name: 'SYSTV', client_id: '', tenant_id: '' };
      assert.equal((await call('mail-settings', 'PUT', { ...relay, auth: 'password', username: 'smtp@example.com', password: 'secret' })).status, 400);
      const gmail = { ...relay, provider: 'gmail', security: 'starttls', port: 587, auth: 'password', username: 'sender@example.com', password: 'app-password-secret' };
      assert.equal((await call('mail-settings', 'PUT', gmail)).status, 200);
      const stored = await (await call('mail-settings')).json(); assert.equal(stored.host, 'smtp.gmail.com'); assert.equal(stored.stored_secrets.password, true); assert.equal(stored.password, undefined);
      assert.ok(!(await db.query('SELECT secrets_encrypted FROM mail_settings'))[0].secrets_encrypted.includes('app-password-secret'));
      assert.equal((await call('mail-settings', 'PUT', { ...gmail, password: '' })).status, 200);
      assert.equal((await call('mail-settings/test', 'POST', { email: 'receiver@example.com' })).status, 200);
      assert.equal(smtpOptions.at(-1).auth.pass, 'app-password-secret'); assert.equal(smtpOptions.at(-1).requireTLS, true);
      assert.equal((await call('mail-settings', 'PUT', { ...gmail, username: 'other@example.com', password: '' })).status, 400);
      assert.equal((await call('mail-settings', 'PUT', { ...gmail, auth: 'oauth', password: '', client_id: 'google-app', client_secret: 'oauth-secret', refresh_token: 'refresh-secret' })).status, 200);
      await call('mail-settings/test', 'POST', { email: 'receiver@example.com' }); assert.equal(smtpOptions.at(-1).auth.type, 'OAuth2');
      assert.equal((await call('mail-settings', 'PUT', { ...gmail, provider: 'microsoft' })).status, 400);
      assert.equal((await call('mail-settings', 'PUT', { ...gmail, provider: 'microsoft', auth: 'microsoft-app', tenant_id: '11111111-1111-4111-8111-111111111111', client_id: 'app-id', client_secret: 'ms-secret' })).status, 200);
      await call('mail-settings/test', 'POST', { email: 'receiver@example.com' }); assert.equal(smtpOptions.at(-1).host, 'smtp.office365.com'); assert.equal(smtpOptions.at(-1).auth.accessToken, 'test-oauth-token');
      assert.equal((await call('mail-settings', 'PUT', { ...gmail, provider: 'microsoft', microsoft_account: 'personal', auth: 'oauth', client_id: 'personal-app', client_secret: 'ms-secret', refresh_token: 'refresh-secret' })).status, 200);
      await call('mail-settings/test', 'POST', { email: 'receiver@example.com' }); assert.equal(smtpOptions.at(-1).host, 'smtp-mail.outlook.com');
      assert.equal((await call('mail-settings', 'PUT', relay)).status, 200);
      const input = { name: 'Conta segura', username: 'secureuser', email: 'user@example.com', password: 'secure-password', role: 'editor', active: true, screens: [(await (await call('state')).json()).screens[0].id] };
      const created = await call('users', 'POST', input); assert.equal(created.status, 200); const id = (await created.json()).id;
      assert.equal((await call('users', 'POST', { ...input, username: 'duplicate' })).status, 409);
      const logged = await call('login', 'POST', { username: input.username, password: input.password }, false); assert.equal(logged.status, 200);
      const accountCookie = logged.headers.get('set-cookie').split(';')[0];
      const own = (route, method='GET', data) => call(route, method, data, false, { Cookie: accountCookie });
      assert.equal((await (await own('account')).json()).two_factor_enabled, false);
      assert.equal((await own('mail-settings')).status, 403);
      assert.equal((await own('mail-settings', 'PUT', relay)).status, 403);
      assert.equal((await own('account/email', 'PUT', { email: 'bad', password: input.password })).status, 400);
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: input.email, current_password: 'wrong' })).status, 400);
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: input.email, current_password: input.password, role: 'admin' })).status, 200);
      const ownProfile = (await (await own('session')).json()).user; assert.equal(ownProfile.name, 'Atualizada'); assert.equal(ownProfile.role, 'editor');
      const enable = await own('account/2fa/start', 'POST', { password: input.password }); assert.equal(enable.status, 200); const enabling = await enable.json();
      const enableCode = sentMail.at(-1).text.match(/\b[0-9]{6}\b/)[0];
      assert.equal((await own('account/2fa/confirm', 'POST', { challenge: enabling.challenge, code: 'abcdef' })).status, 400);
      assert.equal((await db.query("SELECT attempts FROM auth_challenges WHERE purpose='enable'"))[0].attempts, 1);
      await db.query("UPDATE auth_challenges SET expires_at=UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE purpose='enable'");
      assert.equal((await own('account/2fa/confirm', 'POST', { challenge: enabling.challenge, code: enableCode })).status, 400);
      await db.query("UPDATE auth_challenges SET expires_at=UTC_TIMESTAMP() + INTERVAL 10 MINUTE WHERE purpose='enable'");
      assert.equal((await own('account/2fa/confirm', 'POST', { challenge: enabling.challenge, code: enableCode })).status, 200);
      assert.equal((await own('account/2fa/confirm', 'POST', { challenge: enabling.challenge, code: enableCode })).status, 400);
      assert.equal((await own('account/email', 'PUT', { email: 'different@example.com', password: input.password })).status, 409);
      assert.equal((await call('users', 'PUT', { ...input, id, email: 'different@example.com', password: '' })).status, 409);
      assert.equal((await call('mail-settings', 'PUT', { ...relay, enabled: false })).status, 409);
      const challengeResponse = await call('login', 'POST', { username: input.username, password: input.password }, false);
      assert.equal(challengeResponse.headers.get('set-cookie'), null); const challenge = await challengeResponse.json(); assert.equal(challenge.two_factor_required, true);
      const code = sentMail.at(-1).text.match(/\b[0-9]{6}\b/)[0];
      for (let i=0;i<5;i++) assert.equal((await call('login/verify', 'POST', { challenge: challenge.challenge, code: 'invalid' }, false)).status, 400);
      assert.equal((await call('login/verify', 'POST', { challenge: challenge.challenge, code }, false)).status, 400);
      await db.query("UPDATE auth_challenges SET created_at=UTC_TIMESTAMP() - INTERVAL 31 SECOND WHERE purpose='login'");
      const renewed = await (await call('login', 'POST', { username: input.username, password: input.password }, false)).json();
      const goodCode = sentMail.at(-1).text.match(/\b[0-9]{6}\b/)[0];
      const verified = await call('login/verify', 'POST', { challenge: renewed.challenge, code: goodCode }, false); assert.equal(verified.status, 200); assert.ok(verified.headers.get('set-cookie'));
      assert.equal((await call('login/verify', 'POST', { challenge: renewed.challenge, code: goodCode }, false)).status, 400);
      assert.equal((await own('account/2fa/disable', 'POST', { password: 'wrong' })).status, 400);
      assert.equal((await own('account/2fa/disable', 'POST', { password: input.password })).status, 200);
      assert.equal((await (await own('account')).json()).two_factor_enabled, false);
      await db.query('UPDATE users SET two_factor_enabled=1 WHERE id=?', [id]);
      const unknown = await (await call('password/forgot', 'POST', { email: 'unknown@example.com' }, false)).json();
      const known = await (await call('password/forgot', 'POST', { email: input.email }, false)).json(); assert.deepEqual(known, unknown);
      const reset = sentMail.at(-1).text.match(/#reset=([a-f0-9]{64})/)[1];
      await db.query("UPDATE auth_challenges SET expires_at=UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE purpose='reset'");
      assert.equal((await call('password/reset', 'POST', { challenge: reset, password: 'new-secure-password' }, false)).status, 400);
      await db.query("UPDATE auth_challenges SET expires_at=UTC_TIMESTAMP() + INTERVAL 10 MINUTE WHERE purpose='reset'");
      assert.equal((await call('password/reset', 'POST', { challenge: reset, password: 'new-secure-password' }, false)).status, 200);
      assert.equal((await call('password/reset', 'POST', { challenge: reset, password: 'other-password' }, false)).status, 400);
      assert.equal((await (await own('session')).json()).authenticated, false);
      assert.equal((await db.query('SELECT two_factor_enabled FROM users WHERE id=?', [id]))[0].two_factor_enabled, 1);
      await call('users/' + id, 'DELETE');
      assert.equal((await call('mail-settings', 'PUT', { ...relay, enabled: false })).status, 200);
    });

    await t.test('logout revoga a sessão persistida', async () => {
      assert.equal((await call('logout', 'POST', {})).status, 200);
      assert.equal((await (await call('session')).json()).authenticated, false);
      assert.equal((await call('settings', 'PUT', { name: 'X', message: 'Y' })).status, 401);
    });
  } finally {
    for (const controller of controllers) controller.abort();
    await app?.close(); await db?.close();
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeId(name)}`);
    await admin.end();
  }
});
