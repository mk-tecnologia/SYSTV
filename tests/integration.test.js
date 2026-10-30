import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
    app = await createApp(db, { ...config, password: 'integration-password', secureCookie: false, origin: 'https://systv.example', production: false, mailEncryptionKey: 'a'.repeat(64) }, { mail: mailDependencies, version: { fetch: async () => ({ ok: true, json: async () => ({ tag_name: 'v99.0.0' }) }) } });
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
    assert.equal((await db.query('SELECT * FROM schema_migrations')).length, 12);
    assert.equal(await seed(db), true); assert.equal(await seed(db), false);
    await db.close(); db = undefined;
    await start();

    await t.test('páginas, saúde do banco e controle de acesso', async () => {
      assert.equal((await fetch(base)).status, 200);
      assert.equal((await fetch(base + '/tv?screen=tv01')).status, 200);
      assert.equal((await fetch(base + '/tv-presence.js')).status, 200);
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

    await t.test('novo administrador consegue entrar e acessar a administração', async () => {
      const input = { name: 'Segundo administrador', username: 'Admin.Teste', password: 'Teste-á_10:seguro', role: 'admin', active: true, screens: [] };
      const created = await call('users', 'POST', input);
      assert.equal(created.status, 200);
      const { id } = await created.json();
      const login = await call('login', 'POST', { username: input.username, password: input.password }, false);
      assert.equal(login.status, 200);
      const newCookie = login.headers.get('set-cookie').split(';')[0];
      const session = await (await call('session', 'GET', undefined, false, { Cookie: newCookie })).json();
      assert.equal(session.authenticated, true);
      assert.equal(session.user.id, id);
      assert.equal(session.user.role, 'admin');
      assert.equal((await call('users', 'GET', undefined, false, { Cookie: newCookie })).status, 200);
      assert.equal((await call('users/' + id, 'DELETE')).status, 200);
      assert.equal((await (await call('session', 'GET', undefined, false, { Cookie: newCookie })).json()).authenticated, false);
    });

    await t.test('ordem única por TV ao inserir, mover, excluir e salvar simultaneamente', async () => {
      const screen = (await (await call('screens', 'POST', { name: 'Catálogo de ordenação' })).json()).id;
      const other = (await (await call('screens', 'POST', { name: 'Catálogo de destino' })).json()).id;
      const data = (name, position, screenId = screen) => ({ name, position, screen: screenId, price: 100, unit: 'UN', highlight: false });
      const add = async (name, position) => {
        const response = await call('products', 'POST', data(name, position));
        assert.equal(response.status, 200);
        return (await response.json()).id;
      };
      const ordered = async (screenId = screen) => {
        const rows = (await (await call('state')).json()).products.filter(p => p.screen === screenId).sort((a,b) => a.position-b.position);
        assert.deepEqual(rows.map(p => p.position), rows.map((_,i) => i));
        return rows.map(p => p.id);
      };
      const a = await add('A', 100), b = await add('B', 100), c = await add('C', 100);
      assert.deepEqual(await ordered(), [a,b,c]);
      assert.equal((await call('products', 'PUT', { ...data('C',0), id:c })).status, 200);
      assert.deepEqual(await ordered(), [c,a,b]);
      assert.equal((await call('products', 'PUT', { ...data('C',2), id:c })).status, 200);
      assert.deepEqual(await ordered(), [a,b,c]);
      const d = await add('D', 1);
      assert.deepEqual(await ordered(), [a,d,b,c]);
      const move = (id, position, extra = {}) => call('products/' + id + '/position', 'PUT', { screen, position, ...extra });
      assert.equal((await move(c,0,{price:99999,name:'Não alterar'})).status,200);
      assert.deepEqual(await ordered(), [c,a,d,b]);
      const moved = (await (await call('state')).json()).products.find(p => p.id===c);
      assert.equal(moved.price,100); assert.equal(moved.name,'C');
      assert.equal((await move(c,1,{screen:other})).status,409);
      assert.deepEqual(await ordered(), [c,a,d,b]);
      assert.equal((await move(c,-1)).status,400);
      assert.equal((await call('products/' + c + '/position','PUT',{screen,position:1},false)).status,401);
      assert.equal((await move(c,3)).status,200);
      assert.deepEqual(await ordered(), [a,d,b,c]);
      assert.equal((await call('products', 'PUT', { ...data('D',1), id:d, price:250 })).status, 200);
      assert.deepEqual(await ordered(), [a,d,b,c]);
      assert.equal((await call('products', 'PUT', { ...data('D',0,other.toUpperCase()), id:d })).status, 200);
      assert.deepEqual(await ordered(), [a,b,c]);
      assert.deepEqual(await ordered(other), [d]);
      assert.equal((await call('products/' + b, 'DELETE')).status, 200);
      assert.deepEqual(await ordered(), [a,c]);
      const [e,f] = await Promise.all([add('E',1),add('F',1)]);
      const result = await ordered();
      assert.deepEqual([result[0],result[3]], [a,c]);
      assert.deepEqual(new Set(result.slice(1,3)), new Set([e,f]));
      await assert.rejects(db.query('UPDATE products SET position=0 WHERE id=?', [c]), error => error.code === 'ER_DUP_ENTRY');
      assert.equal((await call('screens/' + screen, 'DELETE')).status, 200);
      assert.equal((await call('screens/' + other, 'DELETE')).status, 200);
    });

    await t.test('migração resolve posições legadas repetidas preservando a sequência exibida', async () => {
      const screen = (await (await call('screens', 'POST', { name: 'Catálogo legado' })).json()).id;
      await db.query('ALTER TABLE products DROP INDEX products_screen_position_unique');
      const ids = [];
      for (const position of [2,2,4294967295]) {
        const result = await db.query('INSERT INTO products (name,price,unit,screen,position) VALUES (?,?,?,?,?)', ['Legado',100,'UN',screen,position]);
        ids.push(result.insertId);
      }
      await db.query('DELETE FROM schema_migrations WHERE version=?', ['011_unique_product_order.sql']);
      await migrate(db);
      const rows = await db.query('SELECT id,position FROM products WHERE screen=? ORDER BY position', [screen]);
      assert.deepEqual(rows.map(p => p.id), ids);
      assert.deepEqual(rows.map(p => p.position), [0,1,2]);
      await migrate(db);
      await assert.rejects(db.query('UPDATE products SET position=0 WHERE id=?', [ids[1]]), error => error.code === 'ER_DUP_ENTRY');
      assert.equal((await call('screens/' + screen, 'DELETE')).status, 200);
    });

    const product = { name: "Coração d'água 🥩", price: 1234, unit: 'UN', screen: 'tv01', highlight: true, position: 100 };
    let productId;
    await t.test('cores individuais por TV, oferta ativada/desativada e validação de esquema', async () => {
      const screen = (await (await call('state')).json()).screens.find(screen => screen.id === 'tv01');
      assert.equal(screen.color_scheme, 'classic');
      assert.equal((await call('screens/tv01', 'PUT', { name: screen.name, color_scheme: 'invalid' })).status, 400);
      const offerResponse = await call('products', 'POST', { ...product, name: 'Oferta para validar paletas' });
      assert.equal(offerResponse.status, 200);
      const offerId = (await offerResponse.json()).id;
      for (const color_scheme of ['navy', 'graphite', 'forest', 'plum', 'ivory', 'midnight', 'wine', 'coffee', 'ice', 'sage', 'peach', 'classic']) {
        assert.equal((await call('screens/tv01', 'PUT', { name: screen.name, color_scheme })).status, 200);
        for (const highlight of [true, false]) {
          assert.equal((await call('products', 'PUT', { ...product, id: offerId, highlight })).status, 200);
          const savedState = await (await call('state')).json();
          assert.equal(savedState.screens.find(screen => screen.id === 'tv01').color_scheme, color_scheme);
          assert.equal(savedState.products.find(item => item.id === offerId).highlight, Number(highlight));
        }
      }
      assert.equal((await call('products/' + offerId, 'DELETE')).status, 200);
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
      assert.equal((await call('screens/tv01/heartbeat', 'POST', { device }, false)).status, 401);
      assert.equal((await call('screens/tv01/devices', 'POST', { device }, false)).status, 401);
      assert.equal((await call('screens/missing/devices', 'POST', { device })).status, 404);
      const enroll = async value => {
        const response = await call('screens/tv01/devices', 'POST', { device: value });
        assert.equal(response.status, 200);
        return (await response.json()).token;
      };
      const token = await enroll(device), secondToken = await enroll(second);
      assert.ok(!(await db.query('SELECT token_hash FROM screen_devices')).some(row => row.token_hash === token));
      assert.equal((await call('screens/tv01/heartbeat', 'POST', { device, token }, false)).status, 200);
      assert.equal((await call('screens/tv02/heartbeat', 'POST', { device, token }, false)).status, 401);
      assert.equal((await call('screens/tv01/heartbeat', 'POST', { device: second, token }, false)).status, 401);
      await call('screens/tv01/heartbeat', 'POST', { device: second, token: secondToken }, false);
      assert.equal((await status()).connected_devices, 2);
      await call('screens/tv01/heartbeat', 'POST', { device, token, disconnected: true }, false);
      assert.equal((await status()).online, true);
      await db.query('UPDATE screen_presence SET last_seen_at=UTC_TIMESTAMP() - INTERVAL 46 SECOND');
      assert.equal((await status()).online, false);
      await call('screens/tv01/heartbeat', 'POST', { device: second, token: secondToken }, false);
      assert.equal((await status()).online, true);
      await db.query('UPDATE screen_devices SET expires_at=UTC_TIMESTAMP() - INTERVAL 1 SECOND');
      assert.equal((await status()).online, false);
      assert.equal((await call('screens/tv01/heartbeat', 'POST', { device: second, token: secondToken }, false)).status, 401);
      await call('screens/tv01/devices', 'DELETE');
      assert.equal((await call('screens/tv01/heartbeat', 'POST', { device: second, token: secondToken }, false)).status, 401);
      assert.equal((await status()).online, false);
      const credentials = Array.from({ length: 100 }, () => [randomBytes(32).toString('hex'), randomUUID(), 'tv01']);
      await db.query('INSERT INTO screen_devices (token_hash,device_id,screen_id,expires_at) VALUES ' + credentials.map(() => '(?,?,?,UTC_TIMESTAMP() + INTERVAL 90 DAY)').join(','), credentials.flat());
      assert.equal((await call('screens/tv01/devices', 'POST', { device: randomUUID() })).status, 409);
      assert.equal((await db.query('SELECT COUNT(*) AS total FROM screen_devices'))[0].total, 100);
      await call('screens/tv01/devices', 'DELETE');
    });

    await t.test('links de exibição registram uma frota sem login e isolam a revogação por TV', async () => {
      const screen = (await (await call('screens','POST',{name:'Exibição automática'})).json()).id;
      const other = (await (await call('screens','POST',{name:'Exibição independente'})).json()).id;
      const link = async (id, renew=false) => {
        const response = await call('screens/' + id + '/display-link','POST',{renew});
        assert.equal(response.status,200);
        const {path} = await response.json();
        assert.equal(path.split('#')[0],'/tv?screen='+id);
        return new URLSearchParams(path.split('#')[1]).get('display');
      };
      assert.equal((await call('screens/'+screen+'/display-link','POST',{},false)).status,401);
      const key = await link(screen), otherKey = await link(other);
      assert.match(key,/^[a-f0-9]{64}$/);
      assert.equal(await link(screen),key);
      assert.notEqual(otherKey,key);
      const snapshot = await (await call('state','GET',undefined,false)).text();
      assert.ok(!snapshot.includes(key));
      const rows=await db.query('SELECT nonce FROM screen_display_links WHERE screen_id=?',[screen]);
      assert.notEqual(rows[0].nonce,key);
      const device=randomUUID(), otherDevice=randomUUID();
      const enroll = (id, deviceId, linkKey) => call('screens/'+id+'/display-devices','POST',{device:deviceId,key:linkKey},false);
      assert.equal((await enroll(screen,device,'0'.repeat(64))).status,403);
      assert.equal((await enroll(other,device,key)).status,403);
      assert.equal((await enroll(screen,device,undefined)).status,403);
      const first=await enroll(screen,device,key); assert.equal(first.status,200);
      const token=(await first.json()).token;
      const repeated=await Promise.all([enroll(screen,device,key),enroll(screen,device,key)]);
      for(const response of repeated) { assert.equal(response.status,200); assert.equal((await response.json()).token,token); }
      assert.equal((await call('screens/'+screen+'/heartbeat','POST',{device,token},false)).status,200);
      await app.close(); app=undefined; await db.close(); db=undefined;
      await start();
      assert.equal(await link(screen),key);
      assert.equal((await call('screens/'+screen+'/heartbeat','POST',{device,token},false)).status,200);

      assert.equal((await (await call('session','GET',undefined,false,{Cookie:'session='+token})).json()).authenticated,false);
      const peers=Array.from({length:30},()=>randomUUID());
      const enrolled=await Promise.all(peers.map(async deviceId=>{
        const response=await enroll(screen,deviceId,key); assert.equal(response.status,200);
        return {device:deviceId,token:(await response.json()).token};
      }));
      const heartbeats=await Promise.all(enrolled.map(input=>call('screens/'+screen+'/heartbeat','POST',input,false)));
      heartbeats.forEach(response=>assert.equal(response.status,200));
      const status=(await (await call('screens/status')).json()).find(row=>row.id===screen);
      assert.equal(status.connected_devices,31);
      const otherToken=(await (await enroll(other,otherDevice,otherKey)).json()).token;
      const renewed=await link(screen,true); assert.notEqual(renewed,key);
      assert.equal((await enroll(screen,device,key)).status,403);
      assert.equal((await call('screens/'+screen+'/heartbeat','POST',{device,token},false)).status,401);
      assert.equal((await enroll(screen,device,renewed)).status,200);
      assert.equal((await call('screens/'+other+'/heartbeat','POST',{device:otherDevice,token:otherToken},false)).status,200);
      await call('screens/'+screen+'/devices','DELETE');
      assert.equal((await enroll(screen,device,renewed)).status,403);
      assert.equal((await call('screens/'+screen,'DELETE')).status,200);
      assert.equal((await call('screens/'+other,'DELETE')).status,200);
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
      assert.equal((await asEditor('screens/' + extraScreen + '/devices', 'POST', { device: '33333333-3333-4333-8333-333333333333' })).status, 403);
      assert.equal((await asEditor('screens/' + extraScreen + '/devices', 'DELETE')).status, 403);
      assert.equal((await asEditor('screens/' + extraScreen + '/display-link','POST',{})).status,403);
      assert.equal((await asEditor('screens/tv01/display-link','POST',{})).status,200);
      assert.equal((await asEditor('screens/tv01/devices', 'POST', { device: '33333333-3333-4333-8333-333333333333' })).status, 200);
      assert.equal((await asEditor('products', 'PUT', { ...product, id: productId, price: 5678 })).status, 200);
      assert.equal((await asEditor('products', 'POST', { ...product, screen: extraScreen })).status, 403);
      assert.equal((await asEditor('products', 'PUT', { ...product, id: restrictedId })).status, 403);
      assert.equal((await asEditor('products', 'PUT', { ...product, id: productId, screen: extraScreen })).status, 403);
      assert.equal((await asEditor('products/' + restrictedId, 'DELETE')).status, 403);
      assert.equal((await asEditor('products/' + restrictedId + '/position', 'PUT', { screen:extraScreen,position:0 })).status,403);
      assert.equal((await asEditor('products/' + productId + '/position', 'PUT', { screen:'tv01',position:0 })).status,200);
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
      assert.equal((await call('version', 'GET', undefined, false)).status, 401);
      const version = await (await own('version')).json();
      assert.equal(version.update_available, true); assert.equal(version.latest, '99.0.0');
      assert.equal((await own('mail-settings', 'PUT', relay)).status, 403);
      assert.equal((await own('account/email', 'PUT', { email: 'bad', password: input.password })).status, 400);
      const beforePassword = (await db.query('SELECT password_hash FROM users WHERE id=?', [id]))[0].password_hash;
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: 'updated@example.com' })).status, 400);
      assert.equal((await (await own('account')).json()).email, input.email);
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: 'updated@example.com', role: 'admin', current_password: input.password })).status, 200);
      assert.equal((await (await own('account')).json()).email, 'updated@example.com');
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: input.email, password: '', current_password: input.password })).status, 200);
      assert.equal((await db.query('SELECT password_hash FROM users WHERE id=?', [id]))[0].password_hash, beforePassword);
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: input.email, password: 'replacement-password' })).status, 400);
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: input.email, password: 'replacement-password', current_password: 'wrong' })).status, 400);
      const ownProfile = (await (await own('session')).json()).user; assert.equal(ownProfile.name, 'Atualizada'); assert.equal(ownProfile.role, 'editor');
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: input.email, password: 'replacement-password', current_password: input.password })).status, 200);
      assert.notEqual((await db.query('SELECT password_hash FROM users WHERE id=?', [id]))[0].password_hash, beforePassword);
      input.password = 'replacement-password';
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
      assert.equal((await own('account/profile', 'PUT', { name: 'Atualizada', email: 'different@example.com' })).status, 409);
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
