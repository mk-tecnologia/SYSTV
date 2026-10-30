import { createVersionStatus } from './version.js';
import { createActivation, sealActivation } from './activation.js';
import { createMailer } from './mail.js';
import http from 'node:http';
import { clientAddress, createRateLimit, validateDeployment } from './security.js';
import { createPresence } from './presence.js';
import { readFile } from 'node:fs/promises';
import { createRepository } from './repository.js';
import { createAuth } from './auth.js';
import { createEvents } from './events.js';
import { HttpError, json, readBody } from './http.js';
import { bootstrapAdmin, createUsers, requireAdmin } from './users.js';
import { createLogos, readLogo, validSide } from './logos.js';

const files = {
  '/activate': 'activate.html', '/activate.js': 'activate.js',
  '/': 'admin.html', '/admin': 'admin.html', '/tv': 'tv.html',
  '/security.js': 'security.js', '/tv-palettes.js': 'tv-palettes.js', '/theme.js': 'theme.js', '/icons.svg': 'icons.svg', '/style.css': 'style.css', '/admin.js': 'admin.js', '/tv.js': 'tv.js',
  '/tv-connection.js': 'tv-connection.js',
};

export async function createApp(db, config, dependencies = {}) {
  validateDeployment(config);
  await bootstrapAdmin(db, config);
  await sealActivation(db);
  const activation = createActivation(db);
  const repository = createRepository(db);
  const mailer = createMailer(db, config, dependencies.mail);
  const auth = createAuth(db, config, mailer);
  const users = createUsers(db);
  const versionStatus = await createVersionStatus(dependencies.version);
  const logos = createLogos(db);
  const presence = createPresence(db);
  const events = await createEvents(repository, config);
  const publicRequests = createRateLimit();
  const cleanup = setInterval(() => Promise.all([auth.cleanup(), presence.cleanup(), publicRequests.cleanup()]).catch(error => console.error('Falha na limpeza de sessões:', error.code || error.message)), 60000);
  cleanup.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (config.secureCookie) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = url.pathname;
      const method = req.method;
      if (route.startsWith('/api/')) {
        publicRequests.check('global', 6000);
        publicRequests.check(clientAddress(req, config), 600);
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) throw new HttpError(405, 'Método não permitido.');
        if (method !== 'GET' && req.headers.origin) {
          const origin = config.origin || `http://${req.headers.host}`;
          if (req.headers.origin !== origin) throw new HttpError(403, 'Origem não permitida.');
        }
        if (route === '/api/health' && method === 'GET') {
          await db.query('SELECT 1');
          return json(res, 200, { status: 'ok', database: 'mariadb' });
        }
        if (route === '/api/activation/status' && method === 'GET') return json(res, 200, await activation.status());
        if (route === '/api/activation/validate' && method === 'POST') return json(res, 200, await activation.validate(await readBody(req)));
        if (route === '/api/activation' && method === 'POST') return json(res, 200, await activation.complete(await readBody(req)));
        if (route === '/api/events' && method === 'GET') return events.subscribe(req, res);
        if (route === '/api/state' && method === 'GET') return json(res, 200, await repository.snapshot());
        if (/^\/api\/logos\/(left|right)$/.test(route) && method === 'GET') {
          const logo = await logos.get(route.split('/').pop());
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': url.searchParams.get('v') === logo.etag ? 'public, max-age=31536000, immutable' : 'no-cache', ETag: `"${logo.etag}"` });
          return res.end(logo.data);
        }
        if (/^\/api\/screens\/[^/]+\/heartbeat$/.test(route) && method === 'POST') {
          await presence.report(route.split('/')[3], await readBody(req));
          return json(res, 200, { ok: true });
        }
        const user = await auth.currentUser(req);
        if (route === '/api/session' && method === 'GET') return json(res, 200, { authenticated: Boolean(user), user });
        if (route === '/api/login' && method === 'POST') {
          return json(res, 200, await auth.login(req, res, await readBody(req)));
        }
        if (route === '/api/login/verify' && method === 'POST') return json(res, 200, await auth.verifyLogin(req, res, await readBody(req)));
        if (route === '/api/password/forgot' && method === 'POST') return json(res, 200, await auth.forgot(req, await readBody(req)));
        if (route === '/api/password/reset' && method === 'POST') return json(res, 200, await auth.reset(req, await readBody(req)));
        if (!user) throw new HttpError(401, 'Entre para continuar.');
        if (route === '/api/version' && method === 'GET') return json(res, 200, await versionStatus({ refresh: url.searchParams.get('refresh') === '1' }));
        if (route === '/api/logout' && method === 'POST') {
          await auth.logout(req, res);
          return json(res, 200, { ok: true });
        }
        if (/^\/api\/screens\/[^/]+\/devices$/.test(route) && ['POST', 'DELETE'].includes(method)) {
          const screen = route.split('/')[3];
          if (method === 'POST') return json(res, 200, await presence.enroll(screen, await readBody(req), user));
          await presence.revoke(screen, user);
          return json(res, 200, { ok: true });
        }
        if (route === '/api/screens/status' && method === 'GET') return json(res, 200, await presence.list(user));
        if (route === '/api/mail-settings' && method === 'GET') return json(res, 200, await mailer.get(user));
        if (route === '/api/mail-settings' && method === 'PUT') { await mailer.save(await readBody(req), user); return json(res, 200, { ok: true }); }
        if (route === '/api/mail-settings/test' && method === 'POST') { await mailer.test(await readBody(req), user); return json(res, 200, { ok: true }); }
        if (route === '/api/account' && method === 'GET') return json(res, 200, await auth.account(user));
        if (route === '/api/account/profile' && method === 'PUT') return json(res, 200, await auth.updateProfile(req, user, await readBody(req)));
        if (route === '/api/account/email' && method === 'PUT') return json(res, 200, await auth.updateEmail(req, user, await readBody(req)));
        if (route === '/api/account/2fa/start' && method === 'POST') return json(res, 200, await auth.enableStart(req, user, await readBody(req)));
        if (route === '/api/account/2fa/confirm' && method === 'POST') return json(res, 200, await auth.enableConfirm(req, user, await readBody(req)));
        if (route === '/api/account/2fa/disable' && method === 'POST') return json(res, 200, await auth.disable(req, user, await readBody(req)));
        let id;
        if (route === '/api/users' && method === 'GET') return json(res, 200, await users.list(user));
        if (route === '/api/users' && ['POST','PUT'].includes(method)) {
          requireAdmin(user);
          id = await users.save(await readBody(req), method === 'PUT', user);
          return json(res, 200, { ok: true, id });
        }
        if (/^\/api\/users\/[^/]+$/.test(route) && method === 'DELETE') {
          await users.delete(route.split('/').pop(), user);
          return json(res, 200, { ok: true });
        }
        if (/^\/api\/logos\/[^/]+$/.test(route) && ['PUT','DELETE'].includes(method)) {
          requireAdmin(user);
          const side = route.split('/').pop(); validSide(side);
          if (method === 'PUT') await logos.save(side, await readLogo(req), user);
          else await logos.delete(side, user);
        }
        else if (route === '/api/units' && method === 'POST') id = await repository.saveUnit(await readBody(req), null, user);
        else if (/^\/api\/units\/[^/]+$/.test(route) && method === 'PUT') id = await repository.saveUnit(await readBody(req), decodeURIComponent(route.split('/').pop()), user);
        else if (/^\/api\/units\/[^/]+$/.test(route) && method === 'DELETE') await repository.deleteUnit(decodeURIComponent(route.split('/').pop()), user);
        else if (route === '/api/settings' && method === 'PUT') await repository.saveSettings(await readBody(req), user);
        else if (route === '/api/screens' && method === 'POST') id = await repository.addScreen(await readBody(req), user);
        else if (/^\/api\/screens\/[^/]+$/.test(route) && method === 'PUT') id = await repository.renameScreen(route.split('/').pop(), await readBody(req), user);
        else if (/^\/api\/screens\/[^/]+$/.test(route) && method === 'DELETE') await repository.deleteScreen(route.split('/').pop(), user);
        else if (route === '/api/products' && ['POST', 'PUT'].includes(method)) id = await repository.saveProduct(await readBody(req), method === 'PUT', user);
        else if (/^\/api\/products\/[^/]+\/position$/.test(route) && method === 'PUT') await repository.moveProduct(route.split('/')[3], await readBody(req), user);
        else if (/^\/api\/products\/[^/]+$/.test(route) && method === 'DELETE') await repository.deleteProduct(route.split('/').pop(), user);
        else throw new HttpError(404, 'Rota não encontrada.');
        await events.refresh();
        return json(res, 200, { ok: true, ...(id !== undefined ? { id } : {}) });
      }
      if (!files[route] || method !== 'GET') throw new HttpError(404, 'Página não encontrada.');
      const data = await readFile(new URL(`../public/${files[route]}`, import.meta.url));
      const type = route.endsWith('.svg') ? 'image/svg+xml' : route.endsWith('.css') ? 'text/css' : route.endsWith('.js') ? 'text/javascript' : 'text/html';
      if (route === '/activate') res.setHeader('Referrer-Policy', 'no-referrer');
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': route === '/activate' ? 'no-store' : 'no-cache' });
      res.end(data);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (error instanceof HttpError) return json(res, error.status, { error: error.message });
      console.error('Falha na requisição:', error.code || error.message);
      json(res, 503, { error: 'Serviço temporariamente indisponível. Tente novamente.' });
    }
  });
  return {
    server,
    async close() {
      clearInterval(cleanup);
      events.close();
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
