import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTVPresence } from '../public/tv-presence.js';

const key = 'a'.repeat(64), token = 'b'.repeat(64);
const device = '11111111-1111-4111-8111-111111111111';
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (status, value = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => value });
function harness(options = {}) {
  const values = new Map(), calls = [], statuses = [];
  let interval, storageReads = 0, time = 0;
  const storage = () => { storageReads++; return { getItem: name => values.get(name) ?? null, setItem: (name,value) => values.set(name,value) }; };
  const timers = { setInterval(callback, ms) { assert.equal(ms,15000); interval = callback; return 1; }, clearInterval() { interval = null; } };
  const request = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({url,body,credentials:init.credentials});
    if (options.request) return options.request(url,body);
    return response(200,url.endsWith('/display-devices') ? {token} : {ok:true});
  };
  const create = extra => createTVPresence({screen:'tv01',key,storage,timers,fetch:request,now:()=>time,randomUUID:()=>device,onStatus:status=>statuses.push(status),...extra});
  return {create,values,calls,statuses,tick:async()=>{ time+=15000; interval?.(); await flush(); },storageReads:()=>storageReads};
}

test('TV registra e informa presença sem sessão e reaproveita a credencial após reabrir', async () => {
  const h = harness(), client = h.create();
  client.start(); await flush();
  assert.deepEqual(h.calls.map(c=>c.url),['/api/screens/tv01/display-devices','/api/screens/tv01/heartbeat']);
  assert.ok(h.calls.every(c=>c.credentials==='omit'));
  assert.equal(h.calls[0].body.key,key); assert.equal(h.calls[1].body.token,token);
  client.stop();
  const before=h.calls.length;
  const reopened=h.create({key:null}); reopened.start(); await flush();
  assert.equal(h.calls.length,before+1); assert.ok(h.calls.at(-1).url.endsWith('/heartbeat'));
  assert.equal(h.calls.at(-1).body.device,device); reopened.stop();
});

test('reconexão preserva dispositivo e link quando a credencial expira', async () => {
  let reject = true;
  const h=harness({request:(url)=>url.endsWith('/display-devices') ? response(200,{token}) : response(reject ? 401 : 200)});
  const client=h.create(); client.start(); await flush();
  let saved=JSON.parse(h.values.get('systv-device:tv01'));
  assert.equal(saved.token,null); assert.equal(saved.displayKey,key); assert.equal(saved.device,device);
  reject=false; await h.tick();
  saved=JSON.parse(h.values.get('systv-device:tv01'));
  assert.equal(saved.token,token); assert.equal(h.statuses.at(-1),'ready'); client.stop();
});

test('link renovado substitui a credencial antiga e falha de rede se recupera sem login', async () => {
  let first=true;
  const h=harness({request:url=> {
    if (first) {first=false; throw new Error('Rede indisponível');}
    return response(200,url.endsWith('/display-devices') ? {token} : {});
  }});
  h.values.set('systv-device:tv01',JSON.stringify({device,token:'c'.repeat(64),displayKey:'d'.repeat(64)}));
  const client=h.create(); client.start(); await flush();
  assert.equal(h.statuses.at(-1),'reconnecting'); await h.tick();
  assert.equal(h.calls[1].body.key,key); assert.equal(h.calls.at(-1).body.token,token);
  assert.equal(h.statuses.at(-1),'ready'); client.stop();
});

test('prévia não registra dispositivo, não lê credenciais e não interfere no status da TV', async () => {
  const h=harness(), client=h.create({preview:true});
  client.start(); await flush(); await client.report();
  assert.equal(h.storageReads(),0); assert.equal(h.values.size,0); assert.equal(h.calls.length,0);
  assert.equal(h.statuses.at(-1),'preview'); client.stop();
});

test('URL antiga sem link não tenta login; dispositivos já autorizados permanecem compatíveis', async () => {
  const h=harness(), plain=h.create({key:null}); plain.start(); await flush();
  assert.equal(h.calls.length,0); assert.equal(h.statuses.at(-1),'link_required'); plain.stop();
  h.values.set('systv-device:tv01',JSON.stringify({device,token}));
  const legacy=h.create({key:null}); legacy.start(); await flush();
  assert.equal(h.calls.length,1); assert.ok(h.calls[0].url.endsWith('/heartbeat')); legacy.stop();
});

test('link revogado interrompe novas tentativas e fechar uma aba não desconecta outra', async () => {
  const h=harness({request:()=>response(403)}), client=h.create(); client.start(); await flush();
  assert.equal(h.statuses.at(-1),'invalid_link'); await h.tick();
  assert.equal(h.calls.length,1); client.stop(); await client.report(); await h.tick();
  assert.equal(h.calls.length,1); assert.ok(h.calls.every(c=>!c.body.disconnected));
});

test('presença só é enviada depois que o catálogo da TV está disponível', async () => {
  const h=harness(); let ready=false;
  const client=h.create({ready:()=>ready}); client.start(); await flush();
  assert.equal(h.calls.length,1); ready=true; await client.report();
  assert.equal(h.calls.length,2); assert.ok(h.calls.at(-1).url.endsWith('/heartbeat')); client.stop();
});


test('rajadas de atualização do catálogo não esgotam a cota de presença', async () => {
  const h=harness(), client=h.create(); client.start(); await flush();
  const count=h.calls.length;
  for(let i=0;i<50;i++) await client.report();
  assert.equal(h.calls.length,count);
  await h.tick(); assert.equal(h.calls.length,count+1); client.stop();
});
