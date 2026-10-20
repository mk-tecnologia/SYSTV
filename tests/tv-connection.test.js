import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTVConnection } from '../public/tv-connection.js';

const snapshot = price => ({ settings: { name: 'Empresa' }, screens: [{ id: 'tv01' }], products: [{ id: 1, price }] });

function fixture(options = {}) {
  let time = 1000, id = 0;
  const tasks = new Map(), sources = [], states = [], statuses = [];
  const schedule = (fn, delay, interval = false) => {
    const token = ++id; tasks.set(token, { fn, due: time + delay, delay, interval }); return token;
  };
  const timers = {
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: token => tasks.delete(token),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: token => tasks.delete(token),
  };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function tick(ms) {
    const end = time + ms;
    while (true) {
      const entry = [...tasks].filter(([, task]) => task.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) break;
      const [token, task] = entry; time = task.due;
      if (task.interval) task.due += task.delay; else tasks.delete(token);
      task.fn(); await flush();
    }
    time = end; await flush();
  }
  const createSource = () => {
    const listeners = new Map();
    const source = {
      closed: false, addEventListener: (event, fn) => listeners.set(event, fn),
      close() { this.closed = true; },
      send(data) { this.onmessage({ data: JSON.stringify(data) }); },
      heartbeat(ok = true) { listeners.get('heartbeat')({ data: JSON.stringify({ ok }) }); },
      fail() { this.onerror(); },
    };
    sources.push(source); return source;
  };
  const connection = createTVConnection({
    onState: (state, at) => states.push({ state, at }), onStatus: status => statuses.push(status),
    now: () => time, timers, createSource, fetchState: async () => snapshot(2000), ...options,
  });
  connection.start();
  return { connection, sources, states, statuses, tick, tasks, status: () => statuses.at(-1), now: () => time };
}

test('recupera dados por HTTP e retoma eventos; ignora respostas da conexão antiga', async () => {
  const f = fixture(); const old = f.sources[0];
  old.send(snapshot(1000)); assert.equal(f.status().phase, 'live');
  old.fail(); assert.equal(f.status().phase, 'offline'); assert.equal(old.closed, true);
  assert.equal(f.states.at(-1).state.products[0].price, 1000);
  await f.tick(1999); assert.equal(f.sources.length, 1);
  await f.tick(1); assert.equal(f.sources.length, 2); assert.equal(f.status().phase, 'polling');
  assert.equal(f.states.at(-1).state.products[0].price, 2000);
  f.sources[1].send(snapshot(3000)); assert.equal(f.status().phase, 'live');
  old.send(snapshot(500)); assert.equal(f.states.at(-1).state.products[0].price, 3000);
  f.connection.stop(); assert.equal(f.tasks.size, 0);
});

test('heartbeat preserva a conexão e silêncio prolongado aciona o watchdog', async () => {
  const f = fixture(); const source = f.sources[0]; source.send(snapshot(1000));
  await f.tick(40000); source.heartbeat();
  await f.tick(45000); assert.equal(source.closed, false);
  await f.tick(5000); assert.equal(source.closed, true); assert.equal(f.status().phase, 'offline');
  f.connection.stop();
});

test('falha de saúde do servidor detectada pelo heartbeat gera aviso imediatamente', () => {
  const f = fixture(); f.sources[0].send(snapshot(1000));
  f.sources[0].heartbeat(false); assert.equal(f.status().phase, 'offline');
  assert.equal(f.states.at(-1).state.products[0].price, 1000); f.connection.stop();
});

test('tentativas usam espera crescente até 30 segundos sem apagar preços anteriores', async () => {
  const f = fixture({ fetchState: async () => { throw new Error('Rede indisponível'); } });
  f.sources[0].send(snapshot(1000)); f.sources[0].fail();
  for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
    assert.equal(f.status().nextRetryAt - f.now(), delay);
    await f.tick(delay);
  }
  assert.equal(f.states.length, 1); f.connection.stop();
});

test('consulta travada é abortada em oito segundos e tentativa manual antecipa recuperação', async () => {
  let signal;
  const f = fixture({ fetchState: requestSignal => {
    signal = requestSignal;
    return new Promise((resolve, reject) => requestSignal.addEventListener('abort', () => reject(new Error('Timeout'))));
  } });
  f.sources[0].fail(); await f.tick(2000);
  assert.equal(signal.aborted, false); await f.tick(8000);
  assert.equal(signal.aborted, true); assert.equal(f.status().phase, 'offline');
  f.connection.retry(); assert.equal(f.status().phase, 'connecting');
  f.connection.stop(); await f.tick(0); assert.equal(f.tasks.size, 0);
});

test('dados inválidos não substituem o catálogo e recuperação periódica não é anunciada como ao vivo', async () => {
  const f = fixture(); f.sources[0].send(snapshot(1000)); f.sources[0].send({ invalid: true });
  assert.equal(f.states.length, 1); assert.equal(f.status().phase, 'offline');
  await f.tick(2000); assert.equal(f.status().phase, 'polling');
  f.sources[1].fail(); assert.equal(f.status().phase, 'polling'); f.connection.stop();
});
