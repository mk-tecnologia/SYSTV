import { createTVPresence } from './tv-presence.js';
import { getTVPalette } from './tv-palettes.js';
const $ = id => document.getElementById(id);
const screen = new URLSearchParams(location.search).get('screen') || 'tv01';
const previewMode = new URLSearchParams(location.search).get('preview') === '1';
const presenceLabels = {
  preview: '',
  link_required: 'Para monitorar esta TV, use o link de exibição copiado no painel.',
  invalid_link: 'Link de exibição inválido ou renovado. Copie o link atual no painel.',
  reconnecting: 'Reconectando o monitoramento…', ready: '',
};
const presence = createTVPresence({
  screen, preview: previewMode,
  key: new URLSearchParams(location.hash.slice(1)).get('display'),
  ready: () => Boolean(state?.screens.some(item => item.id === screen)),
  onStatus(status) {
    const label = $('tv-presence-status'); label.textContent = presenceLabels[status];
    $('tv-presence-alert').hidden = !label.textContent; scheduleFit();
  },
});
let state, page = 0, fitFrame, rotationTimer, rotationKey = '', connectionStatus;

function columns() { return window.innerWidth < 900 ? 1 : 2; }

function render() {
  if (!state) return;
  const selected = state.screens.find(s => s.id === screen);
  const palette = getTVPalette(selected?.color_scheme);
  document.body.dataset.palette = palette.id;
  for (const key of ['background', 'row', 'text', 'accent', 'badge', 'muted']) document.body.style.setProperty('--tv-' + key, palette[key]);
  $('store-name').textContent = state.settings.name;
  document.title = state.settings.name + ' · ' + (selected?.name || 'TV');
  renderLogos();
  $('screen-name').textContent = (previewMode ? 'Prévia · ' : '') + (selected?.name || 'TV não encontrada');
  $('message').textContent = state.settings.message;
  const products = state.products.filter(product => product.screen === screen);
  const count = columns();
  const size = count * 17;
  const pages = Math.max(1, Math.ceil(products.length / size));
  page %= pages;
  $('page').textContent = `${page + 1}/${pages}`;
  const current = products.slice(page * size, (page + 1) * size);
  $('board').classList.toggle('is-empty', current.length === 0);
  $('board').style.setProperty('--columns', count);
  $('board').style.setProperty('--rows', Math.max(1, Math.ceil(current.length / count)));
  $('board').replaceChildren(...current.map(product => {
    const row = document.createElement('article');
    row.className = 'price-row' + (product.highlight ? ' highlighted' : '');
    const name = document.createElement('span'); name.className = 'product-name'; name.textContent = product.name;
    const price = document.createElement('div'); price.className = 'price';
    const currency = document.createElement('small'); currency.textContent = 'R$';
    const amount = document.createElement('strong');
    amount.textContent = (product.price / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const unit = document.createElement('small'); unit.textContent = product.unit;
    price.append(currency, amount, unit); row.append(name, price); return row;
  }));
  if (!current.length) {
    const empty = document.createElement('div'); empty.className = 'tv-empty';
    empty.textContent = selected ? 'Em breve, novos produtos por aqui.' : 'Esta TV não está cadastrada. Confira o link no administrador.';
    $('board').append(empty);
  }
  scheduleFit();
  configureRotation(pages, selected?.page_interval_seconds);
}

function configureRotation(pages, seconds) {
  const interval = Number.isInteger(seconds) && seconds >= 5 && seconds <= 300 ? seconds : 15;
  const key = `${pages}:${interval}`;
  if (key === rotationKey) return;
  clearInterval(rotationTimer);
  rotationKey = key;
  if (pages > 1) rotationTimer = setInterval(() => { page++; render(); }, interval * 1000);
}

function scheduleFit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(fitRows);
}

function fitRows() {
  for (const row of document.querySelectorAll('.price-row')) {
    const styles = getComputedStyle(row);
    const width = row.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    const height = row.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    if (width <= 0 || height <= 0) continue;
    const price = row.querySelector('.price');
    const base = Math.min(height * .86, width * .055, 64);
    row.style.setProperty('--price-font', `${base}px`);
    // Mede o grupo inteiro: moeda, todos os dígitos, espaços e unidade.
    const first = price.firstElementChild.getBoundingClientRect();
    const last = price.lastElementChild.getBoundingClientRect();
    const natural = last.right - first.left;
    const factor = Math.min(1, (width * .46) / Math.max(1, natural));
    row.style.setProperty('--price-font', `${base * factor}px`);
    const name = row.querySelector('.product-name');
    const maximum = Math.min(height * .62, width * .053, 58);
    name.style.fontSize = `${maximum}px`;
    // Nomes extensos também precisam caber por inteiro na altura da linha.
    if (name.scrollHeight > name.clientHeight + 1 || name.scrollWidth > name.clientWidth + 1) {
      let low = .5, high = maximum;
      for (let iteration = 0; iteration < 10; iteration++) {
        const candidate = (low + high) / 2;
        name.style.fontSize = `${candidate}px`;
        if (name.scrollHeight > name.clientHeight + 1 || name.scrollWidth > name.clientWidth + 1) high = candidate;
        else low = candidate;
      }
      name.style.fontSize = `${low}px`;
    }
  }
}

function renderLogos() {
  const initials = state.settings.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();
  for (const side of ['left', 'right']) {
    const img = $('logo-' + side), fallback = $('logo-' + side + '-fallback'), url = state.settings[side + '_logo'];
    fallback.textContent = initials || 'TV'; fallback.hidden = Boolean(url); img.hidden = !url;
    img.onerror = () => { img.hidden = true; fallback.hidden = false; };
    if (url && img.getAttribute('src') !== url) img.src = url;
    else if (!url) img.removeAttribute('src');
  }
}

let cachedSync = null;
try {
  state = JSON.parse(localStorage.getItem('systv-state'));
  const timestamp = Number(localStorage.getItem('systv-last-sync'));
  if (timestamp > 0 && Number.isFinite(timestamp)) cachedSync = timestamp;
  if (state) render();
} catch {}
const connection = createTVConnection({
  lastSyncedAt: cachedSync,
  onState(snapshot, timestamp) {
    state = snapshot;
    void presence.report();
    try {
      localStorage.setItem('systv-state', JSON.stringify(snapshot));
      localStorage.setItem('systv-last-sync', String(timestamp));
    } catch {}
    render();
  },
  onStatus(status) {
    connectionStatus = status;
    const live = status.phase === 'live';
    $('connection-alert').hidden = live;
    $('tv-dot').classList.toggle('offline', !live);
    const labels = { live: 'Ao vivo', connecting: 'Conectando', offline: 'Sem conexão', polling: 'Atualização periódica' };
    $('tv-status').textContent = labels[status.phase];
    const titles = {
      connecting: 'Conectando ao servidor de preços…',
      offline: state ? 'Sem conexão. Os preços exibidos podem estar desatualizados.' : 'Sem conexão. Aguardando o catálogo de preços.',
      polling: 'Atualização em tempo real indisponível. Verificando preços periodicamente.',
    };
    $('connection-title').textContent = titles[status.phase] || '';
    $('connection-detail').textContent = status.lastSyncedAt
      ? `Últimos preços recebidos em ${new Date(status.lastSyncedAt).toLocaleString('pt-BR')}. Recuperação automática ativada.`
      : 'Tentando recuperar a conexão automaticamente.';
    updateRetry();
  },
});
function updateRetry() {
  $('connection-retry').textContent = connectionStatus?.nextRetryAt
    ? `Nova tentativa em ${Math.max(0, Math.ceil((connectionStatus.nextRetryAt - Date.now()) / 1000))}s`
    : connectionStatus?.phase === 'live' ? '' : 'Verificando conexão…';
}
$('retry-connection').onclick = () => connection.retry();
window.addEventListener('online', () => connection.retry());
window.addEventListener('offline', () => connection.offline());
document.addEventListener('visibilitychange', () => { if (!document.hidden) connection.check(); });
window.addEventListener('pagehide', () => { connection.stop(); presence.stop(); });
window.addEventListener('pageshow', event => { if (event.persisted) { connection.start(); presence.start(); } });
connection.start();
presence.start();
function clock() { $('clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); updateRetry(); }
clock(); setInterval(clock, 1000);
window.addEventListener('resize', render);
new ResizeObserver(scheduleFit).observe($('board'));
document.fonts?.ready.then(scheduleFit);
document.fonts?.addEventListener('loadingdone', scheduleFit);
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {}
};
import { createTVConnection } from './tv-connection.js';
