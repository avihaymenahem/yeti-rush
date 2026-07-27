/**
 * The layer that owns all gameplay input.
 *
 * It sits above the canvas rather than on it, so R3F never has to run a raycast
 * per touch. Pointer handling is plain React props (no effect needed); only the
 * keyboard listener is a real subscription.
 *
 * Swipes are acted on during the drag, the moment they pass the distance
 * threshold, rather than on release - see `systems/input`. Holding a swipe for a
 * beat before lifting used to cost the player that whole beat, which at speed is
 * the difference between clearing an obstacle and wearing it.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  beginDrag,
  dragTo,
  endDrag,
  type DragTracker,
  type Gesture,
} from '@/game/systems/input';

export interface InputSurfaceProps {
  onGesture: (gesture: Gesture) => void;
  /** Keyboard is dev-facing but always on: it costs nothing on a phone. */
  enableKeyboard?: boolean;
}

export function InputSurface({ onGesture, enableKeyboard = true }: InputSurfaceProps) {
  const dragRef = useRef<DragTracker | null>(null);
  const pointerRef = useRef<number | null>(null);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Secondary fingers are ignored rather than fighting the first for control.
    if (!event.isPrimary) return;
    pointerRef.current = event.pointerId;
    dragRef.current = beginDrag({ x: event.clientX, y: event.clientY, t: event.timeStamp });
    // Keeps the moves coming even if the finger leaves the element, which
    // matters for a swipe that starts near an edge.
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || pointerRef.current !== event.pointerId) return;

      const gesture = dragTo(drag, {
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp,
      });
      if (gesture !== 'none') onGesture(gesture);
    },
    [onGesture],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      pointerRef.current = null;
      if (!drag) return;

      // Only a press that never became a swipe can still be a tap.
      const gesture = endDrag(drag, {
        x: event.clientX,
        y: event.clientY,
        t: event.timeStamp,
      });
      if (gesture !== 'none') onGesture(gesture);
    },
    [onGesture],
  );

  const handlePointerCancel = useCallback(() => {
    dragRef.current = null;
    pointerRef.current = null;
  }, []);

  // A genuine external subscription - the only thing here that needs an effect.
  useEffect(() => {
    if (!enableKeyboard) return;

    const keyMap: Record<string, Gesture> = {
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      ArrowUp: 'up',
      KeyW: 'up',
      Space: 'up',
      ArrowDown: 'down',
      KeyS: 'down',
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const gesture = keyMap[event.code];
      if (!gesture) return;
      event.preventDefault();
      onGesture(gesture);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboard, onGesture]);

  return (
    <div
      className="layer"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
