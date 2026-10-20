export function createSecurityUI({ api, refreshSession, notice, user }) {
  const $ = id => document.getElementById(id);
  let loginChallenge, enableChallenge, account, resetToken;
  function loginView(view = 'login') {
    for (const name of ['login', 'login-code', 'forgot', 'reset']) $(name + '-form').hidden = name !== view;
    $('forgot-password').hidden = view !== 'login';
    $('notice').textContent = '';
  }
  async function busy(form, work) {
    const buttons = [...form.querySelectorAll('button')]; buttons.forEach(button => button.disabled = true);
    try { await work(); } finally { buttons.forEach(button => button.disabled = false); }
  }
  async function finishLogin() { $('login-form').reset(); $('login-code-form').reset(); loginChallenge = null; loginView(); await refreshSession(); notice('Você entrou no painel.'); }
  $('forgot-password').onclick = () => loginView('forgot');
  $('forgot-back').onclick = () => loginView();
  $('login-code-back').onclick = () => { loginChallenge = null; $('login-code-form').reset(); loginView(); };
  $('reset-back').onclick = () => { resetToken = null; history.replaceState(null, '', location.pathname); loginView(); };
  $('forgot-form').onsubmit = async event => {
    event.preventDefault(); await busy(event.target, async () => {
      try { const response = await api('password/forgot', 'POST', Object.fromEntries(new FormData(event.target))); notice(response.message); } catch (error) { notice(error.message, true); }
    });
  };
  $('reset-form').onsubmit = async event => {
    event.preventDefault(); const fields = event.target.elements;
    if (fields.password.value !== fields.confirm.value) { notice('As senhas precisam ser iguais.', true); return; }
    await busy(event.target, async () => { try { await api('password/reset', 'POST', { challenge: resetToken, password: fields.password.value }); resetToken = null; history.replaceState(null, '', location.pathname); event.target.reset(); loginView(); notice('Senha alterada. Entre com sua nova senha.'); } catch (error) { notice(error.message, true); } });
  };
  $('login-code-form').onsubmit = async event => {
    event.preventDefault(); await busy(event.target, async () => { try { await api('login/verify', 'POST', { challenge: loginChallenge, code: event.target.elements.code.value }); await finishLogin(); } catch (error) { notice(error.message, true); } });
  };
  function readResetLink() {
    const token = new URLSearchParams(location.hash.slice(1)).get('reset');
    if (token && /^[a-f0-9]{64}$/.test(token)) { resetToken = token; history.replaceState(null, '', location.pathname); loginView('reset'); return true; }
    return false;
  }
  async function prepareReset() {
    if (!resetToken) return;
    if (user()) { await api('logout', 'POST', {}); await refreshSession(); }
    loginView('reset');
  }
  readResetLink();
  window.addEventListener('hashchange', () => { if (readResetLink()) prepareReset().catch(error => notice(error.message, true)); });
  function mailFields() {
    const f = $('mail-form').elements, provider = f.provider.value, auth = f.auth.value;
    f.host.readOnly = provider !== 'custom';
    f.username.type = provider === 'custom' ? 'text' : 'email';
    const personal = provider === 'microsoft' && f.microsoft_account.value === 'personal';
    document.querySelectorAll('[data-mail-account]').forEach(el => el.hidden = provider !== 'microsoft');
    if (personal) { f.tenant_id.value = 'consumers'; f.host.value = 'smtp-mail.outlook.com'; }
    else if (provider === 'microsoft') f.host.value = 'smtp.office365.com';
    f.tenant_id.readOnly = personal;
    const allowed = provider === 'gmail' ? ['password','oauth'] : provider === 'microsoft' ? personal ? ['oauth'] : ['oauth','microsoft-app'] : ['password','none'];
    [...f.auth.options].forEach(option => { option.hidden = !allowed.includes(option.value); option.disabled = !allowed.includes(option.value); });
    document.querySelectorAll('[data-mail-auth]').forEach(el => el.hidden = auth === 'none');
    document.querySelectorAll('[data-mail-password]').forEach(el => el.hidden = auth !== 'password');
    document.querySelectorAll('[data-mail-oauth]').forEach(el => el.hidden = !['oauth','microsoft-app'].includes(auth));
    document.querySelectorAll('[data-mail-tenant]').forEach(el => el.hidden = provider !== 'microsoft');
    document.querySelectorAll('[data-mail-refresh]').forEach(el => el.hidden = auth !== 'oauth');
    $('mail-password-label').textContent = provider === 'gmail' ? 'Senha de aplicativo do Google' : 'Senha SMTP';
    const help = $('mail-provider-help'); help.replaceChildren();
    const text = document.createElement('p'), link = document.createElement('a'); link.target = '_blank'; link.rel = 'noopener';
    if (provider === 'gmail') { text.textContent = 'Use uma senha de aplicativo gerada na conta Google com verificação em duas etapas, quando disponível. A senha normal da conta não serve. Para OAuth, registre o app Google, autorize o escopo https://mail.google.com/ e obtenha um refresh token com acesso offline.'; link.href = auth === 'password' ? 'https://support.google.com/mail/answer/185833' : 'https://developers.google.com/workspace/gmail/imap/xoauth2-protocol'; link.textContent = 'Orientações oficiais do Google ↗'; }
    else if (provider === 'microsoft') { text.textContent = auth === 'microsoft-app' ? 'Para Microsoft 365 empresarial: registre um aplicativo no Entra, conceda SMTP.SendAsApp com consentimento do administrador e autorize a caixa postal no Exchange. Use Tenant ID, Client ID e segredo do aplicativo. SMTP AUTH precisa estar permitido para a caixa postal.' : 'Registre o aplicativo no Microsoft Entra e obtenha um refresh token por consentimento do usuário com offline_access e https://outlook.office.com/SMTP.Send. Para contas pessoais, use Tenant ID consumers; para empresa, o ID do diretório. SMTP AUTH precisa estar habilitado onde aplicável.'; link.href = 'https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth'; link.textContent = 'Orientações oficiais da Microsoft ↗'; }
    else { text.textContent = 'Use os dados fornecidos pelo seu serviço: normalmente porta 587 com STARTTLS ou 465 com TLS direto. Sem autenticação e sem TLS destinam-se a relays locais, como o Mailpit do DDEV (127.0.0.1:1025).'; }
    help.append(text); if (link.textContent) help.append(link);
  }
  $('mail-form').elements.provider.onchange = () => {
    const f = $('mail-form').elements;
    f.microsoft_account.value = 'business';
    if (f.provider.value === 'gmail') { f.host.value = 'smtp.gmail.com'; f.port.value = 587; f.security.value = 'starttls'; f.auth.value = 'password'; }
    else if (f.provider.value === 'microsoft') { f.host.value = 'smtp.office365.com'; f.port.value = 587; f.security.value = 'starttls'; f.auth.value = 'oauth'; }
    else f.auth.value = 'password';
    for (const name of ['password','client_secret','refresh_token']) { f[name].value = ''; f[name].placeholder = 'Preencha para a nova conta'; }
    mailFields();
  };
  $('mail-form').elements.auth.onchange = mailFields;
  $('mail-form').elements.microsoft_account.onchange = () => { const f = $('mail-form').elements; f.auth.value = 'oauth'; f.tenant_id.value = f.microsoft_account.value === 'personal' ? 'consumers' : ''; mailFields(); };
  $('mail-form').onsubmit = async event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); data.enabled = event.target.elements.enabled.checked; data.port = Number(data.port);
    await busy(event.target, async () => { try { await api('mail-settings', 'PUT', data); await loadMail(); $('mail-error').textContent = 'Configuração salva. Envie um teste para confirmar o recebimento.'; } catch (error) { $('mail-error').textContent = error.message; } });
  };
  $('mail-test-form').onsubmit = async event => { event.preventDefault(); await busy(event.target, async () => { $('mail-test-result').textContent = 'Enviando…'; try { await api('mail-settings/test', 'POST', Object.fromEntries(new FormData(event.target))); $('mail-test-result').textContent = 'E-mail enviado. Confira a caixa de entrada e o spam.'; } catch (error) { $('mail-test-result').textContent = error.message; } }); };
  async function loadMail() {
    const data = await api('mail-settings'), f = $('mail-form').elements;
    f.microsoft_account.value = data.microsoft_account || 'business';
    for (const [key, value] of Object.entries(data)) if (f[key] && key !== 'enabled') f[key].value = value;
    f.enabled.checked = data.enabled;
    for (const key of ['password','client_secret','refresh_token']) { f[key].value = ''; f[key].placeholder = data.stored_secrets[key] ? 'Credencial salva · deixe vazio para manter' : 'Ainda não configurado'; }
    mailFields();
  }
  async function loadAccount() {
    account = await api('account');
    $('user-form').elements.email.readOnly = account.two_factor_enabled;
    $('account-2fa-status').textContent = account.two_factor_enabled ? '2FA ativado' : '2FA desativado';
    $('account-2fa-status').className = 'price-status ' + (account.two_factor_enabled ? 'is-offer' : 'is-normal');
    $('account-2fa-help').textContent = account.two_factor_enabled ? 'No próximo login, você receberá um código por e-mail após informar sua senha. Para mudar o e-mail, desative o 2FA primeiro.' : !account.mail_ready ? 'O administrador precisa configurar o envio de e-mails antes de ativar o 2FA.' : !account.email ? 'Cadastre seu e-mail antes de ativar o 2FA.' : 'Ao ativar, confirme um código enviado ao seu e-mail. A escolha é sua.';
    $('account-2fa-action').textContent = account.two_factor_enabled ? 'Desativar 2FA' : 'Ativar 2FA por e-mail';
    $('account-2fa-action').disabled = !account.two_factor_enabled && (!account.email || !account.mail_ready);
  }
  $('account-2fa-form').onsubmit = async event => {
    event.preventDefault();
    const fields = $('user-form').elements;
    if (!fields.current_password.value) { $('account-2fa-result').textContent = 'Informe sua senha atual no campo acima.'; fields.current_password.focus(); return; }
    if (!account.two_factor_enabled && fields.email.value.trim().toLowerCase() !== (account.email || '')) { $('account-2fa-result').textContent = 'Salve o e-mail do usuário antes de ativar o 2FA.'; return; }
    await busy(event.target, async () => {
      try {
        if (account.two_factor_enabled) { await api('account/2fa/disable', 'POST', { password: fields.current_password.value }); await refreshSession(); await loadAccount(); $('account-2fa-result').textContent = '2FA desativado.'; }
        else { const result = await api('account/2fa/start', 'POST', { password: fields.current_password.value }); enableChallenge = result.challenge; $('account-2fa-form').hidden = true; $('account-2fa-code-form').hidden = false; $('account-2fa-help').textContent = 'Código enviado para ' + result.email + '. Válido por 10 minutos.'; }
        event.target.reset();
      } catch (error) { $('account-2fa-result').textContent = error.message; }
    });
  };
  $('account-2fa-code-form').onsubmit = async event => { event.preventDefault(); await busy(event.target, async () => { try { await api('account/2fa/confirm', 'POST', { challenge: enableChallenge, code: event.target.elements.code.value }); event.target.reset(); enableChallenge = null; $('account-2fa-code-form').hidden = true; $('account-2fa-form').hidden = false; await refreshSession(); await loadAccount(); $('account-2fa-result').textContent = '2FA ativado. Outros acessos da sua conta foram encerrados.'; } catch (error) { $('account-2fa-help').textContent = error.message; } }); };
  $('account-2fa-cancel').onclick = () => { enableChallenge = null; $('account-2fa-code-form').reset(); $('account-2fa-code-form').hidden = true; $('account-2fa-form').hidden = false; loadAccount().catch(error => notice(error.message, true)); };
  return {
    loadMail, loadAccount, prepareReset,
    resetEnrollment() { enableChallenge = null; $('account-2fa-form').reset(); $('account-2fa-code-form').reset(); $('account-2fa-code-form').hidden = true; $('account-2fa-form').hidden = false; $('account-2fa-result').textContent = ''; },
    async login(response) {
      if (response.two_factor_required) { loginChallenge = response.challenge; $('login-form').elements.password.value = ''; loginView('login-code'); $('login-code-description').textContent = 'Digite o código enviado para ' + response.email + '. Válido por 10 minutos.'; $('login-code-form').elements.code.focus(); return false; }
      await finishLogin(); return true;
    },
    clear() { loginChallenge = null; enableChallenge = null; $('account-2fa-code-form').hidden = true; $('account-2fa-form').hidden = false;  $('account-2fa-form').reset(); },
  };
}
