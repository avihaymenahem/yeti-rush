/**
 * Gesture recognition.
 *
 * The rules that matter for feel, and the two that were originally wrong:
 * swipes must fire *during* the drag rather than on release, and one touch must
 * be able to produce more than one gesture so a duck can be followed by a lane
 * change without lifting.
 */

import { describe, expect, it } from 'vitest';
import {
  beginDrag,
  BUTTON_PRESS_SLOP,
  classifyDrag,
  DEFAULT_GESTURE_CONFIG,
  dragTo,
  endDrag,
  isButtonPress,
  isSwipe,
  type PointerSample,
} from '@/game/systems/input';

const START: PointerSample = { x: 200, y: 400, t: 1000 };

function at(dx: number, dy: number, durationMs = 120): PointerSample {
  return { x: START.x + dx, y: START.y + dy, t: START.t + durationMs };
}

describe('classifyDrag', () => {
  it('recognises the four cardinal swipes', () => {
    expect(classifyDrag(START, at(-80, 0))).toBe('left');
    expect(classifyDrag(START, at(80, 0))).toBe('right');
    // +y is screen-down, so a negative dy is an upward swipe.
    expect(classifyDrag(START, at(0, -80))).toBe('up');
    expect(classifyDrag(START, at(0, 80))).toBe('down');
  });

  it('resolves diagonals to the dominant axis instead of failing', () => {
    expect(classifyDrag(START, at(-90, -40))).toBe('left');
    expect(classifyDrag(START, at(-40, -90))).toBe('up');
    expect(classifyDrag(START, at(70, 65))).toBe('right');
    expect(classifyDrag(START, at(65, 70))).toBe('down');
  });

  it('ignores movement below the threshold', () => {
    const under = DEFAULT_GESTURE_CONFIG.minSwipeDistance - 1;
    expect(classifyDrag(START, at(under, 0))).toBe('none');
    expect(classifyDrag(START, at(0, under))).toBe('none');
  });

  it('fires exactly at the distance threshold', () => {
    expect(classifyDrag(START, at(DEFAULT_GESTURE_CONFIG.minSwipeDistance, 0))).toBe('right');
  });

  it('does not care how long the drag took', () => {
    // A release-time classifier could reject a slow drag as "not a flick". This
    // one runs mid-drag, and refusing a deliberate slow swipe is precisely the
    // unresponsiveness it exists to remove.
    expect(classifyDrag(START, at(-90, 0, 5))).toBe('left');
    expect(classifyDrag(START, at(-90, 0, 5000))).toBe('left');
  });

  it('is independent of where on the screen the gesture happened', () => {
    const corner = { x: 5, y: 5 };
    expect(classifyDrag(corner, { x: 95, y: 5 })).toBe('right');
  });
});

describe('drag tracking', () => {
  it('fires a swipe mid-drag, before the finger is lifted', () => {
    // The whole point: the lane change happens as the thumb crosses the
    // threshold, not whenever the player happens to let go.
    const drag = beginDrag(START);
    expect(dragTo(drag, at(-10, 0))).toBe('none');
    expect(dragTo(drag, at(-35, 0))).toBe('left');
    // And the release adds nothing, because it already fired.
    expect(endDrag(drag, at(-90, 0))).toBe('none');
  });

  it('lets one touch duck and then change lane', () => {
    // The reported bug: swipe down to slide, then sideways without lifting, and
    // the lane change was swallowed - the whole touch resolved to one gesture
    // built from the net displacement.
    const drag = beginDrag(START);
    expect(dragTo(drag, at(0, 40))).toBe('down');
    expect(dragTo(drag, at(40, 45))).toBe('right');
    expect(endDrag(drag, at(40, 45))).toBe('none');
  });

  it('does not chain a long flick into several lane changes', () => {
    // One swipe is one lane, however far the thumb keeps travelling.
    const drag = beginDrag(START);
    expect(dragTo(drag, at(-35, 0))).toBe('left');
    expect(dragTo(drag, at(-80, 0))).toBe('none');
    expect(dragTo(drag, at(-160, 0))).toBe('none');
    expect(dragTo(drag, at(-300, 0))).toBe('none');
  });

  it('allows a reversal on an axis that has already fired', () => {
    // Overshooting and correcting inside one touch has to work.
    const drag = beginDrag(START);
    expect(dragTo(drag, at(-35, 0))).toBe('left');
    // Measured from where the last swipe fired, so this needs a fresh 30px.
    expect(dragTo(drag, at(-20, 0))).toBe('none');
    expect(dragTo(drag, at(0, 0))).toBe('right');
  });

  it('measures a new swipe from the last one, not from the press', () => {
    const drag = beginDrag(START);
    expect(dragTo(drag, at(0, 40))).toBe('down');
    // Only 10px right of the point where 'down' fired: not yet a swipe, even
    // though it is 10px right of a press that was 40px away.
    expect(dragTo(drag, at(10, 40))).toBe('none');
    expect(dragTo(drag, at(31, 40))).toBe('right');
  });

  it('reports a quick stationary press as a tap', () => {
    const drag = beginDrag(START);
    expect(dragTo(drag, at(3, 3))).toBe('none');
    expect(endDrag(drag, at(3, 3, 100))).toBe('tap');
  });

  it('does not report a tap for a long stationary press', () => {
    const drag = beginDrag(START);
    const held = DEFAULT_GESTURE_CONFIG.tapMaxDuration + 1;
    expect(endDrag(drag, at(0, 0, held))).toBe('none');
  });

  it('does not report a tap for a press that drifted too far', () => {
    const drag = beginDrag(START);
    const drift = DEFAULT_GESTURE_CONFIG.tapMaxDistance;
    expect(endDrag(drag, at(drift, 0, 100))).toBe('none');
  });

  it('never reports a tap once anything has fired', () => {
    const drag = beginDrag(START);
    expect(dragTo(drag, at(0, 40))).toBe('down');
    // Back to where it started and released quickly: still not a tap, because
    // the touch has already been spent on a swipe.
    expect(endDrag(drag, at(0, 0, 100))).toBe('none');
  });

  it('keeps each touch independent', () => {
    const first = beginDrag(START);
    expect(dragTo(first, at(-35, 0))).toBe('left');

    const second = beginDrag(START);
    expect(dragTo(second, at(-35, 0))).toBe('left');
  });

  it('fires at most one gesture per direction per touch', () => {
    const drag = beginDrag(START);
    const fired = [
      dragTo(drag, at(0, 40)),
      dragTo(drag, at(0, 90)),
      dragTo(drag, at(40, 90)),
      dragTo(drag, at(90, 90)),
    ].filter(isSwipe);
    expect(fired).toEqual(['down', 'right']);
  });
});

describe('isButtonPress', () => {
  const point = (x: number, y: number) => ({ x, y });

  it('accepts a press that does not move at all', () => {
    expect(isButtonPress(point(100, 200), point(100, 200))).toBe(true);
  });

  it('accepts the finger roll that used to lose the press', () => {
    for (const drift of [1, 3, 6, 10, 15]) {
      expect(isButtonPress(point(100, 200), point(100 + drift, 200 - drift))).toBe(true);
    }
  });

  it('is generous enough to cover a real fingertip', () => {
    // A fingertip is around 9 mm, roughly 34 CSS pixels across, so the contact
    // point can legitimately wander further than a mouse cursor ever would.
    expect(BUTTON_PRESS_SLOP).toBeGreaterThanOrEqual(20);
  });

  it('rejects a drag far enough to be a swipe or a scroll', () => {
    expect(isButtonPress(point(100, 200), point(100, 320))).toBe(false);
    expect(isButtonPress(point(100, 200), point(260, 200))).toBe(false);
  });

  it('measures real distance rather than either axis alone', () => {
    // 20 right and 20 down is 28 pixels of travel, past the 26 limit, even
    // though neither axis reaches it on its own.
    expect(isButtonPress(point(0, 0), point(20, 20))).toBe(false);
    expect(isButtonPress(point(0, 0), point(20, 0))).toBe(true);
  });

  it('accepts travel exactly at the limit but not past it', () => {
    expect(isButtonPress(point(0, 0), point(BUTTON_PRESS_SLOP, 0))).toBe(true);
    expect(isButtonPress(point(0, 0), point(BUTTON_PRESS_SLOP + 0.5, 0))).toBe(false);
  });

  it('honours a custom slop, so a control can be stricter if it needs to be', () => {
    expect(isButtonPress(point(0, 0), point(10, 0), 5)).toBe(false);
    expect(isButtonPress(point(0, 0), point(4, 0), 5)).toBe(true);
  });

  it('never overlaps a swipe: anything it accepts, the gesture reader ignores', () => {
    // A press the button accepts must not also register as a lane change if it
    // lands on the input surface instead.
    expect(DEFAULT_GESTURE_CONFIG.minSwipeDistance).toBeGreaterThan(BUTTON_PRESS_SLOP);
  });
});
