import { useEffect, useState } from 'react';
export function useAppearance() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0B0C0E' : '#F8FAFC';
    try {
      localStorage.setItem('skyvision-theme', theme);
    } catch {
      /* Appearance still works for this session. */
    }
  }, [theme]);
  return { theme, setTheme };
}
