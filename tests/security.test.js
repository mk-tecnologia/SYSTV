import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { clientAddress, createRateLimit, validateDeployment } from '../src/security.js';
import { createEvents } from '../src/events.js';
import { createAuth } from '../src/auth.js';

const request = (ip, real, peer = '127.0.0.1') => ({ socket: { remoteAddress: peer }, headers: { 'x-real-ip': real || ip } });
test('proxy confiável exige opt-in, loopback e endereço válido', () => {
  assert.equal(clientAddress(request('198.51.100.1')), '127.0.0.1');
  assert.equal(clientAddress(request('198.51.100.1'), { trustProxy: true }), '198.51.100.1');
  assert.equal(clientAddress(request('198.51.100.1', null, '192.0.2.5'), { trustProxy: true }), '192.0.2.5');
  assert.equal(clientAddress(request('', '198.51.100.1, 198.51.100.2'), { trustProxy: true }), '127.0.0.1');
});
test('limites expiram e memória cheia não descarta cotas existentes', () => {
  let now = 0;
  const limiter = createRateLimit({ capacity: 2, now: () => now });
  limiter.check('a', 1); limiter.check('b', 1);
  assert.throws(() => limiter.check('a', 1), { status: 429 });
  assert.throws(() => limiter.check('c', 1), { status: 429 });
  now = 60000;
  limiter.check('c', 1); limiter.check('a', 1);
});
test('esgotar cota de login de um IP não bloqueia outro cliente do proxy', async () => {
  const auth = createAuth({}, { trustProxy: true }, {});
  for (let i = 0; i < 10; i++) await assert.rejects(auth.login(request('198.51.100.1'), {}, {}), { status: 401 });
  await assert.rejects(auth.login(request('198.51.100.1'), {}, {}), { status: 429 });
  await assert.rejects(auth.login(request('198.51.100.2'), {}, {}), { status: 401 });
});
test('SSE limita conexões por cliente e libera a cota uma única vez', async () => {
  const events = await createEvents({ snapshot: async () => ({}), health: async () => {} }, { trustProxy: true });
  const clients = [];
  function response() {
    const res = new EventEmitter();
    Object.assign(res, { writeHead() {}, write() {}, end() { res.emit('close'); } });
    clients.push(res); return res;
  }
  try {
    for (let i = 0; i < 50; i++) events.subscribe(request('198.51.100.1'), response());
    assert.throws(() => events.subscribe(request('198.51.100.1'), response()), { status: 429 });
    events.subscribe(request('198.51.100.2'), response());
    clients[0].emit('error', new Error('closed')); clients[0].emit('close');
    events.subscribe(request('198.51.100.1'), response());
    assert.throws(() => events.subscribe(request('198.51.100.1'), response()), { status: 429 });
  } finally { events.close(); }
});

test('produção exige origem confiável, HTTPS na rede e cookie seguro', () => {
  const config = { production: true, origin: 'https://tv.example', secureCookie: true };
  validateDeployment(config);
  validateDeployment({ ...config, origin: 'http://127.0.0.1', secureCookie: false });
  for (const change of [{ origin: undefined }, { origin: 'http://tv.example' }, { secureCookie: false }, { origin: 'https://user:secret@tv.example' }, { origin: 'https://tv.example/path' }]) assert.throws(() => validateDeployment({ ...config, ...change }));
});
