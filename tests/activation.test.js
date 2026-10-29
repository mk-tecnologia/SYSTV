import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { createDatabase } from '../src/database.js';
import { migrate } from '../src/migrations.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { issueActivation } from '../src/activation.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const tokenFrom = result => new URLSearchParams(new URL(result.link).hash.slice(1)).get('token');

test('primeiro acesso por link: emissão local, expiração, concorrência e fechamento definitivo', { timeout: 30000 }, async () => {
  const name = 'systv_activation_' + randomBytes(8).toString('hex');
  const options = { ...config.database, user: process.env.TEST_DB_USER || 'root', password: process.env.TEST_DB_PASSWORD || 'root' };
  const admin = await mysql.createConnection({host: options.host, port: options.port, user: options.user, password: options.password});
  let db, app, base;
  const origin = 'https://systv.example';
  const appConfig = { ...config, production: true, password: undefined, origin, secureCookie: true, mailEncryptionKey: 'a'.repeat(64) };
  const fields = { name: 'Responsável', username: 'lojista', password: 'activation-test-password', email: 'loja@example.com' };
  async function start() {
    app = await createApp(db, appConfig);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  const call = (path, data, requestOrigin = origin) => fetch(base + '/api/' + path, {
    ...(data !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin }, body: JSON.stringify(data) } : {}),
  });
  try {
    await admin.query(`CREATE DATABASE ${admin.escapeId(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    db = createDatabase({ ...options, database: name });
    await migrate(db); await seed(db); await start();
    assert.equal((await db.query('SELECT id FROM users')).length, 0);
    assert.deepEqual(await (await call('activation/status')).json(), { required: true });
    assert.equal((await call('activation', { ...fields, token: '0'.repeat(64) })).status, 400);
    assert.equal((await call('activation/issue', {})).status, 401);
    const first = await issueActivation(db, origin), firstToken = tokenFrom(first);
    const row = (await db.query('SELECT token_hash,expires_at FROM initial_setup'))[0];
    assert.ok(row.token_hash === digest(firstToken) && row.token_hash !== firstToken);
    const remaining = new Date(row.expires_at).getTime() - Date.now();
    assert.ok(remaining > 23 * 3600000 && remaining <= 24 * 3600000);
    const page = await fetch(base + new URL(first.link).pathname);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(!(await page.text()).includes(firstToken));
    assert.equal((await call('activation/validate', { token: firstToken }, 'https://other.example')).status, 403);
    assert.equal((await call('activation/validate', { token: firstToken })).status, 200);
    await db.query('UPDATE initial_setup SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND');
    assert.equal((await call('activation', { ...fields, token: firstToken })).status, 400);
    assert.equal((await db.query('SELECT id FROM users')).length, 0);
    const secondToken = tokenFrom(await issueActivation(db, origin));
    assert.equal((await call('activation/validate', { token: firstToken })).status, 400);
    // Reiniciar não perde o link nem cria administrador automaticamente.
    await app.close(); await start();
    assert.equal((await call('activation/validate', { token: secondToken })).status, 200);
    assert.equal((await call('activation', { ...fields, password: 'short', token: secondToken })).status, 400);
    const responses = await Promise.all([
      call('activation', { ...fields, token: secondToken }),
      call('activation', { ...fields, username: 'outro', token: secondToken }),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
    const users = await db.query('SELECT * FROM users');
    assert.equal(users.length, 1);
    assert.equal(users[0].role, 'admin');
    assert.equal(users[0].active, 1);
    assert.ok(users[0].password_hash !== fields.password);
    const setup = (await db.query('SELECT * FROM initial_setup'))[0];
    assert.ok(setup.completed_at);
    assert.equal(setup.token_hash, null); assert.equal(setup.expires_at, null);
    assert.equal((await call('activation', { ...fields, token: secondToken })).status, 400);
    await assert.rejects(() => issueActivation(db, origin), /Já existem contas/);
    const login = await call('login', { username: users[0].username, password: fields.password });
    assert.equal(login.status, 200);
    assert.ok(login.headers.get('set-cookie')?.includes('HttpOnly'));
    const savedHash = users[0].password_hash;
    await app.close(); await migrate(db); await start();
    assert.equal((await db.query('SELECT password_hash FROM users'))[0].password_hash, savedHash);
    assert.deepEqual(await (await call('activation/status')).json(), { required: false });
    // Mesmo uma remoção manual de todas as contas não reabre o primeiro acesso.
    await db.query('DELETE FROM users');
    assert.deepEqual(await (await call('activation/status')).json(), { required: false });
    await assert.rejects(() => issueActivation(db, origin), /Já existem contas/);
  } finally {
    await app?.close(); await db?.close();
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeId(name)}`);
    await admin.end();
  }
});

test('migração preserva administrador, senha e sessão de instalação existente', { timeout: 30000 }, async () => {
  const name = 'systv_activation_legacy_' + randomBytes(8).toString('hex');
  const options = { ...config.database, user: process.env.TEST_DB_USER || 'root', password: process.env.TEST_DB_PASSWORD || 'root' };
  const admin = await mysql.createConnection({ host: options.host, port: options.port, user: options.user, password: options.password });
  let db, app, base;
  const origin = 'https://systv.example';
  async function start(production) {
    app = await createApp(db, { ...config, production, password: production ? 'ignored-new-password' : 'legacy-test-password', origin, secureCookie: true, mailEncryptionKey: 'a'.repeat(64) });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  try {
    await admin.query(`CREATE DATABASE ${admin.escapeId(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    db = createDatabase({ ...options, database: name });
    await migrate(db); await seed(db); await start(false);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ username: 'admin', password: 'legacy-test-password' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const existing = await db.query('SELECT id,username,password_hash,role FROM users');
    await app.close();
    // Reproduz o schema pré-009 somente neste banco descartável.
    await db.query('DROP TABLE initial_setup');
    await db.query("DELETE FROM schema_migrations WHERE version='009_initial_activation.sql'");
    await migrate(db); await start(true);
    assert.deepEqual(await db.query('SELECT id,username,password_hash,role FROM users'), existing);
    const session = await fetch(base + '/api/session', { headers: { Cookie: cookie } });
    assert.equal((await session.json()).authenticated, true);
    assert.deepEqual(await (await fetch(base + '/api/activation/status')).json(), { required: false });
    await assert.rejects(() => issueActivation(db, origin), /Já existem contas/);
  } finally {
    await app?.close(); await db?.close();
    await admin.query(`DROP DATABASE IF EXISTS ${admin.escapeId(name)}`);
    await admin.end();
  }
});
