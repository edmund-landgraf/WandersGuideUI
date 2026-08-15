import { CloudFog, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyPhase1Theme, persistPhase1Theme, readStoredPhase1Theme, type Phase1Theme } from './phase1-theme';

const THEME_OPTIONS: { id: Phase1Theme; label: string; icon: typeof Moon }[] = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'grey', label: 'Grey', icon: CloudFog },
  { id: 'parchment', label: 'Parchment', icon: Sun },
];

export function Phase1ThemeToggle() {
  const [theme, setTheme] = useState<Phase1Theme>(() => readStoredPhase1Theme());

  useEffect(() => {
    applyPhase1Theme(theme);
  }, [theme]);

  return (
    <div className='phase1-theme-switch' role='radiogroup' aria-label='Color theme'>
      {THEME_OPTIONS.map(({ id, label, icon: Icon }) => {
        const selected = theme === id;
        return (
          <button
            key={id}
            type='button'
            role='radio'
            aria-checked={selected}
            aria-label={label}
            title={label}
            className={selected ? 'is-active' : undefined}
            onClick={() => {
              persistPhase1Theme(id);
              setTheme(id);
            }}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
