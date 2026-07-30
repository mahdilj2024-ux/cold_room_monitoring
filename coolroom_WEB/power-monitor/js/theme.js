/**
 * theme.js
 * Handles dark/light mode switching and persistence.
 */
(function () {
  const STORAGE_KEY = 'psu-monitor-theme';
  const root = document.documentElement;
  const toggleBtn = document.getElementById('themeToggle');

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  function initialTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    return prefersLight ? 'light' : 'dark';
  }

  applyTheme(initialTheme());

  toggleBtn.addEventListener('click', function () {
    const current = root.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
    // let other modules react (chart colors, etc.)
    document.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme: root.getAttribute('data-theme') }
    }));
  });

  window.PSUTheme = {
    current: () => root.getAttribute('data-theme'),
    colors: () => {
      const cs = getComputedStyle(root);
      return {
        text: cs.getPropertyValue('--text').trim(),
        textDim: cs.getPropertyValue('--text-dim').trim(),
        border: cs.getPropertyValue('--border').trim(),
        track: cs.getPropertyValue('--track').trim(),
        panel: cs.getPropertyValue('--panel').trim(),
      };
    }
  };
})();
