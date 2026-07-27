/**
 * A button that reliably fires on touch.
 *
 * Menu presses were intermittently doing nothing, and `click` is why. On touch
 * a click is dispatched to the nearest common ancestor of the pointerdown and
 * pointerup targets, so a finger that rolls two pixels past the edge of a
 * button hands the click to the panel behind it and the button's handler never
 * runs. Inside a scrollable panel it is worse: the browser can claim the
 * gesture as a pan and dispatch no click at all. Both read to the player as a
 * dead button, and neither is reproducible on a desktop mouse, which is why it
 * survived this long.
 *
 * So the press is resolved straight from the pointer events - capture on down,
 * fire on up if the finger stayed within a slop radius, drop it if the browser
 * cancels the pointer because a scroll took over. `click` is still handled for
 * keyboard activation, which reports a click count of zero and so cannot
 * double-fire with the pointer path.
 */

import type { ComponentPropsWithoutRef, MouseEvent, PointerEvent } from 'react';
import { useRef } from 'react';
import { isButtonPress } from '@/game/systems/input';

export type TapButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'onClick'> & {
  onTap: () => void;
};

interface Press {
  x: number;
  y: number;
  pointerId: number;
}

export function TapButton({ onTap, type = 'button', ...rest }: TapButtonProps) {
  const pressRef = useRef<Press | null>(null);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary) return;
    pressRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };

    // Touch pointers are implicitly captured by their target; mouse pointers
    // are not, so without this a release a few pixels outside the button never
    // comes back to it. Capture is released automatically when the element
    // goes away, which it often does - the press usually changes screen.
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || press.pointerId !== event.pointerId) return;
    if (!isButtonPress(press, { x: event.clientX, y: event.clientY })) return;
    onTap();
  };

  // The browser fires this when a scroll or a system gesture takes the pointer
  // over. The player was not pressing the button, so nothing should happen.
  const handlePointerCancel = () => {
    pressRef.current = null;
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // `detail` is the click count: zero only for keyboard activation and
    // programmatic clicks. Anything driven by a pointer went through the
    // handlers above already.
    if (event.detail === 0) onTap();
  };

  return (
    <button
      {...rest}
      type={type}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
    />
  );
}
