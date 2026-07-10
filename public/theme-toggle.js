(function () {
  const storageKey = 'sja-notes-theme';
  const root = document.documentElement;
  const storedTheme = window.localStorage.getItem(storageKey);
  let currentTheme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'dark';

  function applyTheme(theme) {
    currentTheme = theme;
    root.dataset.theme = theme;
    window.localStorage.setItem(storageKey, theme);
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = theme === 'dark' ? 'Dark' : 'Light';
      button.setAttribute('aria-label', `当前为${theme === 'dark' ? '深色' : '浅色'}主题，点击切换`);
    });
  }

  function prepareButton(button) {
    button.dataset.themeToggle = 'true';
    button.type = 'button';
    button.addEventListener('click', () => {
      applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }

  function ensureFloatingButton() {
    if (document.querySelector('.theme-toggle')) {
      return;
    }
    const button = document.createElement('button');
    button.className = 'theme-toggle floating-theme-toggle';
    document.body.appendChild(button);
    prepareButton(button);
  }

  document.querySelectorAll('.theme-toggle').forEach(prepareButton);
  ensureFloatingButton();
  applyTheme(currentTheme);
})();
