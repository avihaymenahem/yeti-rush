import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { BOOT_STEPS, handOverToPoster, setBootProgress } from '@/platform/shell';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

setBootProgress(BOOT_STEPS.bundle);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Drop the native splash now rather than on the first rendered frame. It is the
// system splash - an app icon on a colour - and the poster underneath it is the
// one worth looking at, so the sooner the handover the more of the wait is spent
// on the right screen. See `handOverToPoster` for why the drawable never shows.
void handOverToPoster();

// Console/automation access to the live simulation. The dynamic import inside
// the DEV guard keeps the whole module out of production bundles.
if (import.meta.env.DEV) {
  void import('@/dev/debugBridge').then((module) => module.installDebugBridge());
}
