/**
 * The impact flash.
 *
 * Small enough to hold in your head, and every rule here exists because
 * breaking it is invisible in review and obvious on a phone: an impulse that
 * sums whites out the screen on a busy tick, one that never reaches zero costs
 * a style write for the rest of the session, and one that decays per frame
 * rather than per second feels different on every device.
 *
 * This was two impulses and is now one. The other was camera shake, and it is
 * gone deliberately rather than by accident - see `FEEDBACK` in `visuals.ts`.
 * The assertion at the bottom is what stops it coming back by reflex.
 */

import { describe, expect, it } from 'vitest';
import { FEEDBACK } from '@/game/config/visuals';
import { createFeedbackState, decayFeedback, punch, resetFeedback } from '@/game/systems/feedback';

describe('punching the screen', () => {
  it('takes the strongest, never the sum', () => {
    // Two events in one tick would otherwise white the screen out for something
    // neither of them was on its own.
    const state = createFeedbackState();
    punch(state, 0.2);
    punch(state, 0.4);
    punch(state, 0.1);

    expect(state.flash).toBe(0.4);
  });

  it('never drops an impulse already in flight', () => {
    const state = createFeedbackState();
    punch(state, 0.6);
    punch(state, 0.05);
    expect(state.flash).toBe(0.6);
  });

  it('clamps to the usable range', () => {
    const state = createFeedbackState();
    punch(state, 9);
    expect(state.flash).toBe(1);

    punch(state, -3);
    expect(state.flash).toBe(1);
  });
});

describe('decay', () => {
  it('halves over the half-life', () => {
    const state = createFeedbackState();
    punch(state, 1);
    decayFeedback(state, FEEDBACK.flashHalfLife);
    expect(state.flash).toBeCloseTo(0.5, 5);
  });

  it('does not depend on the frame rate', () => {
    // The same elapsed time in one long step and in many short ones has to
    // arrive at the same place, or a 120 Hz phone gets a different game feel
    // from a 60 Hz one.
    const coarse = createFeedbackState();
    const fine = createFeedbackState();
    punch(coarse, 1);
    punch(fine, 1);

    decayFeedback(coarse, 0.2);
    for (let i = 0; i < 24; i++) decayFeedback(fine, 0.2 / 24);

    expect(fine.flash).toBeCloseTo(coarse.flash, 4);
  });

  it('reaches exactly zero, and stays there', () => {
    // Exponential decay never actually arrives. A flash of 1e-8 still costs a
    // style write every frame, for ever.
    const state = createFeedbackState();
    punch(state, 1);
    for (let i = 0; i < 200; i++) decayFeedback(state, 1 / 60);

    expect(state.flash).toBe(0);

    decayFeedback(state, 1 / 60);
    expect(state.flash).toBe(0);
  });

  it('is over quickly', () => {
    // The counterweight to every bound above, all of which a half-life of ten
    // seconds would also satisfy while leaving a white veil over the game.
    expect(FEEDBACK.flashHalfLife).toBeGreaterThan(0);
    expect(FEEDBACK.flashHalfLife).toBeLessThan(0.2);
  });
});

describe('resetting', () => {
  it('clears it, so a new run does not open mid-crash', () => {
    const state = createFeedbackState();
    punch(state, 1);
    resetFeedback(state);
    expect(state.flash).toBe(0);
  });
});

describe('there is no camera shake', () => {
  it('and nothing here offers one', () => {
    /*
     * A guard against a reflex, not against a bug. Shake is the first thing
     * anyone reaches for when a moment needs weight, and it was in this project
     * on crashes, landings, near misses and patrol pressure before being pulled
     * out on sight: on a phone held in two hands, a camera that moves when the
     * player did not move it reads as a fault rather than as force.
     *
     * Asserted against the config rather than the camera because the camera is
     * not testable here - but a shake cannot be reintroduced without a strength
     * to reintroduce it at, and this is where that would have to live.
     */
    const keys = Object.keys(FEEDBACK);
    expect(keys.filter((key) => key.toLowerCase().includes('shake'))).toEqual([]);

    // And the state carries nothing to drive one with.
    expect(Object.keys(createFeedbackState())).toEqual(['flash']);
  });
});
