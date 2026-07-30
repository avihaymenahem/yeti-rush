import { describe, expect, it } from 'vitest';
import { LANES, TUNING } from '@/game/config/tuning';
import { CAMERA_FEEL } from '@/game/config/visuals';
import {
  cameraDistanceFor,
  distanceForHalfExtent,
  horizontalHalfExtentAt,
  requiredHalfExtent,
  speedFovFor,
} from '@/game/systems/camera';

/** Real device aspect ratios (width / height), portrait. */
const ASPECTS = {
  tallPhone: 1080 / 2400, // 0.45 - 20:9 Android
  iphone: 375 / 812,
  oldPhone: 720 / 1280,
  tablet: 768 / 1024,
  desktop: 1280 / 720,
};

const BASE_FOV = TUNING.camera.fov;
const TOP_FOV = BASE_FOV + TUNING.camera.speedFovKick;

/**
 * The lens the *dolly* tracks: the speed sweep, and nothing else.
 *
 * The punch is deliberately excluded here and only here. It is a transient
 * framing impulse, so the frame stretching for a fifth of a second is what it
 * is *for* - wiring it into the distance would turn five degrees into a camera
 * lurch of over a metre, which is the banned shake by another name.
 */
function speedLenses(): number[] {
  const lenses: number[] = [];
  for (let i = 0; i <= 12; i++) lenses.push(BASE_FOV + (TUNING.camera.speedFovKick * i) / 12);
  return lenses;
}

/**
 * Every lens a rendered frame can carry: the speed sweep, plus the punch on
 * top of it. The punch is additive to the *live* lens, so the widest thing that
 * can reach the projection matrix is the top of the sweep plus a full impulse.
 */
function everyLens(): number[] {
  return [...speedLenses(), TOP_FOV + CAMERA_FEEL.punchDegrees];
}

/**
 * The player's worst-case horizontal offset from the centre of the frame:
 * the outermost lane, minus however much of it the camera follows.
 */
function worstCaseOffset(): number {
  let outermost = 0;
  for (const x of LANES) outermost = Math.max(outermost, Math.abs(x));
  return outermost * (1 - TUNING.camera.laneFollow);
}

/**
 * World half-width visible at the player's depth, which is what sets how large
 * the player is drawn: more world across the same screen is a smaller player.
 */
function worldAcrossThePlayer(aspect: number, fovDegrees: number): number {
  return horizontalHalfExtentAt(cameraDistanceFor(aspect, fovDegrees), fovDegrees, aspect);
}

/**
 * Angular rate at which the snow under the player sweeps the frame, per unit of
 * world speed - the optic flow that makes a run feel fast.
 *
 * A ground point at track z projects to a screen height of
 * `-h / ((camZ - z) * tan(halfFov))`, so its rate at the player's own depth is
 * `h * v / (camZ^2 * tan(halfFov))`. Both of the terms this pass moves are in
 * it: the eye height `TUNING.camera.height`, which P0 lowered for exactly this,
 * and the lens, which widens with speed and would hand that gain straight back
 * if the camera did not dolly in as it did so.
 */
function groundFlowPerSpeed(aspect: number, fovDegrees: number): number {
  const distance = cameraDistanceFor(aspect, fovDegrees);
  return TUNING.camera.height / (distance * distance * Math.tan((fovDegrees * Math.PI) / 360));
}

/**
 * Aspects where the dolly has anywhere to go.
 *
 * Derived rather than hand-picked, because it is a property of the numbers and
 * not of a device list: `cameraDistanceFor` bottoms out at
 * `TUNING.camera.minDistance`, and on 16:9 and wider that floor is already
 * binding at the base lens, so the camera cannot come in as the lens widens and
 * the kick is a pure zoom-out there. That is not a regression - the old rig
 * pinned the distance at *every* aspect - but it does mean the flow claims
 * below can only be made where the pull-back is aspect-driven, which on today's
 * numbers is 19.5:9 and taller. That is the phone the game ships to.
 */
function aspectsWithDollyRoom(): number[] {
  return Object.values(ASPECTS).filter(
    (aspect) => cameraDistanceFor(aspect, BASE_FOV) > TUNING.camera.minDistance,
  );
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

  it('grows with field of view, which is what makes a widening punch safe', () => {
    expect(horizontalHalfExtentAt(9, TOP_FOV, 0.5)).toBeGreaterThan(
      horizontalHalfExtentAt(9, BASE_FOV, 0.5),
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

describe('speedFovFor', () => {
  it('is the base lens only at a standstill, never during a run', () => {
    expect(speedFovFor(0)).toBeCloseTo(BASE_FOV, 9);
    expect(speedFovFor(TUNING.speed.start)).toBeGreaterThan(BASE_FOV + 1);
  });

  it('reaches exactly the full kick at top speed', () => {
    expect(speedFovFor(TUNING.speed.max)).toBeCloseTo(TOP_FOV, 9);
  });

  it('still has most of the kick left to spend once a run is under way', () => {
    /*
     * The counterweight to the floor. Anchoring the lens above zero at the
     * opening is only worth doing if there is still an escalation left to see -
     * a floor of 0.95 would satisfy "not dead at the opening" and kill the cue
     * just as thoroughly from the other end.
     */
    const spentAtStart = speedFovFor(TUNING.speed.start) - BASE_FOV;
    const remaining = TOP_FOV - speedFovFor(TUNING.speed.start);
    expect(spentAtStart).toBeGreaterThan(TUNING.camera.speedFovKick * 0.4);
    expect(remaining).toBeGreaterThan(TUNING.camera.speedFovKick * 0.3);
  });

  it('never narrows as the run speeds up', () => {
    let previous = speedFovFor(0);
    for (let speed = 0; speed <= TUNING.speed.max * 1.5; speed += 0.5) {
      const fov = speedFovFor(speed);
      expect(fov).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = fov;
    }
  });
});

describe('cameraDistanceFor', () => {
  it.each(Object.entries(ASPECTS))(
    'keeps the player fully on screen in the outer lane on %s, at every lens the rig can render',
    (_name, aspect) => {
      for (const fov of everyLens()) {
        const distance = cameraDistanceFor(aspect, fov);
        const visibleHalfWidth = horizontalHalfExtentAt(distance, fov, aspect);
        // The player's far edge must sit inside the frame, with margin to spare.
        expect(visibleHalfWidth).toBeGreaterThanOrEqual(
          worstCaseOffset() + TUNING.player.halfWidth,
        );
      }
    },
  );

  it('sweeps a lens range wide enough for that guarantee to mean something', () => {
    // Sample size, stated: "on screen at every lens" is trivially satisfied by
    // one lens. The sweep has to span the whole kick and the punch on top.
    const lenses = everyLens();
    expect(lenses.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...lenses) - Math.min(...lenses)).toBeGreaterThanOrEqual(
      TUNING.camera.speedFovKick + CAMERA_FEEL.punchDegrees - 1e-9,
    );
  });

  it('pulls further back the narrower the screen', () => {
    expect(cameraDistanceFor(ASPECTS.tallPhone)).toBeGreaterThan(cameraDistanceFor(ASPECTS.tablet));
  });

  it('comes closer the wider the lens, never further', () => {
    for (const aspect of Object.values(ASPECTS)) {
      let previous = cameraDistanceFor(aspect, BASE_FOV);
      for (const fov of everyLens()) {
        const distance = cameraDistanceFor(aspect, fov);
        expect(distance).toBeLessThanOrEqual(previous + 1e-9);
        previous = distance;
      }
    }
  });

  it('never comes closer than the configured minimum on wide screens', () => {
    expect(cameraDistanceFor(ASPECTS.desktop)).toBe(TUNING.camera.minDistance);
    expect(cameraDistanceFor(10)).toBe(TUNING.camera.minDistance);
    // And the floor holds at the widest lens, which is where it matters: the
    // Canvas near plane is pulled out to 0.5 on the stated assumption that
    // nothing is ever closer to the camera than the player.
    expect(cameraDistanceFor(ASPECTS.desktop, TOP_FOV + CAMERA_FEEL.punchDegrees)).toBe(
      TUNING.camera.minDistance,
    );
  });

  it('falls back to the minimum for a degenerate aspect instead of exploding', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(cameraDistanceFor(bad)).toBe(TUNING.camera.minDistance);
    }
  });

  it('falls back to the base lens for a degenerate fov, not to the minimum', () => {
    /*
     * A bad aspect can safely return `minDistance` because there is no framing
     * left to preserve. A bad fov still has one, and `minDistance` is *nearer*
     * than the outer lanes need on a phone - so returning it would put the
     * player off the edge of the screen rather than merely mis-framing them.
     */
    for (const bad of [0, -1, 180, 400, Number.NaN, Number.POSITIVE_INFINITY]) {
      const distance = cameraDistanceFor(ASPECTS.tallPhone, bad);
      expect(distance).toBe(cameraDistanceFor(ASPECTS.tallPhone, BASE_FOV));
      expect(Number.isFinite(distance)).toBe(true);
    }
  });

  it('stays within a sane range for every plausible device and lens', () => {
    for (const aspect of Object.values(ASPECTS)) {
      for (const fov of everyLens()) {
        const distance = cameraDistanceFor(aspect, fov);
        expect(distance).toBeGreaterThan(0);
        // Far enough back and the player becomes an unreadable speck.
        expect(distance).toBeLessThan(20);
      }
    }
  });
});

describe('the lens and the distance as one framing', () => {
  it('holds the subject size across the whole speed sweep where the dolly has room', () => {
    const aspects = aspectsWithDollyRoom();
    // The counterweight: this claim is only interesting if it is being made
    // about real devices rather than about an empty list.
    expect(aspects.length).toBeGreaterThanOrEqual(2);
    expect(aspects).toContain(ASPECTS.tallPhone);

    for (const aspect of aspects) {
      const atRest = worldAcrossThePlayer(aspect, BASE_FOV);
      for (const fov of speedLenses()) {
        // Within a few per cent, in both directions, over a twelve degree sweep.
        expect(worldAcrossThePlayer(aspect, fov)).toBeLessThan(atRest * 1.08);
        expect(worldAcrossThePlayer(aspect, fov)).toBeGreaterThan(atRest * 0.92);
      }

      /*
       * The mutation, kept rather than run once by hand: the rig this replaces
       * derived the pull-back from the *base* lens and then rendered with the
       * wide one, so it showed a quarter more world at the same range and drew
       * the player correspondingly smaller the faster the run got - the wrong
       * sign for the one cue whose entire job is to say "faster". If the fix is
       * ever undone, this is the number that moves.
       */
      const pinnedToBaseLens = horizontalHalfExtentAt(
        cameraDistanceFor(aspect, BASE_FOV),
        TOP_FOV,
        aspect,
      );
      expect(pinnedToBaseLens).toBeGreaterThan(atRest * 1.15);
    }
  });

  it('lets the punch stretch the frame without pulling the camera in', () => {
    for (const aspect of Object.values(ASPECTS)) {
      const settled = cameraDistanceFor(aspect, TOP_FOV);
      const punchedFov = TOP_FOV + CAMERA_FEEL.punchDegrees;

      /*
       * The rig applies the framing floor as `Math.max(dampedZ, floor)`, so a
       * floor that only ever *falls* during a punch cannot move the camera at
       * all. This is the half of the punch design that is easy to get wrong -
       * the dolly target reads the speed lens, and this is why doing so is safe
       * rather than merely conservative.
       */
      expect(cameraDistanceFor(aspect, punchedFov)).toBeLessThanOrEqual(settled + 1e-9);

      // And the frame genuinely stretches at the settled distance, or the whole
      // impulse is a no-op dressed up as a cue.
      expect(horizontalHalfExtentAt(settled, punchedFov, aspect)).toBeGreaterThan(
        horizontalHalfExtentAt(settled, TOP_FOV, aspect) * 1.05,
      );
    }
  });

  it('never spends optic flow to buy the wider lens', () => {
    const aspects = aspectsWithDollyRoom();
    expect(aspects.length).toBeGreaterThanOrEqual(2);

    for (const aspect of aspects) {
      const atRest = groundFlowPerSpeed(aspect, BASE_FOV);
      for (const fov of speedLenses()) {
        // Widening the lens spreads the same world over more screen, which on
        // its own costs flow; dollying in more than pays it back.
        expect(groundFlowPerSpeed(aspect, fov)).toBeGreaterThanOrEqual(atRest);
      }
      // And it is a real gain, not a rounding-error one - the same order as the
      // eye-height drop P0 made for exactly this reason.
      expect(groundFlowPerSpeed(aspect, TOP_FOV)).toBeGreaterThan(atRest * 1.1);

      /*
       * The mutation, on the same measure. With the distance pinned at the base
       * lens the flow *falls* by about a fifth across the speed ramp: the old
       * rig made the ground sweep more slowly the faster the run went, which is
       * the exact opposite of what the kick was added to do.
       */
      const pinned =
        TUNING.camera.height /
        (cameraDistanceFor(aspect, BASE_FOV) ** 2 * Math.tan((TOP_FOV * Math.PI) / 360));
      expect(pinned).toBeLessThan(atRest * 0.85);
    }
  });
});
