try {
  const saved = localStorage.getItem('skyvision-theme');
  const theme =
    saved === 'light' || saved === 'dark'
      ? saved
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor instanceof HTMLMetaElement) themeColor.content = theme === 'dark' ? '#0B0C0E' : '#F8FAFC';
} catch {
  /* Use the HTML default if storage is unavailable. */
}
