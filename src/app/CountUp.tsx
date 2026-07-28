/**
 * A number that arrives rather than appearing.
 *
 * The results card is the one moment a run is looked at rather than played, and
 * a score that is simply *there* gives the player nothing to watch. Counting it
 * up is the cheapest possible way to make the number feel earned - and it is
 * the only place in this project where an animated number is affordable at all,
 * because it is not on screen while anything is being steered.
 *
 * Written straight into the DOM node through a ref, not through state. The game
 * loop is still running behind this card, and re-rendering the React tree sixty
 * times a second to move one digit would take frames from the scene the player
 * can see through it.
 */

import { useEffect, useRef } from 'react';
import { easeOutQuad } from '@/game/core/math';

export interface CountUpProps {
  value: number;
  /** Seconds the count takes. Scaled down for small numbers. */
  duration?: number;
  className?: string;
  /** Rendered after the number, e.g. a unit. */
  suffix?: string;
}

const DEFAULT_DURATION = 0.9;

export function CountUp({ value, duration = DEFAULT_DURATION, className, suffix }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  // A real animation against an external clock, which is what an effect is for.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const target = Math.max(0, Math.round(value));
    const write = (n: number) => {
      node.textContent = `${n.toLocaleString()}${suffix ?? ''}`;
    };

    // Nothing to count, and nothing to look at while it happens.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (target === 0 || reduced) {
      write(target);
      return;
    }

    // Short numbers finish sooner. A count to nine that takes as long as a
    // count to ninety thousand reads as the card being slow, not as a flourish.
    const seconds = Math.min(duration, 0.25 + Math.log10(target + 1) * 0.22);

    let raf = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / (seconds * 1000));
      // Decelerating: fast enough at the front to feel like a tally, slow at
      // the end so the final figure lands rather than being caught mid-blur.
      write(Math.round(target * easeOutQuad(t)));
      if (t < 1) raf = requestAnimationFrame(step);
    };

    write(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, suffix]);

  // Rendered with the final value already in place, so a card that never gets
  // to run its effect - or a screenshot taken before the first frame - still
  // shows the real number rather than a blank.
  return (
    <span ref={ref} className={className}>
      {`${Math.max(0, Math.round(value)).toLocaleString()}${suffix ?? ''}`}
    </span>
  );
}
