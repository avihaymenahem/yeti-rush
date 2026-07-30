/**
 * The impact channels.
 *
 * Small enough to hold in your head, and every rule here exists because
 * breaking it is invisible in review and obvious on a phone: an impulse that
 * sums whites out the screen on a busy tick, one that never reaches zero costs
 * a style write for the rest of the session, and one that decays per frame
 * rather than per second feels different on every device.
 *
 * There are three - flash, rush and shove - and one that there must never be
 * is camera shake. It is gone deliberately rather than by accident, see
 * `FEEDBACK` in `visuals.ts`, and the assertions at the bottom are what stop it
 * coming back by reflex as the channel list grows.
 */

import { describe, expect, it } from 'vitest';
import { FEEDBACK } from '@/game/config/visuals';
import {
  createFeedbackState,
  decayFeedback,
  punch,
  punchRush,
  punchShove,
  resetFeedback,
} from '@/game/systems/feedback';

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

describe('the channels are separate', () => {
  it('does not let one event raise another channel', () => {
    // The whole reason for three scalars rather than one. A crash is styled as
    // snow thrown at the lens; if punching the flash also punched the rush,
    // every event in the game would end up being the same picture again.
    const state = createFeedbackState();
    punch(state, 1);
    expect(state.rush).toBe(0);
    expect(state.shove).toBe(0);

    const other = createFeedbackState();
    punchRush(other, 1);
    punchShove(other, 0.5);
    expect(other.flash).toBe(0);
    expect(other.rush).toBe(1);
    expect(other.shove).toBe(0.5);
  });

  it('gives each one its own half-life', () => {
    // Shove outliving the flash is the point: a crash is instantaneous and a
    // trip is something the player recovers from over most of a second. A
    // shared decay rate would collapse them back into one event.
    const state = createFeedbackState();
    punch(state, 1);
    punchRush(state, 1);
    punchShove(state, 1);

    decayFeedback(state, 0.1);

    expect(state.shove).toBeGreaterThan(state.rush);
    expect(state.rush).toBeGreaterThan(state.flash);
  });
});

describe('decay', () => {
  it('halves over the half-life', () => {
    const state = createFeedbackState();
    punch(state, 1);
    decayFeedback(state, FEEDBACK.flashHalfLife);
    expect(state.flash).toBeCloseTo(0.5, 5);
  });

  it('halves the other channels over theirs', () => {
    const state = createFeedbackState();
    punchRush(state, 1);
    decayFeedback(state, FEEDBACK.rushHalfLife);
    expect(state.rush).toBeCloseTo(0.5, 5);

    const shoved = createFeedbackState();
    punchShove(shoved, 1);
    decayFeedback(shoved, FEEDBACK.shoveHalfLife);
    expect(shoved.shove).toBeCloseTo(0.5, 5);
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
    // style write every frame, for ever - and now three of them do.
    const state = createFeedbackState();
    punch(state, 1);
    punchRush(state, 1);
    punchShove(state, 1);
    for (let i = 0; i < 200; i++) decayFeedback(state, 1 / 60);

    expect(state.flash).toBe(0);
    expect(state.rush).toBe(0);
    expect(state.shove).toBe(0);

    decayFeedback(state, 1 / 60);
    expect(state.flash).toBe(0);
    expect(state.rush).toBe(0);
    expect(state.shove).toBe(0);
  });

  it('is over quickly', () => {
    // The counterweight to every bound above, all of which a half-life of ten
    // seconds would also satisfy while leaving a white veil over the game.
    // Every channel is a *transient*; the one continuous cue in the pass is
    // driven by the run's speed and capped separately by `speedRushMax`.
    for (const halfLife of [
      FEEDBACK.flashHalfLife,
      FEEDBACK.rushHalfLife,
      FEEDBACK.shoveHalfLife,
    ]) {
      expect(halfLife).toBeGreaterThan(0);
      expect(halfLife).toBeLessThan(0.2);
    }
  });
});

describe('resetting', () => {
  it('clears every channel, so a new run does not open mid-crash', () => {
    const state = createFeedbackState();
    punch(state, 1);
    punchRush(state, 1);
    punchShove(state, 1);
    resetFeedback(state);

    // Asserted over the live key set rather than field by field, so a fourth
    // channel that nobody remembered to clear fails here - naming itself -
    // instead of leaking into the opening second of the next run.
    expect(Object.entries(state).filter(([, value]) => value !== 0)).toEqual([]);
  });
});

describe('there is no camera shake', () => {
  /*
   * A guard against a reflex, not against a bug. Shake is the first thing
   * anyone reaches for when a moment needs weight, and it was in this project
   * on crashes, landings, near misses and patrol pressure before being pulled
   * out on sight: on a phone held in two hands, a camera that moves when the
   * player did not move it reads as a fault rather than as force.
   *
   * This used to be `expect(Object.keys(createFeedbackState())).toEqual(['flash'])`,
   * which was a fair guard on a one-channel state and a trap the moment a
   * second channel was legitimately added: the only way to grow the state was
   * to weaken the assertion, and a weakened assertion is how the ban actually
   * dies. Split into the two things it was reaching for - a shape nothing may
   * quietly join, and a vocabulary nothing may use at all.
   */

  /**
   * Words that only ever describe moving the viewpoint. `position` is in here
   * because "shake" is not the only spelling of it, and the failure mode is
   * somebody adding the mechanic back under a name nobody bans.
   */
  const MOTION_WORDS = /shake|offset|jitter|position/i;

  it('offers no vocabulary for one', () => {
    // Asserted against the config and the state rather than the camera, because
    // the camera is not testable here - but a shake cannot be reintroduced
    // without a strength to reintroduce it at, and this is where that lives.
    const named = [...Object.keys(FEEDBACK), ...Object.keys(createFeedbackState())];
    expect(named.filter((key) => MOTION_WORDS.test(key))).toEqual([]);
  });

  it('carries exactly the channels it is supposed to', () => {
    /*
     * The allowlist, and the counterweight to the regex above: a state full of
     * motion under innocent names would satisfy that assertion completely.
     * Adding a channel here is a deliberate act with a diff nobody can miss,
     * and the bar for adding one is that it can be consumed *without moving
     * the camera* - flash is a full-screen tint, rush is an additive field of
     * view and an edge gradient, shove is sound and haptics. Field of view is
     * allowed where translation is not because it is a framing change: the
     * edges of the frame stretch and nothing the player is aiming at moves.
     */
    expect(Object.keys(createFeedbackState()).sort()).toEqual(['flash', 'rush', 'shove']);
  });
});
