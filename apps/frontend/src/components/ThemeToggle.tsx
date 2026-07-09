import { Sun, Moon, Contrast, type LucideIcon } from 'lucide-react';
import { useUiStore, type ThemeMode } from '../stores/useUiStore';

const OPTS: { mode: ThemeMode; label: string; icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'Auto', icon: Contrast },
];

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <div className="segmented" role="radiogroup" aria-label="Theme">
      {OPTS.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.mode}
            role="radio"
            aria-checked={theme === o.mode}
            className={`segmented__opt${theme === o.mode ? ' is-active' : ''}`}
            onClick={() => setTheme(o.mode)}
            type="button"
          >
            <Icon size={16} aria-hidden /> {o.label}
          </button>
        );
      })}
    </div>
  );
}
