// Prévia local de dados fictícios. Não se conecta a banco e não entra no pacote de produção.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { demoProducts } from '../../database/demo.js';

const port = Number(process.env.SYSTV_LAYOUT_PORT || 4178);
const user = { id: 1, name: 'Administrador', username: 'admin', email: null, role: 'admin', active: true, screens: ['tv01', 'tv02'], two_factor_enabled: false };
const state = {
  settings: { name: 'Mercado Demonstração', message: 'Produtos selecionados para a sua família', left_logo: null, right_logo: null },
  screens: [{ id: 'tv01', name: 'Balcão principal', page_interval_seconds: 15, color_scheme: 'classic' }, { id: 'tv02', name: 'Setor de produtos especiais e atendimento', page_interval_seconds: 20, color_scheme: 'ivory' }],
  products: demoProducts.map((p, i) => ({ ...p, id: i + 1 })),
  units: [{ code: 'KG', name: 'Quilograma' }, { code: 'UN', name: 'Unidade' }, { code: 'CX', name: 'Caixa com produtos selecionados' }],
};
const users = [user, { ...user, id: 2, name: 'Equipe de atendimento e operação', username: 'atendimento', email: 'atendimento.interno@example.com', role: 'editor', screens: ['tv01', 'tv02'] }, { ...user, id: 3, name: 'Pessoa com nome extenso para conferência de layout', username: 'operacao.comercial', email: 'operacao.comercial.regional@example.com', role: 'editor', active: false }];
const mail = { enabled: false, provider: 'custom', microsoft_account: 'business', host: 'smtp.example.com', port: 587, security: 'starttls', auth: 'password', username: '', from_name: 'SYSTV', from_email: 'systv@example.com', client_id: '', tenant_id: '', stored_secrets: {} };
const files = { '/': 'admin.html', '/admin': 'admin.html', '/activate': 'activate.html', '/tv': 'tv.html' };
const instrumentation = `<script>
setInterval(() => {
 let badge = document.getElementById('layout-measure');
 if (!badge) { badge = document.createElement('output'); badge.id = 'layout-measure'; badge.style.cssText = 'position:fixed;bottom:0;left:0;z-index:9999;background:#132f38;color:#fff;padding:4px 8px;font:11px monospace;pointer-events:none'; document.body.append(badge); }
 const width = document.documentElement.clientWidth;
 const overflow = Math.max(0, document.documentElement.scrollWidth - width);
 const tables = [...document.querySelectorAll('.table-wrap')].filter(e => e.getClientRects().length).map(e => Math.max(0,e.scrollWidth - e.clientWidth));
 badge.textContent = 'PRÉVIA FICTÍCIA | largura: ' + width + 'px | excesso horizontal: ' + overflow + 'px | tabelas: ' + (tables.join(',') || '0') + 'px';
}, 500);
</script>`;
function json(res, value) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`), path = url.pathname;
  try {
    if (path === '/preview/login' || path === '/preview/admin') {
      res.writeHead(302, { Location: '/admin', 'Set-Cookie': `layout-logged=${path.endsWith('admin') ? 'yes' : 'no'}; Path=/; SameSite=Lax` }); return res.end();
    }
    if (path === '/preview/mobile' || path === '/preview/tablet') {
      const width = path.endsWith('mobile') ? 390 : 768;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia ${width}px</title><style>body{margin:0;background:#72838b;display:flex;justify-content:center}iframe{width:${width}px;max-width:100%;height:1050px;border:0;background:#fff}</style><iframe src="${url.searchParams.get('page') === 'activate' ? '/activate#token=' + '0'.repeat(64) : url.searchParams.get('page') === 'tv' ? '/tv?screen=tv01' : '/admin'}" title="SYSTV em ${width}px"></iframe>`);
    }
    if (path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); res.write(`data: ${JSON.stringify(state)}\n\n`);
      const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000); req.on('close', () => clearInterval(timer)); return;
    }
    if (path === '/api/state') return json(res, state);
    if (path === '/api/session') return json(res, { authenticated: !req.headers.cookie?.includes('layout-logged=no'), user: req.headers.cookie?.includes('layout-logged=no') ? null : user });
    if (path === '/api/users') return json(res, users);
    if (path === '/api/version') return json(res, { current: '2.6.0', latest: '2.6.1', status: 'checked', checked_at: new Date().toISOString(), update_available: true, release_url: 'https://github.com/mk-tecnologia/systv/releases' });
    if (path === '/api/screens/status') return json(res, state.screens.map((s, i) => ({ id: s.id, online: i === 0 })));
    if (path === '/api/account') return json(res, { ...user, mail_ready: true });
    if (path === '/api/mail-settings') return json(res, mail);
    if (path === '/api/health') return json(res, { status: 'ok', database: 'preview' });
    if (path === '/api/activation/status') return json(res, { required: true });
    if (path === '/api/activation/validate') return json(res, { expires_at: new Date(Date.now() + 86400000).toISOString() });
    if (path.includes('/heartbeat')) return json(res, { ok: true });
    if (path.startsWith('/api/')) { res.writeHead(405, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Prévia visual: alterações não são persistidas.' })); }
    const file = files[path] || (/^\/[a-z-]+\.(js|css|svg)$/.test(path) ? path.slice(1) : null);
    if (!file) { res.writeHead(404); return res.end(); }
    let content = await readFile(new URL('../../public/' + file, import.meta.url));
    if (file.endsWith('.html')) content = content.toString().replace('</body>', instrumentation + '</body>');
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript';
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Prévia com dados fictícios: http://127.0.0.1:${port}/preview/admin`));
