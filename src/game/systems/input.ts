/**
 * Gesture recognition.
 *
 * Deliberately pure functions over pointer samples rather than DOM listeners, so
 * every rule is unit-testable without a browser. The React layer only feeds in
 * coordinates.
 *
 * Screen coordinates: +x is right, +y is *down* (standard pointer events).
 *
 * Two things here are what make the controls feel immediate, and both were
 * originally wrong:
 *
 * 1. **Swipes fire on movement, not release.** Classifying on pointerup means
 *    nothing happens until the player lifts their finger - so the lag is however
 *    long they hold it, which is easily 150-300 ms and reads as the game being
 *    unresponsive. A swipe is recognised the instant it passes the distance
 *    threshold, mid-drag.
 *
 * 2. **One touch can produce several gestures.** Classifying once per touch
 *    meant a duck followed by a lane change - without lifting - resolved to a
 *    single gesture built from the *net* displacement, so one of the two was
 *    silently lost. Each axis can now fire once per touch, and firing again on
 *    the same axis is allowed when the direction reverses.
 *
 * A long flick still only moves one lane: after a direction fires, the same
 * direction is latched for the rest of the touch, so dragging further does not
 * chain into a second lane change.
 */

export type Gesture = 'left' | 'right' | 'up' | 'down' | 'tap' | 'none';

/** A directional swipe - everything `Gesture` covers except taps. */
export type SwipeGesture = Exclude<Gesture, 'tap' | 'none'>;

/** Narrows a result to an actual swipe, filtering out the 'none' misses. */
export function isSwipe(gesture: Gesture): gesture is SwipeGesture {
  return gesture !== 'none' && gesture !== 'tap';
}

export interface PointerSample {
  /** Screen X in CSS pixels. */
  x: number;
  /** Screen Y in CSS pixels. */
  y: number;
  /** Timestamp in milliseconds. */
  t: number;
}

export type Point = Pick<PointerSample, 'x' | 'y'>;

export interface GestureConfig {
  /** Minimum travel on the dominant axis for a swipe to register. */
  minSwipeDistance: number;
  /** Movement under this counts as stationary. */
  tapMaxDistance: number;
  /** A stationary press longer than this is a hold, not a tap. */
  tapMaxDuration: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  minSwipeDistance: 30,
  tapMaxDistance: 12,
  tapMaxDuration: 250,
};

/**
 * The swipe a drag has become, or 'none' if it has not travelled far enough.
 *
 * Duration is deliberately not considered. A release-time classifier could
 * afford to reject slow drags as "not a flick", but this runs mid-drag, and
 * refusing to act on a deliberate slow swipe is exactly the unresponsiveness
 * this is here to remove. Travelling 30 px in one direction is intent.
 */
export function classifyDrag(
  origin: Point,
  current: Point,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): SwipeGesture | 'none' {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // The dominant axis wins outright; diagonal swipes resolve rather than fail.
  if (absX >= absY) {
    if (absX < config.minSwipeDistance) return 'none';
    return dx > 0 ? 'right' : 'left';
  }
  if (absY < config.minSwipeDistance) return 'none';
  return dy > 0 ? 'down' : 'up';
}

/** Live state of one touch, from press to release. */
export interface DragTracker {
  /**
   * Where the next swipe is measured from. Moves to the release point of each
   * swipe that fires, so a change of direction is measured fresh rather than
   * against a stale press point on the far side of the screen.
   */
  origin: PointerSample;
  /** Where the touch began, kept so a tap can still be judged on release. */
  pressedAt: PointerSample;
  /** Horizontal direction already fired this touch, if any. */
  firedHorizontal: 'left' | 'right' | null;
  /** Vertical direction already fired this touch, if any. */
  firedVertical: 'up' | 'down' | null;
  /** Set once anything has fired, so release cannot also report a tap. */
  swiped: boolean;
}

export function beginDrag(sample: PointerSample): DragTracker {
  return {
    origin: { ...sample },
    pressedAt: { ...sample },
    firedHorizontal: null,
    firedVertical: null,
    swiped: false,
  };
}

/**
 * Advances a drag. Returns the gesture to act on now, or 'none'.
 *
 * Mutates the tracker: this is called on every pointermove of every touch, and
 * allocating a new tracker per move would put garbage on the hot path.
 */
export function dragTo(
  tracker: DragTracker,
  sample: PointerSample,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): SwipeGesture | 'none' {
  const gesture = classifyDrag(tracker.origin, sample, config);
  if (gesture === 'none') return 'none';

  if (gesture === 'left' || gesture === 'right') {
    // Already went this way on this touch: latched, so a long flick is still
    // one lane. The origin stays put, so reversing is measured from where the
    // last swipe fired and takes a fresh `minSwipeDistance` to trigger.
    if (tracker.firedHorizontal === gesture) return 'none';
    tracker.firedHorizontal = gesture;
  } else {
    if (tracker.firedVertical === gesture) return 'none';
    tracker.firedVertical = gesture;
  }

  tracker.origin = { ...sample };
  tracker.swiped = true;
  return gesture;
}

/**
 * Ends a drag. Returns 'tap' for a press that never became a swipe, else 'none'.
 *
 * Taps are the one gesture that can only be known on release - it is defined by
 * what did *not* happen - so this is where a jump-by-tap comes from.
 */
export function endDrag(
  tracker: DragTracker,
  sample: PointerSample,
  config: GestureConfig = DEFAULT_GESTURE_CONFIG,
): 'tap' | 'none' {
  if (tracker.swiped) return 'none';

  const dx = sample.x - tracker.pressedAt.x;
  const dy = sample.y - tracker.pressedAt.y;
  if (Math.abs(dx) >= config.tapMaxDistance || Math.abs(dy) >= config.tapMaxDistance) {
    return 'none';
  }
  return sample.t - tracker.pressedAt.t <= config.tapMaxDuration ? 'tap' : 'none';
}

/**
 * How far a finger may travel between press and release and still be taken as
 * pressing the control it started on.
 *
 * Wider than `tapMaxDistance` above, deliberately. That threshold decides
 * between a tap and a swipe, where being strict costs the player nothing - a
 * misread swipe still moves them. This one decides whether a button works at
 * all, and being strict there means a press that silently does nothing.
 */
export const BUTTON_PRESS_SLOP = 26;

/**
 * Whether a press and release count as activating a button.
 *
 * Buttons cannot rely on the `click` event on touch. A click is dispatched to
 * the nearest common ancestor of the pointerdown and pointerup targets, so a
 * finger that rolls a couple of pixels off the edge of a button sends the click
 * to the panel behind it and the button never fires. To the player that is a
 * tap that did nothing.
 *
 * Duration is not checked: unlike a swipe, a slow press on a button is still a
 * press, and there is no hold gesture for it to be confused with.
 */
export function isButtonPress(
  start: Point,
  end: Point,
  slop: number = BUTTON_PRESS_SLOP,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) <= slop;
}
