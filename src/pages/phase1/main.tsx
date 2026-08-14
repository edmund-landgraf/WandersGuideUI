import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Phase1App } from './Phase1App';
import './phase1.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <Phase1App />
  </StrictMode>
);
