import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './providers/AppProviders';
import { App } from './App';
import { applyTheme, useUiStore } from './stores/useUiStore';
import './index.css';

// Apply the persisted theme before first paint (§7.3).
applyTheme(useUiStore.getState().theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
