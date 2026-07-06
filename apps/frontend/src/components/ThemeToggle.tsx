import { useUiStore, type ThemeMode } from '../stores/useUiStore';

const OPTS: { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: 'light', label: 'Light', icon: '☀' },
  { mode: 'dark', label: 'Dark', icon: '☾' },
  { mode: 'system', label: 'Auto', icon: '◐' },
];

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {OPTS.map((o) => (
        <button
          key={o.mode}
          role="radio"
          aria-checked={theme === o.mode}
          className={`segmented__opt${theme === o.mode ? ' is-active' : ''}`}
          onClick={() => setTheme(o.mode)}
          type="button"
        >
          <span aria-hidden>{o.icon}</span> {o.label}
        </button>
      ))}
    </div>
  );
}
