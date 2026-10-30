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
  const index = Math.min(product.position, products.length);
  return Math.floor(index / TV_PAGE_SIZE) + 1;
}
function updateProductPage() {
  if (!state) return;
  const form = $('product-form');
  const product = { screen: form.dataset.screen, id: Number(form.elements.id.value) || undefined, position: Number(form.elements.position.value) };
  form.elements.position.max = screenProducts(product.screen).filter(item => item.id !== product.id).length;
  if (!product.screen || !Number.isInteger(product.position) || product.position < 0) return;
  const page = productPage(product);
  $('product-page-context').textContent = `${pageLabel(page)} · posição ${product.position}`;
}
const $ = id => document.getElementById(id);
const money = value => (value / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let screenPresence = new Map(), presenceChecking = false;
const displayLinks = new Map(), displayLinkRequests = new Map();
let displayLinkEpoch = 0;
let securityUI;
let state, currentUser = null, selected = 'tv01', section = 'products', users = [];
let draggedProduct = null, reorderPending = false, suppressProductClickUntil = 0;

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
  if (JSON.stringify([currentUser?.id,currentUser?.role,currentUser?.screens]) !== JSON.stringify([user?.id,user?.role,user?.screens])) {
    displayLinkEpoch++; displayLinks.clear();
    for (const id of ['open-screen','sidebar-tv']) $(id).removeAttribute('href');
  }
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
  if (!user) displayLinks.clear();
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
  const signature = JSON.stringify(screens.map(screen => [screen.id, screen.name]));
  if (container.dataset.signature !== signature) {
    container.replaceChildren(...screens.map(screen => new Option(screen.name, screen.id)));
    container.dataset.signature = signature;
  }
  container.value = selected;
  container.disabled = !screens.length;
  renderPresence();
}
$('screen-options').onchange = event => { selected = event.target.value; $('search').value = ''; render(); };

function render() {
  if (!state || !currentUser || draggedProduct) return;
  const screens = availableScreens();
  if (!screens.some(screen => screen.id === selected)) selected = screens[0]?.id || '';
  renderScreenOptions(screens);
  const selectedScreen = screens.find(screen => screen.id === selected);
  $('editing-screen').textContent = selectedScreen?.name || 'Nenhuma TV disponível';
  $('rotation-summary').textContent = selectedScreen ? `Páginas a cada ${selectedScreen.page_interval_seconds ?? 15}s` : '';
  $('catalog-description').textContent = selectedScreen ? 'Clique para editar · arraste para ordenar' : 'Selecione uma TV autorizada para gerenciar produtos.';
  updateDisplayLinkActions();

  $('add-product').disabled = !selected;
  $('rename-screen').disabled = !selected;
  $('product-form').querySelectorAll('input, select, button').forEach(input => input.disabled = !selected);
  $('delete-product').hidden = !state.products.some(product => product.id === Number($('product-form').elements.id.value));
  const editingProduct = state.products.find(product => product.id === Number($('product-form').elements.id.value));
  $('product-order-actions').hidden = !editingProduct;
  $('move-product-up').disabled = reorderPending || !editingProduct || editingProduct.position === 0;
  $('move-product-down').disabled = reorderPending || !editingProduct || editingProduct.position >= screenProducts(editingProduct.screen).length - 1;
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
    tr.tabIndex = 0; tr.setAttribute('aria-label', `${product.name}. Alt e seta para cima ou para baixo para mover.`);
    bindProductReorder(tr, product);
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
    const remove = makeButton('Excluir produto ' + product.name, () => deleteProduct(product, remove), true);
    buttons.append(makeButton('Editar', () => openEditor(product)), remove);
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

function updateDisplayLinkActions() {
  for (const id of ['open-screen', 'sidebar-tv']) {
    const link = $(id); link.hidden = !selected;
    if (selected) link.href = '/tv?screen=' + encodeURIComponent(selected) + '&preview=1'; else link.removeAttribute('href');
    link.setAttribute('aria-disabled', String(!selected));
  }
  $('copy-screen-link').disabled = !selected;
}
async function getDisplayLink(screen, renew = false, fresh = false) {
  if (!renew && !fresh && displayLinks.has(screen)) return displayLinks.get(screen);
  if (displayLinkRequests.has(screen)) {
    if (!renew) return displayLinkRequests.get(screen);
    await displayLinkRequests.get(screen).catch(() => {});
  }
  const epoch = displayLinkEpoch;
  const request = api(`screens/${encodeURIComponent(screen)}/display-link`, 'POST', { renew }).then(result => {
    if (epoch !== displayLinkEpoch || !currentUser || !availableScreens().some(item => item.id === screen)) throw new Error('A sessão mudou. Entre novamente para copiar o link.');
    const url = new URL(result.path, location.origin).href;
    displayLinks.set(screen, url);
    if ($('screen-form').dataset.screen === screen) $('screen-display-url').value = url;
    return url;
  }).finally(() => displayLinkRequests.delete(screen));
  displayLinkRequests.set(screen, request); return request;
}
$('copy-screen-link').onclick = async () => {
  const screen = selected, button = $('copy-screen-link');
  button.disabled = true;
  try {
    const url = await getDisplayLink(screen, false, true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(url);
    } catch {
      const previous = document.activeElement;
      const field = document.createElement('textarea'); field.className = 'sr-only'; field.value = url; field.readOnly = true;
      document.body.append(field); field.select();
      const copied = document.execCommand('copy'); field.remove(); previous?.focus();
      if (!copied) throw new Error('Copie o endereço em Configurar TV → Link de exibição.');
    }
    notice('Link da TV copiado. Use este endereço no navegador ou no gerenciador das telas.');
  } catch (error) { notice(error.message || 'Não foi possível copiar o link.', true); }
  finally { updateDisplayLinkActions(); }
};
$('renew-display-link').onclick = async () => {
  const screen = $('screen-form').dataset.screen;
  const name = state.screens.find(item => item.id === screen)?.name || 'esta TV';
  if (!screen || !confirm(`Renovar o link de “${name}”? O link anterior e as autorizações dos dispositivos serão invalidados. Será necessário configurar o novo link nos dispositivos desta TV.`)) return;
  const button = $('renew-display-link'); button.disabled = true;
  try {
    await getDisplayLink(screen, true); updateDisplayLinkActions(); await refreshPresence();
    notice('Link renovado. Copie o novo endereço para os dispositivos desta TV.');
  } catch (error) { $('screen-error').textContent = error.message; }
  finally { button.disabled = false; }
};

async function moveCatalogProduct(product, position) {
  if (reorderPending || position < 0 || position >= screenProducts(product.screen).length || position === product.position) return;
  reorderPending = true;
  $('catalog-list').setAttribute('aria-busy', 'true');
  $('catalog-preview').setAttribute('aria-busy', 'true');
  $('move-product-up').disabled = $('move-product-down').disabled = true;
  try {
    await api(`products/${product.id}/position`, 'PUT', { screen: product.screen, position });
    state = await api('state');
    const saved = state.products.find(item => item.id === product.id);
    const editing = state.products.find(item => item.id === Number($('product-form').elements.id.value));
    if (editing) $('product-form').elements.position.value = editing.position;
    if (saved && selected === product.screen) catalogPage = Math.floor(saved.position / TV_PAGE_SIZE);
    notice('Ordem salva. TV atualizada.');
  } catch (error) { notice(error.message, true); }
  finally {
    reorderPending = false;
    $('catalog-list').removeAttribute('aria-busy'); $('catalog-preview').removeAttribute('aria-busy');
    render();
    const container = $(catalogView === 'list' ? 'products' : 'catalog-preview-grid');
    container.querySelector(`[data-product="${product.id}"]`)?.focus({ preventScroll: true });
  }
}

function clearProductDrag() {
  draggedProduct = null;
  document.querySelectorAll('.is-dragging, .is-drop-target').forEach(element => element.classList.remove('is-dragging', 'is-drop-target'));
}

function bindProductReorder(element, product) {
  if (!state.products.some(item => item.id === product.id)) return;
  element.classList.add('product-reorderable'); element.dataset.product = product.id;
  element.draggable = !reorderPending;
  element.addEventListener('dragstart', event => {
    if (reorderPending) { event.preventDefault(); return; }
    draggedProduct = { id: product.id, screen: selected };
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(product.id));
    element.classList.add('is-dragging');
  });
  element.addEventListener('dragover', event => {
    if (!draggedProduct || draggedProduct.id === product.id || draggedProduct.screen !== selected) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    element.classList.add('is-drop-target');
  });
  element.addEventListener('dragleave', event => {
    if (!element.contains(event.relatedTarget)) element.classList.remove('is-drop-target');
  });
  element.addEventListener('drop', event => {
    if (!draggedProduct || draggedProduct.screen !== selected) return;
    event.preventDefault(); event.stopPropagation();
    const source = state.products.find(item => item.id === draggedProduct.id);
    const target = state.products.find(item => item.id === product.id);
    clearProductDrag(); suppressProductClickUntil = Date.now() + 400;
    if (source && target && source.screen === target.screen) void moveCatalogProduct(source, target.position);
  });
  element.addEventListener('dragend', () => {
    clearProductDrag(); suppressProductClickUntil = Date.now() + 400;
    if (!reorderPending) render();
  });
  element.addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const current = state.products.find(item => item.id === product.id);
    if (current) void moveCatalogProduct(current, current.position + (event.key === 'ArrowUp' ? -1 : 1));
  });
}

async function deleteProduct(product, button) {
  const screen = state.screens.find(screen => screen.id === product.screen);
  if (!confirm(`Excluir “${product.name}”? O produto será removido do catálogo da TV “${screen?.name || product.screen}”.`)) return;
  button.disabled = true;
  try {
    await api('products/' + product.id, 'DELETE');
    state = await api('state');
    if (Number($('product-form').elements.id.value) === product.id) resetProductEditor();
    render(); notice('Produto excluído. TV atualizada.');
  } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
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
for (const [id, offset] of [['move-product-up', -1], ['move-product-down', 1]]) {
  $(id).onclick = () => {
    const product = state.products.find(item => item.id === Number($('product-form').elements.id.value));
    if (product) return moveCatalogProduct(product, product.position + offset);
  };
}
$('delete-product').onclick = () => {
  const product = state.products.find(product => product.id === Number($('product-form').elements.id.value));
  if (product) return deleteProduct(product, $('delete-product'));
};
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
  $('delete-screen').hidden = !rename;
  const screen = rename ? state.screens.find(screen => screen.id === selected) : null;
  $('screen-display-link').hidden = !screen;
  $('screen-display-url').value = screen ? displayLinks.get(screen.id) || '' : '';
  if (screen) getDisplayLink(screen.id, false, true).catch(error => { $('screen-error').textContent = error.message; });
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
  try { await api('screens/' + selected, 'DELETE'); await refreshSession(); $('screen-dialog').close(); notice('TV excluída.'); }
  catch (error) { notice(error.message, true); }
};
$('version-refresh').onclick = () => refreshVersion(true);
$('add-user').onclick = () => openUser();
$('profile-access').onclick = () => openUser({ ...currentUser, active: true });
$('close-user').onclick = () => $('user-dialog').close();
$('user-form').elements.role.onchange = roleFields;
$('user-form').elements.email.oninput = $('user-form').elements.password.oninput = () => {
  const form = $('user-form');
  form.elements.current_password.required = form.dataset.own === 'true' && (form.elements.password.value !== '' || form.elements.email.value.trim().toLowerCase() !== (currentUser.email || ''));
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
events.onmessage = event => { state = JSON.parse(event.data); $('connection').textContent = 'Ao vivo'; if (!draggedProduct && !reorderPending) render(); };
events.onerror = () => $('connection').textContent = 'Reconectando…';
setInterval(() => { if (currentUser) refreshSession().catch(error => notice(error.message, true)); }, 30000);
window.addEventListener('focus', () => { if (currentUser) refreshSession().catch(error => notice(error.message, true)); });

function renderPresence() {
  const status = screenPresence.get(selected);
  const badge = $('selected-presence');
  const known = typeof status?.online === 'boolean';
  badge.hidden = !selected;
  badge.className = 'screen-presence ' + (known ? status.online ? 'online' : 'offline' : 'checking');
  badge.textContent = known ? status.online ? 'Online' + (status.connected_devices > 1 ? ' · ' + status.connected_devices : '') : 'Offline' : 'Verificando';
  badge.title = known ? status.online ? 'Dispositivo de exibição conectado. Prévias administrativas não contam como presença.' : 'Nenhum dispositivo respondeu nos últimos 45 segundos. Use Copiar link da TV para configurar a exibição.' : 'Aguardando confirmação do servidor.';
  for (const option of $('screen-options').options) {
    const screen = state?.screens.find(screen => screen.id === option.value);
    const presence = screenPresence.get(option.value);
    const label = screen.name + (typeof presence?.online === 'boolean' ? presence.online ? ' — Online' : ' — Offline' : '');
    if (option.textContent !== label) option.textContent = label;
  }
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
    const previewProducts = products.filter(item => item.id !== editingId);
    previewProducts.splice(Math.min(Math.max(0, draft.position), previewProducts.length), 0, draft);
    products = previewProducts.map((item, position) => ({ ...item, position }));
    pages = Math.max(1, Math.ceil(previewProducts.length / TV_PAGE_SIZE));
    catalogPage = Math.min(catalogPage, pages - 1);
    current = products.slice(catalogPage * TV_PAGE_SIZE, (catalogPage + 1) * TV_PAGE_SIZE);
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
    bindProductReorder(button, product);
    button.classList.toggle('editing-product', Boolean(product.draft));
    if (product.draft) button.title = 'Prévia das alterações · Ainda não salvo';
    button.classList.toggle('search-muted', Boolean(query) && !product.name.toLocaleLowerCase().includes(query));
    const column = Math.floor(index / rows) + 1, row = index % rows + 1;
    button.setAttribute('aria-label', `${product.name}, ordem ${product.position}, ${pageLabel(catalogPage + 1)}, coluna ${column}, linha ${row}. Editar produto. Alt e seta para cima ou para baixo para mover.`);
    button.title = `Coluna ${column} · Linha ${row} · Clique para editar ou arraste para mover`;
    const name = document.createElement('span'); name.className = 'preview-product-name'; name.textContent = product.name;
    const order = document.createElement('span'); order.className = 'preview-product-order'; order.textContent = 'Ordem ' + product.position;
    const price = document.createElement('strong'); price.textContent = 'R$ ' + money(product.price);
    const unit = document.createElement('small'); unit.textContent = product.unit;
    price.append(unit); button.append(order, name, price); button.onclick = () => { if (!product.draft && !reorderPending && Date.now() >= suppressProductClickUntil) openEditor(product); }; return button;
  }));
  if (!current.length) { const empty = document.createElement('p'); empty.className = 'catalog-preview-empty'; empty.textContent = 'Adicione produtos para visualizar este painel.'; grid.append(empty); }
}

function resetProductEditor() {
  const form = $('product-form'); form.reset(); form.dataset.screen = selected;
  form.elements.id.value = ''; form.elements.position.value = Math.max(-1, ...screenProducts(selected).map(product => product.position)) + 1;
  $('delete-product').hidden = true;
  $('product-order-actions').hidden = true;
  renderUnitOptions(); form.elements.unit.value = state.units.some(unit => unit.code === 'KG') ? 'KG' : state.units[0]?.code || '';
  $('editor-title').textContent = 'Novo produto';
  $('product-screen-context').textContent = 'TV: ' + (state.screens.find(screen => screen.id === selected)?.name || '');
  $('form-error').textContent = ''; updateProductPage();
}
