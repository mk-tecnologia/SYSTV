import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createMailer } from '../src/mail.js';

test('envio SMTP real para relay local, sem serviços externos', async () => {
  let content = '', captured = '';
  const sockets = new Set();
  const smtp = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('220 local.test ESMTP\r\n'); let buffer = '', data = false;
    socket.on('data', bytes => {
      buffer += bytes.toString();
      let boundary;
      while ((boundary = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (data) { if (line === '.') { captured = content; data = false; socket.write('250 Message accepted\r\n'); } else content += line + '\n'; }
        else if (/^(EHLO|HELO)/.test(line)) socket.write('250-local.test\r\n250 8BITMIME\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 End with dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  try {
    const settings = { enabled: true, host: '127.0.0.1', port: smtp.address().port, security: 'none', auth: 'none', from_email: 'systv@local.test', from_name: 'SYSTV' };
    const db = { query: async () => [{ config_json: JSON.stringify(settings), secrets_encrypted: null }] };
    const mailer = createMailer(db, {});
    await mailer.send('user@local.test', 'SMTP local', 'Codigo de teste: 123456');
    assert.match(captured, /To: user@local.test/); assert.match(captured, /Codigo de teste: 123456/);
    assert.match(captured, /From: SYSTV <systv@local.test>/);
  } finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => smtp.close(resolve)); }
});
