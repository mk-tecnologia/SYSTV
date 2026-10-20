import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVersionStatus, isNewerVersion } from '../src/version.js';

const current = (await readFile(new URL('../VERSION', import.meta.url), 'utf8')).trim();
test('compara versões numericamente e ignora versões inválidas ou de prévia', () => {
  assert.equal(isNewerVersion('v2.10.0', '2.9.9'), true);
  assert.equal(isNewerVersion('v3.0.0', '2.99.99'), true);
  for (const candidate of ['v2.9.9', '2.8.0', '2.10.0-beta', 'invalid']) assert.equal(isNewerVersion(candidate, '2.9.9'), false);
});
test('consulta estável, compartilha requisições concorrentes e renova cache após cinco minutos', async () => {
  let requests = 0, time = 0;
  const status = await createVersionStatus({ now: () => time, fetch: async (url, options) => {
    requests++; assert.equal(url, 'https://api.github.com/repos/mk-tecnologia/systv/releases/latest');
    assert.ok(options.signal); assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => ({ tag_name: 'v99.0.0', draft: false, prerelease: false, html_url: 'https://untrusted.example' }) };
  } });
  const [a, b] = await Promise.all([status(), status()]);
  assert.deepEqual(a, b); assert.equal(requests, 1); assert.equal(a.current, current); assert.equal(a.update_available, true);
  assert.equal(a.release_url, 'https://github.com/mk-tecnologia/systv/releases/tag/v99.0.0');
  await status(); assert.equal(requests, 1);
  time = 300000; await status(); assert.equal(requests, 2);
});
test('falha de rede preserva versão local e permite nova consulta em cinco minutos', async () => {
  let time = 0, offline = true, requests = 0;
  const status = await createVersionStatus({ now: () => time, fetch: async () => {
    requests++; if (offline) throw new Error('offline');
    return { ok: true, json: async () => ({ tag_name: `v${current}` }) };
  } });
  const result = await status(); assert.equal(result.current, current); assert.equal(result.status, 'unavailable'); assert.equal(result.update_available, false);
  await status(); assert.equal(requests, 1);
  offline = false; time = 300000;
  const recovered = await status(); assert.equal(recovered.status, 'checked'); assert.equal(recovered.update_available, false); assert.equal(requests, 2);
});
test('respostas inválidas, limites da API e prévias não anunciam atualização', async () => {
  for (const response of [ { ok: false }, ...[{ tag_name: 'v99.0.0', prerelease: true }, { tag_name: 'v99.0.0', draft: true }, { tag_name: 'bad' }].map(release => ({ ok: true, json: async () => release })) ]) {
    const status = await createVersionStatus({ fetch: async () => response });
    assert.equal((await status()).status, 'unavailable');
  }
});

test('verificação manual encontra nova publicação antes de expirar o cache e limita repetição', async () => {
  let time = 0, requests = 0, tag = `v${current}`;
  const status = await createVersionStatus({ now: () => time, fetch: async () => {
    requests++; return { ok: true, json: async () => ({ tag_name: tag }) };
  } });
  assert.equal((await status()).update_available, false);
  tag = 'v99.0.0'; time = 31000;
  assert.equal((await status()).update_available, false);
  const updated = await status({ refresh: true });
  assert.equal(updated.update_available, true); assert.equal(requests, 2);
  assert.equal(updated.checked_at, new Date(time).toISOString());
  await status({ refresh: true }); assert.equal(requests, 2);
});
