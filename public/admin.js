import { createSecurityUI } from './security.js';
import { TV_PALETTES, getTVPalette } from './tv-palettes.js';
function makeIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '/icons.svg#' + name); svg.append(use); return svg;
}
function setButtonLabel(button, text, icon) { button.replaceChildren(makeIcon(icon), document.createTextNode(text)); }
let catalogPage = 0, catalogView = 'preview', catalogScreen = '';
const TV_PAGE_SIZE = 34;
const pageLabel = page => 'Tela ' + String(page).padStart(2, '0');
function screenProducts(id) {
  return state.products.filter(product => product.screen === id).sort((a, b) => a.position - b.position || a.id - b.id);
}
function productPage(product) {
  const products = screenProducts(product.screen).filter(item => item.id !== product.id);
  const index = products.filter(item => item.position < product.position || (item.position === product.position && (!product.id || item.id < product.id))).length;
  return Math.floor(index / TV_PAGE_SIZE) + 1;
}
function updateProductPage() {
  if (!state) return;
  const form = $('product-form');
  const product = { screen: form.dataset.screen, id: Number(form.elements.id.value) || undefined, position: Number(form.elements.position.value) };
  if (!product.screen || !Number.isInteger(product.position) || product.position < 0) return;
  const page = productPage(product);
  const count = screenProducts(product.screen).length + (product.id ? 0 : 1);
  const pages = Math.max(1, Math.ceil(count / TV_PAGE_SIZE));
  const interval = state.screens.find(screen => screen.id === product.screen)?.page_interval_seconds ?? 15;
  $('product-page-context').textContent = `Este produto será exibido na ${pageLabel(page)}. ` + (pages > 1 ? `O catálogo terá ${pages} telas, alternadas a cada ${interval} segundos.` : 'O catálogo cabe na Tela 01.') + ' Layout de TV com duas colunas: até 34 produtos por tela. Em telas estreitas, são 17 por tela.';
}
const $ = id => document.getElementById(id);
const money = value => (value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let screenPresence = new Map(), presenceChecking = false;
let securityUI;
let state, currentUser = null, selected = 'tv01', section = 'products', users = [];

async function api(route, method = 'GET', data, binary = false) {
  const response = await fetch('/api/' + route, {
    method,
    ...(data !== undefined ? { headers: { 'Content-Type': binary ? data.type : 'application/json' }, body: binary ? data : JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) setUser(null);
    throw new Error(result.error);
  }
  return result;
}

function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = error ? 'error' : 'success';
}

function setUser(user) {
  currentUser = user;
  document.body.classList.remove('auth-pending');
  document.body.classList.toggle('login-view', !user);
  $('app-topbar').hidden = !user;
  $('page-heading').hidden = !user;
  if (user) $('workspace').before($('notice'));
  else $('login-form').before($('notice'));
  screenPresence.clear();
  if (user) refreshPresence();
  $('login').hidden = Boolean(user);
  if (!user) api('activation/status').then(status => {
    $('initial-access-help').hidden = !status.required;
  }).catch(() => {});
  $('workspace').hidden = !user;
  $('navigation').hidden = !user;
  $('logout').hidden = !user;
  $('current-user').textContent = user?.name || '';
  $('current-user-role').textContent = user ? user.role === 'admin' ? 'Administrador' : 'Operador' : '';
  document.querySelectorAll('[data-admin]').forEach(el => el.hidden = user?.role !== 'admin');
  if (!user || user.role !== 'admin' && section !== 'users') section = 'products';
  if (!user) securityUI?.clear();
  if (!user) document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  showSection(section);
  render();
}

let versionCheckedAt = 0, versionPending = false;
async function refreshVersion(force = false) {
  if (versionPending || !force && Date.now() - versionCheckedAt < 60000) return;
  versionPending = true;
  $('version-refresh').disabled = true;
  $('version-refresh').textContent = 'Verificando…';
  try {
    const info = await api(force ? 'version?refresh=1' : 'version');
    $('installed-version').textContent = `v${info.current}`;
    $('version-status').textContent = info.update_available ? `Nova versão: v${info.latest} ↗` : info.status === 'checked' ? 'Nenhuma nova versão' : 'Verificação indisponível';
    $('version-box').classList.toggle('has-update', info.update_available);
    $('version-box').href = info.release_url;
    $('version-box').title = info.status === 'unavailable' ? 'Não foi possível consultar atualizações. Verifique o acesso do servidor à internet.' : info.update_available ? 'Veja as novidades. Para atualizar, peça ao responsável pelo servidor para executar systvctl update.' : 'Consultar versões publicadas no GitHub';
    if (info.checked_at) $('version-status').title = `Consulta ao GitHub: ${new Date(info.checked_at).toLocaleString('pt-BR')}`;
    versionCheckedAt = Date.now();
  } catch {
    $('version-status').textContent = 'Verificação indisponível';
    $('version-status').removeAttribute('title');
    versionCheckedAt = Date.now();
  } finally {
    versionPending = false;
    $('version-refresh').disabled = false;
    $('version-refresh').textContent = 'Verificar agora';
  }
}

async function refreshSession() {
  const session = await api('session');
  setUser(session.user);
  if (session.user) refreshVersion();
}

function showSection(value) {
  section = currentUser?.role === 'admin' || value === 'users' ? value : 'products';
  const labels = {
    products: ['Produtos e preços', 'Atualize aqui. Suas TVs acompanham na hora.'],
    mail: ['Configuração de e-mails', 'Configure o envio e teste a comunicação com sua equipe.'],
    units: ['Unidades de venda', 'Gerencie as unidades disponíveis no cadastro de produtos.'],
    identity: ['Identidade da empresa', 'Seu nome e suas logos em todas as telas.'],
    users: ['Usuários e permissões', 'Defina quem pode gerenciar cada TV.'],
  };
  $('page-title').textContent = labels[section][0];
  $('page-description').textContent = labels[section][1];
  document.querySelectorAll('.admin-section').forEach(el => el.hidden = el.id !== `${section}-section`);
  document.querySelectorAll('[data-section]').forEach(el => el.classList.toggle('active', el.dataset.section === section));
}

function availableScreens() {
  return state?.screens.filter(screen => currentUser?.role === 'admin' || currentUser?.screens.includes(screen.id)) || [];
}

function makeButton(label, action, danger = false) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = `small secondary${danger ? ' danger' : ''}`;
  button.append(makeIcon(danger ? 'delete' : 'edit'));
  button.title = label; button.setAttribute('aria-label', label); button.onclick = action;
  return button;
}

function renderScreenOptions(screens) {
  const container = $('screen-options');
  const existing = new Map([...container.querySelectorAll('.screen-option')].map(option => [option.dataset.screen, option]));
  for (const [id, option] of existing) if (!screens.some(screen => screen.id === id)) option.remove();
  screens.forEach((screen, index) => {
    let option = existing.get(screen.id);
    if (!option) {
      option = document.createElement('label'); option.className = 'screen-option'; option.dataset.screen = screen.id;
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'editing-screen'; radio.value = screen.id;
      radio.onchange = () => { selected = screen.id; $('search').value = ''; render(); };
      const icon = document.createElement('span'); icon.className = 'screen-icon'; icon.setAttribute('aria-hidden', 'true');
      icon.append(makeIcon('monitor'));
      const content = document.createElement('span'); content.className = 'screen-option-content';
      const name = document.createElement('strong'); name.className = 'screen-option-name';
      const summary = document.createElement('span'); summary.className = 'screen-option-summary';
      const status = document.createElement('span'); status.className = 'screen-option-status';
      const presence = document.createElement('span'); presence.className = 'screen-presence';
      content.append(name, presence, summary, status);
      const check = document.createElement('span'); check.className = 'screen-check'; check.append(makeIcon('check')); check.setAttribute('aria-hidden', 'true');
      option.append(radio, icon, content, check);
    }
    const active = screen.id === selected;
    option.classList.toggle('selected', active);
    option.querySelector('input').checked = active;
    option.querySelector('.screen-option-name').textContent = screen.name;
    const products = state.products.filter(product => product.screen === screen.id);
    const offers = products.filter(product => product.highlight).length;
    option.querySelector('.screen-option-summary').textContent = `${products.length} ${products.length === 1 ? 'produto' : 'produtos'} · ${offers} ${offers === 1 ? 'oferta' : 'ofertas'}`;
    option.querySelector('.screen-option-status').textContent = active ? 'Selecionada para edição' : 'Selecionar esta TV';
    const position = container.querySelectorAll('.screen-option')[index];
    if (position !== option) container.insertBefore(option, position || null);
  });
  container.hidden = !screens.length;
  renderPresence();
}

function render() {
  if (!state || !currentUser) return;
  const screens = availableScreens();
  if (!screens.some(screen => screen.id === selected)) selected = screens[0]?.id || '';
  renderScreenOptions(screens);
  const selectedScreen = screens.find(screen => screen.id === selected);
  $('editing-screen').textContent = selectedScreen?.name || 'Nenhuma TV disponível';
  $('rotation-summary').textContent = selectedScreen ? `Troca de páginas: ${selectedScreen.page_interval_seconds ?? 15} segundos, quando houver mais de uma página.` : '';
  $('catalog-description').textContent = selectedScreen ? `Alterações neste catálogo atualizam o painel de “${selectedScreen.name}”.` : 'Selecione uma TV autorizada para gerenciar produtos.';
  const url = '/tv?screen=' + encodeURIComponent(selected);
  for (const id of ['open-screen', 'sidebar-tv']) { $(id).href = url; $(id).hidden = !selected; }
  $('add-product').disabled = !selected;
  $('product-form').querySelectorAll('input, select, button').forEach(input => input.disabled = !selected);
  $('no-permissions').hidden = screens.length > 0;
  const products = screenProducts(selected);
  if (catalogScreen !== selected) { catalogScreen = selected; catalogPage = 0; resetProductEditor(); }
  const pages = Math.max(1, Math.ceil(products.length / TV_PAGE_SIZE));
  $('catalog-pages').hidden = !selectedScreen;
  $('catalog-pages').textContent = pages > 1 ? `Catálogo dividido em ${pages} telas. Cada tela comporta até 34 produtos e a troca acontece a cada ${selectedScreen?.page_interval_seconds ?? 15} segundos. O próximo cadastro no final da lista será na ${pageLabel(Math.floor(products.length / TV_PAGE_SIZE) + 1)}.` : `Catálogo na Tela 01 · ${products.length}/34 produtos. Ao ultrapassar 34 produtos, a Tela 02 será criada automaticamente.`;
  if ($('product-form').dataset.screen) updateProductPage();
  $('count').textContent = products.length;
  $('offers').textContent = products.filter(product => product.highlight).length;
  $('screens-count').textContent = screens.length;
  catalogPage = Math.min(catalogPage, Math.max(pages - 1, $('product-form').elements.name.value.trim() ? productPage({screen:selected,id:Number($('product-form').elements.id.value)||undefined,position:Number($('product-form').elements.position.value)}) - 1 : 0));
  const currentProducts = products.slice(catalogPage * TV_PAGE_SIZE, (catalogPage + 1) * TV_PAGE_SIZE);
  const query = $('search').value.trim().toLocaleLowerCase();
  const visible = currentProducts.filter(product => product.name.toLocaleLowerCase().includes(query));
  renderCatalogPreview(products, currentProducts, pages, selectedScreen, query);
  $('products').replaceChildren(...visible.map(product => {
    const tr = document.createElement('tr'); tr.setAttribute('role', 'row');
    const fields = [['Produto', product.name + ' · ' + pageLabel(Math.floor(products.indexOf(product) / TV_PAGE_SIZE) + 1)], ['Preço', 'R$ ' + money(product.price)], ['Unidade', product.unit], ['Ordem', product.position], ['Exibição na TV', product.highlight ? 'Em oferta' : 'Preço normal']];
    for (const [label, value] of fields) {
      const td = document.createElement('td'); td.setAttribute('role', 'cell'); td.dataset.label = label; td.textContent = value; tr.append(td);
    }
    const badge = document.createElement('span');
    badge.className = 'price-status ' + (product.highlight ? 'is-offer' : 'is-normal');
    badge.append(makeIcon(product.highlight ? 'tag' : 'receipt'), document.createTextNode(product.highlight ? 'Em oferta' : 'Preço normal'));
    badge.title = product.highlight ? 'Produto destacado como oferta no painel da TV.' : 'Produto exibido sem destaque de oferta no painel da TV.';
    tr.children[4].replaceChildren(badge);
    const actions = document.createElement('td'); actions.dataset.label = 'Ações'; actions.setAttribute('role', 'cell');
    const buttons = document.createElement('div'); buttons.className = 'row-actions';
    buttons.append(makeButton('Editar', () => openEditor(product)), makeButton('Excluir', async () => {
      if (!confirm(`Excluir “${product.name}”?`)) return;
      try { await api('products/' + product.id, 'DELETE'); notice('Produto excluído. TVs atualizadas.'); }
      catch (error) { notice(error.message, true); }
    }, true));
    actions.append(buttons); tr.append(actions); return tr;
  }));
  $('empty').hidden = visible.length > 0;
  $('delete-screen').disabled = state.screens.length <= 1;
  const form = $('settings-form');
  // Não apaga alterações ainda não salvas quando outra TV recebe uma atualização.
  if (!form.dataset.dirty) {
    form.elements.name.value = state.settings.name;
    form.elements.message.value = state.settings.message;
  }
  for (const side of ['left', 'right']) {
    const url = state.settings[`${side}_logo`];
    const img = $('preview-' + side); img.hidden = !url;
    if (url && img.getAttribute('src') !== url) img.src = url;
    if (!url) img.removeAttribute('src');
    $('placeholder-' + side).hidden = Boolean(url);
    document.querySelector(`.remove-logo[data-side="${side}"]`).disabled = !url;
  }
  renderUnits();
  renderUnitOptions();
  if (section === 'users') renderUsers();
}

function openEditor(product) {
  if (!selected) return;
  const form = $('product-form'); form.reset();
  form.elements.id.value = product?.id || '';
  form.elements.name.value = product?.name || '';
  form.elements.price.value = product ? money(product.price).replaceAll('.', '') : '';
  renderUnitOptions();
  form.elements.unit.value = product?.unit || (state.units?.some(unit => unit.code === 'KG') ? 'KG' : state.units?.[0]?.code || '');
  form.elements.position.value = product?.position ?? Math.max(-1, ...state.products.filter(p => p.screen === selected).map(p => p.position)) + 1;
  form.elements.highlight.checked = Boolean(product?.highlight);
  form.dataset.screen = product?.screen || selected;
  $('product-screen-context').textContent = 'TV: ' + (state.screens.find(screen => screen.id === form.dataset.screen)?.name || '');
  $('editor-title').textContent = product ? 'Editar produto' : 'Novo produto';
  $('form-error').textContent = ''; updateProductPage();
  catalogView = 'preview';
  catalogPage = product ? productPage(product) - 1 : Math.floor(screenProducts(selected).length / TV_PAGE_SIZE);
  render();
  if (window.innerWidth < 1000) $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadUsers() { users = currentUser.role === 'admin' ? await api('users') : [{ ...currentUser, active: true }]; renderUsers(); }
function renderUsers() {
  $('users').replaceChildren(...users.map(user => {
    const tr = document.createElement('tr');
    const names = user.role === 'admin' ? 'Todas as TVs' : user.screens.map(id => state.screens.find(s => s.id === id)?.name || id).join(', ') || 'Nenhuma TV';
    const fields = [
      ['Usuário', user.name],
      ['Perfil', user.role === 'admin' ? 'Administrador' : 'Operador'], ['TVs permitidas', names], ['Status', user.active ? 'Ativo' : 'Desativado'],
    ];
    tr.setAttribute('role', 'row');
    for (const [label, value] of fields) {
      const td = document.createElement('td'); td.setAttribute('role', 'cell'); td.dataset.label = label;
      if (label === 'Usuário') {
        const name = document.createElement('span'); name.className = 'user-name'; name.textContent = user.name;
        const login = document.createElement('span'); login.className = 'user-login'; login.textContent = user.username + (user.email ? ' · ' + user.email : ' · Sem e-mail');
        td.append(name, login);
      } else td.textContent = value;
      tr.append(td);
    }
    const actions = document.createElement('td'); actions.dataset.label = 'Ações'; actions.setAttribute('role', 'cell');
    const buttons = document.createElement('div'); buttons.className = 'row-actions';
    const del = makeButton('Excluir', async () => {
      if (!confirm(`Excluir o usuário “${user.name}”?`)) return;
      try { await api('users/' + user.id, 'DELETE'); await loadUsers(); notice('Usuário excluído.'); }
      catch (error) { notice(error.message, true); }
    }, true);
    del.disabled = user.id === currentUser.id;
    const edit = makeButton('Editar', () => openUser(user));
    for (const [button, label, icon] of [[edit, 'Editar', 'edit'], [del, 'Excluir', 'delete']]) {
      button.replaceChildren(makeIcon(icon)); button.title = `${label} usuário ${user.name}`; button.setAttribute('aria-label', button.title);
    }
    buttons.append(edit); if (currentUser.role === 'admin') buttons.append(del); actions.append(buttons); tr.append(actions); return tr;
  }));
}

function roleFields() {
  const admin = $('user-form').elements.role.value === 'admin';
  $('permissions-field').hidden = admin; $('admin-permissions').hidden = !admin;
}

async function openUser(user) {
  const form = $('user-form'); form.reset();
  form.elements.id.value = user?.id || '';
  form.elements.name.value = user?.name || '';
  form.elements.username.value = user?.username || '';
  form.elements.email.value = user?.email || '';
  form.elements.email.readOnly = Boolean(user?.two_factor_enabled);
  form.elements.role.value = user?.role || 'editor';
  form.elements.active.checked = user?.active ?? true;
  form.elements.password.required = !user;
  $('password-help').textContent = user ? 'Deixe em branco para manter a senha atual. Mínimo de 8 caracteres para uma nova senha.' : 'Mínimo de 8 caracteres.';
  $('user-screen-options').replaceChildren(...state.screens.map(screen => {
    const label = document.createElement('label'); label.className = 'check';
    const check = document.createElement('input'); check.type = 'checkbox'; check.name = 'screens'; check.value = screen.id; check.checked = user?.screens.includes(screen.id) || false;
    label.append(check, document.createTextNode(screen.name)); return label;
  }));
  const own = user?.id === currentUser.id;
  form.dataset.own = String(own);
  form.elements.username.readOnly = own;
  form.elements.role.disabled = own; form.elements.active.disabled = own;
  $('user-current-password').hidden = !own; form.elements.current_password.required = false;
  $('user-security').hidden = !own;
  $('user-security-other').hidden = own;
  $('user-security-other').textContent = !user ? 'O 2FA é opcional. Após o cadastro, o próprio usuário pode ativá-lo aqui, confirmando um código por e-mail.' : `2FA ${user.two_factor_enabled ? 'ativado' : 'desativado'}. Por escolha pessoal, a ativação ou desativação deve ser feita pelo próprio usuário na edição de seu cadastro.`;
  securityUI.resetEnrollment();
  $('user-title').textContent = user ? 'Editar usuário' : 'Novo usuário';
  $('user-error').textContent = ''; roleFields();
  $('permissions-field').hidden = own || form.elements.role.value === 'admin';
  if (own) form.querySelectorAll('[name=screens]').forEach(input => input.disabled = true);
  $('user-dialog').showModal();
  if (own) try { await securityUI.loadAccount(); } catch (error) { $('user-error').textContent = error.message; }
}

$('login-form').onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true; setButtonLabel(button, 'Entrando…', 'login');
  try {
    const response = await api('login', 'POST', Object.fromEntries(new FormData(event.target)));
    if (await securityUI.login(response)) { state = await api('state'); render(); }
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; setButtonLabel(button, 'Entrar no painel', 'login'); }
};
$('logout').onclick = async () => {
  try { await api('logout', 'POST', {}); setUser(null); notice('Sessão encerrada.'); }
  catch (error) { notice(error.message, true); }
};
document.querySelectorAll('[data-section]').forEach(button => button.onclick = async () => {
  showSection(button.dataset.section);
  try {
    if (section === 'users') await loadUsers();
    if (section === 'mail') await securityUI.loadMail();

  } catch (error) { notice(error.message, true); }
});
$('search').oninput = () => {
  const query = $('search').value.trim().toLocaleLowerCase();
  const index = screenProducts(selected).findIndex(product => product.name.toLocaleLowerCase().includes(query));
  if (index >= 0) catalogPage = Math.floor(index / TV_PAGE_SIZE);
  render();
};
$('view-preview').onclick = () => { catalogView = 'preview'; render(); };
$('view-list').onclick = () => { catalogView = 'list'; render(); };
$('add-product').onclick = () => openEditor();
$('close-editor').onclick = () => openEditor();
$('product-form').addEventListener('input', () => { updateProductPage(); catalogPage = Math.max(0, productPage({screen: $('product-form').dataset.screen, id: Number($('product-form').elements.id.value) || undefined, position: Number($('product-form').elements.position.value)}) - 1); render(); });
$('product-form').onsubmit = async event => {
  event.preventDefault(); const form = event.target; const f = form.elements;
  const raw = f.price.value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) { $('form-error').textContent = 'Use um preço como 49,90, sem separador de milhar.'; return; }
  const product = { name: f.name.value, price: Math.round(Number(raw) * 100), unit: f.unit.value, position: Number(f.position.value), screen: form.dataset.screen, highlight: f.highlight.checked };
  if (f.id.value) product.id = Number(f.id.value);
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try {
    const previousPages = Math.max(1, Math.ceil(screenProducts(product.screen).length / TV_PAGE_SIZE));
    const result = await api('products', product.id ? 'PUT' : 'POST', product);
    state = await api('state'); render();
    const saved = state.products.find(item => item.id === (product.id || result.id));
    const page = saved ? productPage(saved) : productPage(product);
    const pages = Math.max(1, Math.ceil(screenProducts(product.screen).length / TV_PAGE_SIZE));
    const interval = state.screens.find(screen => screen.id === product.screen)?.page_interval_seconds ?? 15;
    resetProductEditor(); catalogPage = page - 1; render();
    notice(`Produto salvo na ${pageLabel(page)}. ` + (pages > previousPages ? `A ${pageLabel(pages)} foi criada automaticamente. Troca a cada ${interval} segundos.` : 'Atualização enviada à TV.'));
  }
  catch (error) { $('form-error').textContent = error.message; }
  finally { submit.disabled = false; }
};
$('settings-form').oninput = event => event.currentTarget.dataset.dirty = 'true';
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  try { await api('settings', 'PUT', Object.fromEntries(new FormData(event.target))); delete event.target.dataset.dirty; notice('Nome e mensagem atualizados em todas as TVs.'); }
  catch (error) { notice(error.message, true); }
};
document.querySelectorAll('.logo-form').forEach(form => form.onsubmit = async event => {
  event.preventDefault(); const file = form.elements.image.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { notice('A imagem deve ter no máximo 5 MB.', true); return; }
  const button = form.querySelector('button[type="submit"]') || form.querySelector('button'); button.disabled = true;
  try { await api('logos/' + form.dataset.side, 'PUT', file, true); form.reset(); notice('Logo atualizada em todas as TVs.'); }
  catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelectorAll('.remove-logo').forEach(button => button.onclick = async () => {
  if (!confirm('Remover esta logo de todas as TVs?')) return;
  try { await api('logos/' + button.dataset.side, 'DELETE'); notice('Logo removida.'); }
  catch (error) { notice(error.message, true); }
});
function updateScreenPreview() {
  const form = $('screen-form');
  const palette = TV_PALETTES.find(palette => palette.id === form.elements.color_scheme.value) || TV_PALETTES[0];
  const preview = $('screen-palette-preview');
  for (const key of ['background', 'row', 'text', 'accent', 'badge']) preview.style.setProperty('--preview-' + key, palette[key]);
  $('preview-screen-name').textContent = form.elements.name.value.trim() || 'Nome da TV';
  document.querySelectorAll('.palette-option').forEach(label => label.classList.toggle('chosen', label.querySelector('input').checked));
}
function renderPaletteOptions(selected) {
  $('palette-options').replaceChildren(...TV_PALETTES.map(palette => {
    const label = document.createElement('label'); label.className = 'palette-option';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'color_scheme'; radio.value = palette.id; radio.checked = palette.id === selected; radio.required = true; radio.onchange = updateScreenPreview;
    const preview = document.createElement('span'); preview.className = 'palette-preview'; preview.style.background = palette.background;
    const row = document.createElement('span'); row.style.background = palette.row; row.style.color = palette.text; row.className = 'palette-sample';
    const product = document.createElement('span'); product.textContent = 'Produto';
    const price = document.createElement('strong'); price.textContent = 'R$ 29,90'; price.style.color = palette.accent; row.append(product, price); preview.append(row);
    const title = document.createElement('strong'); title.textContent = palette.name;
    const description = document.createElement('small'); description.textContent = palette.description;
    label.append(radio, preview, title, description); return label;
  }));
}
function openScreenDialog(rename = false) {
  const form = $('screen-form'); form.reset(); form.dataset.screen = rename ? selected : '';
  const screen = rename ? state.screens.find(screen => screen.id === selected) : null;
  if (screen) form.elements.name.value = screen.name;
  form.elements.page_interval_seconds.value = screen?.page_interval_seconds ?? 15;
  renderPaletteOptions(screen?.color_scheme || 'classic');
  $('screen-dialog-title').textContent = rename ? 'Configurar a TV' : 'Cadastrar uma TV';
  setButtonLabel($('save-screen'), rename ? 'Salvar configurações' : 'Cadastrar TV', rename ? 'save' : 'plus');
  $('screen-error').textContent = ''; updateScreenPreview(); $('screen-dialog').showModal();
}
$('add-screen').onclick = () => openScreenDialog();
$('rename-screen').onclick = () => openScreenDialog(true);
$('close-screen').onclick = () => $('screen-dialog').close();
$('screen-form').elements.name.addEventListener('input', updateScreenPreview);
$('cancel-screen').onclick = () => $('screen-dialog').close();
$('screen-form').onsubmit = async event => {
  event.preventDefault();
  try {
    const id = event.target.dataset.screen;
    const data = Object.fromEntries(new FormData(event.target));
    data.page_interval_seconds = Number(data.page_interval_seconds);
    const result = await api(id ? 'screens/' + id : 'screens', id ? 'PUT' : 'POST', data);
    state = await api('state'); selected = result.id; $('search').value = ''; render();
    event.target.reset(); $('screen-dialog').close();
    notice(id ? 'Configurações atualizadas. As cores e o intervalo já estão em vigor na TV.' : 'TV cadastrada e selecionada para edição. Adicione os produtos e autorize os operadores na área de usuários.');
  }
  catch (error) { if ($('screen-dialog').open) $('screen-error').textContent = error.message; else notice(error.message, true); }
};
$('delete-screen').onclick = async () => {
  if (!confirm('Excluir esta TV e todos os produtos dela?')) return;
  try { await api('screens/' + selected, 'DELETE'); await refreshSession(); notice('TV excluída.'); }
  catch (error) { notice(error.message, true); }
};
$('version-refresh').onclick = () => refreshVersion(true);
$('add-user').onclick = () => openUser();
$('profile-access').onclick = () => openUser({ ...currentUser, active: true });
$('close-user').onclick = () => $('user-dialog').close();
$('user-form').elements.role.onchange = roleFields;
$('user-form').elements.password.oninput = () => {
  const form = $('user-form');
  form.elements.current_password.required = form.dataset.own === 'true' && form.elements.password.value !== '';
};
$('user-form').onsubmit = async event => {
  event.preventDefault(); const f = event.target.elements;
  const user = { name: f.name.value, username: f.username.value, email: f.email.value, password: f.password.value, role: f.role.value, active: f.active.checked,
    screens: [...event.target.querySelectorAll('[name="screens"]:checked')].map(input => input.value) };
  if (f.id.value) user.id = Number(f.id.value);
  try {
    const own = user.id === currentUser.id;
    if (own) await api('account/profile', 'PUT', { name: user.name, email: user.email, password: user.password, current_password: f.current_password.value });
    else await api('users', user.id ? 'PUT' : 'POST', user);
    $('user-dialog').close();
    if (own) { await refreshSession(); await loadUsers(); notice('Seu usuário foi atualizado.'); }
    else { await loadUsers(); notice('Usuário salvo. As permissões já estão em vigor.'); }
  } catch (error) { if ($('user-dialog').open) $('user-error').textContent = error.message; else notice(error.message, true); }
};
securityUI = createSecurityUI({ api, refreshSession, notice, user: () => currentUser });
try { state = await api('state'); await refreshSession(); await securityUI.prepareReset(); } catch (error) { setUser(null); notice(error.message, true); }
const events = new EventSource('/api/events');
events.onmessage = event => { state = JSON.parse(event.data); $('connection').textContent = 'Ao vivo'; render(); };
events.onerror = () => $('connection').textContent = 'Reconectando…';
setInterval(() => { if (currentUser) refreshSession().catch(error => notice(error.message, true)); }, 30000);
window.addEventListener('focus', () => { if (currentUser) refreshSession().catch(error => notice(error.message, true)); });

function renderPresence() {
  document.querySelectorAll('.screen-option').forEach(option => {
    const status = screenPresence.get(option.dataset.screen);
    const badge = option.querySelector('.screen-presence');
    const known = typeof status?.online === 'boolean';
    badge.className = 'screen-presence ' + (known ? status.online ? 'online' : 'offline' : 'checking');
    badge.textContent = known ? status.online ? 'Online' : 'Offline' : 'Verificando conexão';
    badge.title = known ? status.online ? 'Painel conectado ao servidor.' : 'Nenhum painel respondeu nos últimos 45 segundos.' : 'Aguardando confirmação do servidor.';
  });
}
async function refreshPresence() {
  if (!currentUser || presenceChecking) return;
  presenceChecking = true;
  const user = currentUser;
  try {
    const response = await fetch('/api/screens/status', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error();
    const statuses = await response.json();
    if (currentUser !== user) return;
    screenPresence = new Map(statuses.map(status => [status.id, status]));
  } catch { screenPresence.clear(); }
  finally { presenceChecking = false; renderPresence(); }
}
refreshPresence();
setInterval(refreshPresence, 5000);
window.addEventListener('focus', refreshPresence);

function renderUnitOptions() {
  const select = $('product-form').elements.unit;
  const value = select.value;
  const units = state?.units || [];
  const signature = JSON.stringify(units);
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  const selectButton = document.createElement('button'); selectButton.type = 'button';
  selectButton.append(document.createElement('selectedcontent'));
  select.replaceChildren(selectButton, ...units.map(unit => new Option(`${unit.code} · ${unit.name}`, unit.code)));
  if (units.some(unit => unit.code === value)) select.value = value;
  else if ($('product-form').dataset.screen && value) {
    selectButton.after(new Option('Selecione uma unidade cadastrada', '', true, true));
  }
}
function renderUnits() {
  $('units').replaceChildren(...(state?.units || []).map(unit => {
    const row = document.createElement('tr'); row.setAttribute('role', 'row');
    const count = state.products.filter(product => product.unit === unit.code).length;
    for (const [label, value] of [['Sigla', unit.code], ['Descrição', unit.name], ['Produtos', count]]) {
      const cell = document.createElement('td'); cell.setAttribute('role', 'cell'); cell.dataset.label = label; cell.textContent = value; row.append(cell);
    }
    const actions = document.createElement('td'); actions.dataset.label = 'Ações'; actions.setAttribute('role', 'cell');
    const buttons = document.createElement('div'); buttons.className = 'row-actions';
    const remove = makeButton('Excluir', async () => {
      if (!confirm(`Excluir a unidade ${unit.code}?`)) return;
      try { await api('units/' + encodeURIComponent(unit.code), 'DELETE'); state = await api('state'); render(); notice('Unidade excluída.'); }
      catch (error) { notice(error.message, true); }
    }, true);
    remove.disabled = count > 0 || state.units.length <= 1;
    if (count) remove.title = 'Esta unidade está em uso por produtos.';
    buttons.append(makeButton('Editar', () => openUnit(unit)), remove); actions.append(buttons);
    row.append(actions); return row;
  }));
}
function openUnit(unit) {
  const form = $('unit-form'); form.reset(); form.dataset.original = unit?.code || '';
  form.elements.code.value = unit?.code || ''; form.elements.name.value = unit?.name || '';
  $('unit-title').textContent = unit ? 'Editar unidade' : 'Nova unidade';
  $('unit-error').textContent = ''; $('unit-dialog').showModal();
}
$('add-unit').onclick = () => openUnit();
$('close-unit').onclick = () => $('unit-dialog').close();
$('unit-form').onsubmit = async event => {
  event.preventDefault(); const form = event.target;
  try {
    const original = form.dataset.original;
    await api('units' + (original ? '/' + encodeURIComponent(original) : ''), original ? 'PUT' : 'POST', Object.fromEntries(new FormData(form)));
    state = await api('state'); render(); $('unit-dialog').close(); notice('Unidade salva. Cadastro de produtos e TVs atualizados.');
  } catch (error) { $('unit-error').textContent = error.message; }
};

function renderCatalogPreview(products, current, pages, screen, query) {
  const form = $('product-form'), fields = form.elements;
  const editingId = Number(fields.id.value);
  const hasDraft = Boolean(fields.name.value.trim()) && form.dataset.screen === selected;
  if (hasDraft) {
    const price = Number(fields.price.value.replace(',', '.'));
    const draft = { id: editingId || Number.MAX_SAFE_INTEGER, name: fields.name.value.trim(), price: Number.isFinite(price) ? Math.round(price * 100) : 0, unit: fields.unit.value, position: Number(fields.position.value), highlight: fields.highlight.checked, draft: true };
    const previewProducts = products.filter(item => item.id !== editingId).concat(draft).sort((a,b) => a.position - b.position || a.id - b.id);
    pages = Math.max(1, Math.ceil(previewProducts.length / TV_PAGE_SIZE));
    catalogPage = Math.min(catalogPage, pages - 1);
    current = previewProducts.slice(catalogPage * TV_PAGE_SIZE, (catalogPage + 1) * TV_PAGE_SIZE);
    products = previewProducts;
  }
  $('editor-title').textContent = editingId ? 'Editar produto' : 'Novo produto';
  const tabs = $('catalog-page-tabs');
  const signature = JSON.stringify([pages, products.length, catalogPage, query]);
  if (tabs.dataset.signature !== signature) {
    tabs.dataset.signature = signature;
    tabs.replaceChildren(...Array.from({ length: pages }, (_, index) => {
      const button = document.createElement('button'); button.type = 'button';
      const items = products.slice(index * TV_PAGE_SIZE, (index + 1) * TV_PAGE_SIZE);
      const matches = items.filter(product => product.name.toLocaleLowerCase().includes(query)).length;
      button.textContent = `${pageLabel(index + 1)} · ${query ? matches + ' encontrados' : items.length + ' produtos'}`;
      button.setAttribute('aria-pressed', String(index === catalogPage));
      button.onclick = () => { catalogPage = index; render(); }; return button;
    }));
  }
  $('catalog-preview').hidden = catalogView !== 'preview';
  $('catalog-list').hidden = catalogView !== 'list';
  $('view-preview').setAttribute('aria-pressed', String(catalogView === 'preview'));
  $('view-list').setAttribute('aria-pressed', String(catalogView === 'list'));
  const palette = getTVPalette(screen?.color_scheme);
  const preview = $('catalog-preview-screen');
  for (const key of ['background', 'row', 'text', 'accent', 'badge']) preview.style.setProperty('--preview-' + key, palette[key]);
  $('catalog-preview-company').textContent = state.settings.name;
  $('catalog-preview-name').textContent = screen?.name || 'Nenhuma TV selecionada';
  $('catalog-preview-page').textContent = `${pageLabel(catalogPage + 1)} de ${pages}`;
  const grid = $('catalog-preview-grid');
  const rows = Math.max(1, Math.ceil(current.length / 2));
  grid.style.setProperty('--preview-rows', rows);
  grid.replaceChildren(...current.map((product, index) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'catalog-preview-product' + (product.highlight ? ' highlighted' : '');
    button.classList.toggle('editing-product', Boolean(product.draft));
    if (product.draft) button.title = 'Prévia das alterações · Ainda não salvo';
    button.classList.toggle('search-muted', Boolean(query) && !product.name.toLocaleLowerCase().includes(query));
    const column = Math.floor(index / rows) + 1, row = index % rows + 1;
    button.setAttribute('aria-label', `${product.name}, ordem ${product.position}, ${pageLabel(catalogPage + 1)}, coluna ${column}, linha ${row}. Editar produto.`);
    button.title = `Coluna ${column} · Linha ${row} · Clique para editar`;
    const name = document.createElement('span'); name.className = 'preview-product-name'; name.textContent = product.name;
    const order = document.createElement('span'); order.className = 'preview-product-order'; order.textContent = 'Ordem ' + product.position;
    const price = document.createElement('strong'); price.textContent = 'R$ ' + money(product.price);
    const unit = document.createElement('small'); unit.textContent = product.unit;
    price.append(unit); button.append(order, name, price); button.onclick = () => { if (!product.draft) openEditor(product); }; return button;
  }));
  if (!current.length) { const empty = document.createElement('p'); empty.className = 'catalog-preview-empty'; empty.textContent = 'Adicione produtos para visualizar este painel.'; grid.append(empty); }
}

function resetProductEditor() {
  const form = $('product-form'); form.reset(); form.dataset.screen = selected;
  form.elements.id.value = ''; form.elements.position.value = Math.max(-1, ...screenProducts(selected).map(product => product.position)) + 1;
  renderUnitOptions(); form.elements.unit.value = state.units.some(unit => unit.code === 'KG') ? 'KG' : state.units[0]?.code || '';
  $('editor-title').textContent = 'Novo produto';
  $('product-screen-context').textContent = 'TV: ' + (state.screens.find(screen => screen.id === selected)?.name || '');
  $('form-error').textContent = ''; updateProductPage();
}
