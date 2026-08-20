import { Grid3x3, SwatchBook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPublicUser } from '@auth/user-manager';
import { applyDisplayPrefsFromUser } from './display-prefs';
import {
  applyPhase1CssTheme,
  persistPhase1CssTheme,
  readStoredPhase1CssTheme,
  type Phase1CssTheme,
} from './phase1-css-theme';

const CSS_THEME_OPTIONS: { id: Phase1CssTheme; label: string; icon: typeof SwatchBook }[] = [
  { id: 'default', label: 'Default', icon: SwatchBook },
  { id: 'waitly', label: 'Waitly', icon: Grid3x3 },
];

export function Phase1CssThemeToggle() {
  const [theme, setTheme] = useState<Phase1CssTheme>(() => readStoredPhase1CssTheme());
  const user = useQuery({
    queryKey: ['phase1-public-user'],
    queryFn: () => getPublicUser(),
    staleTime: 60_000,
  });

  useEffect(() => {
    applyDisplayPrefsFromUser(user.data);
    const next = readStoredPhase1CssTheme();
    applyPhase1CssTheme(next);
    setTheme(next);
  }, [user.data]);

  useEffect(() => {
    applyPhase1CssTheme(theme);
  }, [theme]);

  return (
    <div className='phase1-theme-switch' role='radiogroup' aria-label='CSS theme'>
      {CSS_THEME_OPTIONS.map(({ id, label, icon: Icon }) => {
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
              persistPhase1CssTheme(id);
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
