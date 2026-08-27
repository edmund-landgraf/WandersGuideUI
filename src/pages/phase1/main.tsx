import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Phase1App } from './Phase1App';
import { applyPhase1CssTheme, readStoredPhase1CssTheme } from './phase1-css-theme';
import { applyPhase1Theme, readStoredPhase1Theme } from './phase1-theme';
import './phase1.css';

applyPhase1Theme(readStoredPhase1Theme());
applyPhase1CssTheme(readStoredPhase1CssTheme());

const root = document.getElementById('root') as HTMLElement;
root.removeAttribute('style');

createRoot(root).render(
  <StrictMode>
    <Phase1App />
  </StrictMode>
);
