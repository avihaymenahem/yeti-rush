import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Console/automation access to the live simulation. The dynamic import inside
// the DEV guard keeps the whole module out of production bundles.
if (import.meta.env.DEV) {
  void import('@/dev/debugBridge').then((module) => module.installDebugBridge());
}
