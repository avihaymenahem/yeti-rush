import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
import {
  cameraDistanceFor,
  distanceForHalfExtent,
  horizontalHalfExtentAt,
  requiredHalfExtent,
} from '@/game/systems/camera';

/** Real device aspect ratios (width / height), portrait. */
const ASPECTS = {
  tallPhone: 1080 / 2400, // 0.45 - 20:9 Android
  iphone: 375 / 812,
  oldPhone: 720 / 1280,
  tablet: 768 / 1024,
  desktop: 1280 / 720,
};

/**
 * The player's worst-case horizontal offset from the centre of the frame:
 * the outermost lane, minus however much of it the camera follows.
 */
function worstCaseOffset(): number {
  let outermost = 0;
  for (const x of LANES) outermost = Math.max(outermost, Math.abs(x));
  return outermost * (1 - TUNING.camera.laneFollow);
}

describe('horizontalHalfExtentAt', () => {
  it('grows with distance', () => {
    const near = horizontalHalfExtentAt(5, 58, 0.5);
    const far = horizontalHalfExtentAt(10, 58, 0.5);
    expect(far).toBeCloseTo(near * 2, 6);
  });

  it('grows with aspect ratio', () => {
    expect(horizontalHalfExtentAt(10, 58, 1.0)).toBeGreaterThan(
      horizontalHalfExtentAt(10, 58, 0.5),
    );
  });

  it('is the exact inverse of distanceForHalfExtent', () => {
    for (const aspect of Object.values(ASPECTS)) {
      const extent = horizontalHalfExtentAt(9, 58, aspect);
      expect(distanceForHalfExtent(extent, 58, aspect)).toBeCloseTo(9, 6);
    }
  });
});

describe('requiredHalfExtent', () => {
  it('covers the outer lane, the player collider and the edge margin', () => {
    expect(requiredHalfExtent()).toBeCloseTo(
      worstCaseOffset() + TUNING.player.halfWidth + TUNING.camera.edgeMargin,
      9,
    );
  });

  it('leaves real clearance beyond the player collider', () => {
    expect(requiredHalfExtent()).toBeGreaterThan(worstCaseOffset() + TUNING.player.halfWidth);
  });
});

describe('cameraDistanceFor', () => {
  it.each(Object.entries(ASPECTS))(
    'keeps the player fully on screen in the outer lane on %s',
    (_name, aspect) => {
      const distance = cameraDistanceFor(aspect);
      const visibleHalfWidth = horizontalHalfExtentAt(distance, TUNING.camera.fov, aspect);
      // The player's far edge must sit inside the frame, with margin to spare.
      expect(visibleHalfWidth).toBeGreaterThanOrEqual(
        worstCaseOffset() + TUNING.player.halfWidth,
      );
    },
  );

  it('pulls further back the narrower the screen', () => {
    expect(cameraDistanceFor(ASPECTS.tallPhone)).toBeGreaterThan(
      cameraDistanceFor(ASPECTS.tablet),
    );
  });

  it('never comes closer than the configured minimum on wide screens', () => {
    expect(cameraDistanceFor(ASPECTS.desktop)).toBe(TUNING.camera.minDistance);
    expect(cameraDistanceFor(10)).toBe(TUNING.camera.minDistance);
  });

  it('falls back to the minimum for a degenerate aspect instead of exploding', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cameraDistanceFor(bad)).toBe(TUNING.camera.minDistance);
    }
  });

  it('stays within a sane range for every plausible device', () => {
    for (const aspect of Object.values(ASPECTS)) {
      const distance = cameraDistanceFor(aspect);
      expect(distance).toBeGreaterThan(0);
      // Far enough back and the player becomes an unreadable speck.
      expect(distance).toBeLessThan(20);
    }
  });
});
