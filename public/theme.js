(() => {
  const key = 'systv-theme';
  const choices = ['system', 'light', 'dark'];
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try { const saved = localStorage.getItem(key); if (choices.includes(saved)) preference = saved; } catch {}
  function apply() {
    document.documentElement.dataset.theme = preference === 'system' ? media.matches ? 'dark' : 'light' : preference;
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === preference));
    });
  }
  apply();
  media.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = choices.includes(event.newValue) ? event.newValue : 'system'; apply(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
      preference = choices.includes(button.dataset.themeChoice) ? button.dataset.themeChoice : 'system';
      try { localStorage.setItem(key, preference); } catch {}
      apply();
    }));
  });
})();
