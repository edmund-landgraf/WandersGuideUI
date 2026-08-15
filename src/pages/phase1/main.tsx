import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Phase1App } from './Phase1App';
import { applyPhase1Theme, readStoredPhase1Theme } from './phase1-theme';
import './phase1.css';

applyPhase1Theme(readStoredPhase1Theme());

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Phase1App />
  </StrictMode>
);
