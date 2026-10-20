const $ = id => document.getElementById(id);
let token;
function readLink() {
  const candidate = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', location.pathname); // Não mantém o segredo na URL/histórico.
  token = candidate && /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
}
readLink();
async function api(path, data) {
  const response = await fetch('/api/activation' + path, {
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    ...(data !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir. Tente novamente.');
  return result;
}
async function prepare() {
  $('activation-form').hidden = true;
  $('activation-login').hidden = true;
  $('activation-message').textContent = '';
  try {
    const status = await api('/status');
    if (!status.required) {
      token = null;
      $('activation-intro').textContent = 'O acesso inicial já foi configurado.';
      $('activation-help').textContent = 'Entre com sua conta. Se esqueceu a senha, use a recuperação de acesso na tela de login.';
      $('activation-login').hidden = false;
      return;
    }
    if (!token) throw new Error('Abra o link completo enviado pelo responsável pela instalação. Se ele expirou, solicite um novo link.');
    const result = await api('/validate', { token });
    $('activation-intro').textContent = 'Escolha seu usuário e sua senha para administrar o SYSTV.';
    $('activation-help').textContent = 'Link válido até ' + new Date(result.expires_at).toLocaleString('pt-BR') + '. Não compartilhe o link com outras pessoas.';
    $('activation-form').hidden = false;
    $('activation-form').elements.name.focus();
  } catch (error) {
    $('activation-intro').textContent = 'Não foi possível abrir a ativação.';
    $('activation-message').textContent = error.message;
  }
}
$('activation-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, fields = form.elements;
  if (fields.password.value !== fields.confirm.value) {
    $('activation-message').textContent = 'As senhas precisam ser iguais.';
    fields.confirm.focus(); return;
  }
  const button = form.querySelector('button');
  button.disabled = true;
  $('activation-message').textContent = '';
  try {
    const result = await api('', { token, name: fields.name.value, username: fields.username.value, email: fields.email.value, password: fields.password.value });
    token = null;
    form.reset(); form.hidden = true;
    $('activation-intro').textContent = 'Seu acesso foi criado!';
    $('activation-message').textContent = 'Entre no painel com o usuário “' + result.username + '” e a senha que você acabou de definir.';
    $('activation-help').textContent = 'A ativação foi encerrada. Este link não pode mais ser utilizado.';
    $('activation-login').hidden = false;
    $('activation-login').focus();
  } catch (error) {
    $('activation-message').textContent = error.message;
  } finally { button.disabled = false; }
});
window.addEventListener('hashchange', () => { readLink(); $('activation-form').reset(); prepare(); });
prepare();
