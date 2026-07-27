/**
 * Frame-rate and draw-call overlay, development builds only.
 *
 * This is the gate for the mobile budget: the target is 60 fps and under ~60
 * draw calls on a mid-range Android device, and the only way to know is to look
 * at it on the device rather than infer it from a desktop browser.
 *
 * Toggle it with the `P` key, or `?perf` in the URL.
 *
 * This module is only ever reached through a dynamic import inside an
 * `import.meta.env.DEV` branch (see `Scene.tsx`). That guard is what keeps
 * `r3f-perf` - about 220 kB - out of the production bundle entirely; a static
 * import here would ship it to players even though it never renders.
 */

import { lazy, Suspense, useEffect, useState } from 'react';

const Perf = lazy(() =>
  import('r3f-perf').then((module) => ({ default: module.Perf })),
);

export default function PerfOverlay() {
  const [visible, setVisible] = useState(
    () => typeof window !== 'undefined' && window.location.search.includes('perf'),
  );

  // A genuine keyboard subscription, and the only way to reach this on a device
  // over remote debugging.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyP' && !event.repeat) setVisible((current) => !current);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!visible) return null;

  return (
    <Suspense fallback={null}>
      <Perf position="bottom-left" minimal={false} />
    </Suspense>
  );
}
