/**
 * The DOM layer's two contracts with the frame loop.
 *
 * Both of them are about *cost*, not about looks, which is why they are worth
 * pinning down at all. The overlays are written sixty times a second from
 * `useFrame`, and the HUD snapshot is pushed into React ten times a second -
 * neither may do work when nothing the player can see has changed. A guard that
 * quietly stops discriminating shows up as a frame-rate complaint months later
 * and looks nothing like the change that caused it.
 *
 * No jsdom. `document` is stubbed with the four lines of it these functions
 * actually touch, which also makes it possible to count style writes - the
 * thing under test - rather than infer them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK } from '@/game/config/visuals';
import { useGameStore, type HudPublish } from '@/game/state/gameStore';

interface StubElement {
  isConnected: boolean;
  style: { opacity: string };
  /** How many times the opacity has been assigned. */
  writes: number;
}

function stubElement(): StubElement {
  const node: StubElement = { isConnected: true, writes: 0, style: { opacity: '' } };
  let opacity = '';
  Object.defineProperty(node.style, 'opacity', {
    get: () => opacity,
    set: (value: string) => {
      opacity = value;
      node.writes++;
    },
  });
  return node;
}

/**
 * A fresh copy of the module plus a document holding the two overlays.
 *
 * Re-imported per test on purpose: the module caches the resolved nodes and the
 * last value written, and that state surviving between tests would make the
 * results depend on the order they ran in.
 */
async function freshOverlays(present = true) {
  const nodes: Record<string, StubElement> = { flash: stubElement(), rush: stubElement() };
  vi.stubGlobal('document', {
    getElementById: (id: string) => (present ? (nodes[id] ?? null) : null),
  });
  vi.resetModules();
  const module = await import('@/platform/screenFlash');
  return { ...module, nodes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the composited overlays', () => {
  it('writes the style once for a value that has not visibly changed', async () => {
    const { applyRush, nodes } = await freshOverlays();
    const rush = nodes.rush as StubElement;

    applyRush(0.42);
    expect(rush.writes).toBe(1);

    // The same value, and a difference three decimal places down. The speed
    // floor is the case that matters: a run held at a steady speed would
    // otherwise write an identical opacity sixty times a second, for ever.
    applyRush(0.42);
    applyRush(0.4237);
    expect(rush.writes).toBe(1);
    expect(rush.style.opacity).toBe('0.42');
  });

  it('still writes when the change is one the display can show', async () => {
    // The counterweight to the test above: a guard that never writes satisfies
    // "does not write twice" perfectly and is completely broken.
    const { applyRush, nodes } = await freshOverlays();
    const rush = nodes.rush as StubElement;

    for (const value of [0.05, 0.06, 0.07, 0.08]) applyRush(value);
    expect(rush.writes).toBe(4);
    expect(rush.style.opacity).toBe('0.08');
  });

  it('keeps the two channels independent', async () => {
    const { applyRush, applyScreenFlash, nodes } = await freshOverlays();

    applyRush(0.3);
    expect((nodes.flash as StubElement).writes).toBe(0);

    applyScreenFlash(0.55);
    expect((nodes.rush as StubElement).style.opacity).toBe('0.3');
    expect((nodes.flash as StubElement).style.opacity).toBe('0.55');
  });

  it('does not strand a value that arrived before React committed the element', async () => {
    // The first call happens on the first rendered frame, which can beat the
    // overlay being committed. Marking the value applied while the node was
    // still missing would leave the edge tint dark for as long as the run held
    // that speed - which, unlike the flash, it genuinely can do for ever.
    const { applyRush, nodes } = await freshOverlays(false);
    applyRush(0.24);

    vi.stubGlobal('document', { getElementById: (id: string) => nodes[id] ?? null });
    applyRush(0.24);

    expect((nodes.rush as StubElement).style.opacity).toBe('0.24');
  });
});

describe('the speed floor under the edge tint', () => {
  it('rises with the run and stops well short of a veil', async () => {
    const { speedRush } = await freshOverlays();

    expect(speedRush(0)).toBe(0);
    expect(speedRush(1)).toBeCloseTo(FEEDBACK.speedRushMax, 6);

    let previous = -1;
    for (let i = 0; i <= 20; i++) {
      const value = speedRush(i / 20);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }

    // The ceiling is the whole design of the channel: a tint that is always
    // slightly on is the definition of something nobody perceives, and it
    // leaves the transient punches nothing to read against. If this ever fails,
    // the fix is not to raise the number here.
    expect(speedRush(1)).toBeLessThanOrEqual(0.35);
  });

  it('is shaped rather than linear, so the opening of a run stays clean', async () => {
    const { speedRush } = await freshOverlays();

    // Break `speedRushGamma` back to 1 and this is what fails: half the speed
    // ramp would carry half the tint, which measured as a uniform grey wash
    // instead of an escalation.
    expect(speedRush(0.5)).toBeLessThan(0.5 * FEEDBACK.speedRushMax * 0.8);
    expect(speedRush(0.9)).toBeGreaterThan(0.7 * FEEDBACK.speedRushMax);
  });

  it('clamps a progress that arrives outside the unit range', async () => {
    const { speedRush } = await freshOverlays();
    expect(speedRush(-2)).toBe(0);
    expect(speedRush(4)).toBeCloseTo(FEEDBACK.speedRushMax, 6);
  });
});

/** A snapshot in the shape the frame loop publishes, with overrides applied. */
function snapshot(overrides: Partial<HudPublish> = {}): HudPublish {
  return {
    score: 100,
    coins: 3,
    distance: 250,
    multiplier: 1,
    timeRemaining: null,
    avalanche: 0,
    trickPending: 0,
    trickChain: 0,
    coach: null,
    powerUps: [],
    ...overrides,
  };
}

describe('the HUD snapshot', () => {
  it('never grows a key the store did not declare', () => {
    const store = useGameStore.getState();
    store.resetHud();
    // `speed` was published ten times a second and read by nothing anywhere in
    // `src/`. It is still accepted so the publishing sites can drop it on their
    // own schedule; it must not reach React, which has no business holding a
    // value that changes on every publish.
    store.publish(snapshot({ speed: 31.4 }));

    expect('speed' in useGameStore.getState()).toBe(false);
  });

  it('re-renders for a combo that broke and nothing else', () => {
    const store = useGameStore.getState();
    store.resetHud();

    let notifications = 0;
    const unsubscribe = useGameStore.subscribe(() => notifications++);

    const settled = snapshot({ combo: 12 });
    store.publish(settled);
    expect(notifications).toBe(1);

    // Publishing the identical snapshot must cost nothing. This is the guard
    // that keeps a 10 Hz publish from being a 10 Hz React render.
    store.publish(settled);
    expect(notifications).toBe(1);

    // Slipping loses the combo and moves no other field on the snapshot - the
    // meter emptying is the entire reason it was drawn, so this must publish.
    store.publish(snapshot({ combo: 0 }));
    expect(notifications).toBe(2);
    expect(useGameStore.getState().combo).toBe(0);

    unsubscribe();
  });

  it('defaults the combo fields the loop does not send yet', () => {
    const store = useGameStore.getState();
    store.resetHud();
    store.publish(snapshot({ combo: 17, bestCombo: 22 }));
    expect(useGameStore.getState().bestCombo).toBe(22);

    // A snapshot from a loop that has not been taught to publish them must
    // clear the meter, not leave the previous run's numbers standing.
    store.publish(snapshot({ score: 101 }));
    expect(useGameStore.getState().combo).toBe(0);
    expect(useGameStore.getState().bestCombo).toBe(0);
  });
});
