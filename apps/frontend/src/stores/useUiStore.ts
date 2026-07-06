import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Apply a theme to the document root (§7.3). `system` removes the override so the
 * `prefers-color-scheme` media query (scoped to :root:not([data-theme])) takes over. */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    delete root.dataset.theme;
    root.style.colorScheme = 'light dark';
  } else {
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
  }
}

interface UiState {
  theme: ThemeMode;
  sidebarWidthPx: number;
  setTheme: (t: ThemeMode) => void;
  setSidebarWidth: (px: number) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarWidthPx: 340,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setSidebarWidth: (sidebarWidthPx) => set({ sidebarWidthPx }),
    }),
    { name: 'chat.ui' },
  ),
);
