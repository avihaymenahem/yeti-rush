/**
 * The opening coach.
 *
 * The game shipped for months teaching none of its three inputs. A new player
 * was dropped onto a generated slope and had to discover that a downward swipe
 * existed at all - which is not a difficulty curve, it is a guessing game.
 *
 * What is tested here is mostly restraint. A coach that prompts constantly is
 * worse than none, one that prompts for something two lanes away teaches the
 * wrong lesson, and one that never retires makes every run a tutorial. So the
 * assertions come in pairs: it appears when it should, and it is *silent* the
 * rest of the time.
 */

import { describe, expect, it } from 'vitest';
import { TUNING } from '@/game/config/tuning';
import type { ObstacleKind } from '@/game/content/obstacles';
import { createTestRuntime, type RuntimeState } from '@/game/state/runtime';
import { coachHint, noteLearned } from '@/game/systems/coach';
import { requestJump, requestSlide } from '@/game/systems/player';
import { requestLaneChange } from '@/game/systems/lanes';
import { tickRun } from '@/game/systems/simulation';

const STEP = TUNING.sim.step;

/** A coached run with nothing generated, so only staged obstacles exist. */
function coachedRun(): RuntimeState {
  const rt = createTestRuntime(1);
  rt.running = true;
  rt.coaching = true;
  rt.nextAvalancheAt = Number.MAX_SAFE_INTEGER;
  rt.track.nextChunkStart = Number.MAX_SAFE_INTEGER;
  rt.track.nextPickupAt = Number.MAX_SAFE_INTEGER;
  for (const obstacle of rt.track.obstacles) obstacle.active = false;
  for (const rail of rt.track.rails) rail.active = false;
  for (const ramp of rt.track.ramps) ramp.active = false;
  return rt;
}

function place(rt: RuntimeState, kind: ObstacleKind, lane: number, ahead: number) {
  const slot = rt.track.obstacles.find((obstacle) => !obstacle.active);
  if (!slot) throw new Error('no free obstacle slot');
  slot.active = true;
  slot.passed = false;
  slot.phased = false;
  slot.kind = kind;
  slot.lane = lane as 0 | 1 | 2;
  slot.trackZ = rt.distance + ahead;
  return slot;
}

describe('what it asks for first', () => {
  it('is steering, before anything is in the way', () => {
    // The input the whole game is made of, and the opening is deliberately
    // empty - there is nothing else worth saying during it.
    expect(coachHint(coachedRun())).toBe('move');
  });

  it('stops the moment the player steers', () => {
    const rt = coachedRun();
    requestLaneChange(rt.lane, 1);
    noteLearned(rt);

    expect(rt.learned.move).toBe(true);
    expect(coachHint(rt)).toBeNull();
  });
});

describe('what it asks for next', () => {
  function steered(): RuntimeState {
    const rt = coachedRun();
    rt.learned.move = true;
    return rt;
  }

  it('follows the track rather than a script', () => {
    // Whatever is actually coming decides the lesson, so a player who meets a
    // drift first learns to jump first - taught at the moment it is needed,
    // on the real slope, rather than in a sandbox they then have to leave.
    const jumping = steered();
    place(jumping, 'drift', jumping.lane.targetLane, jumping.speed * 0.8);
    expect(coachHint(jumping)).toBe('jump');

    const sliding = steered();
    place(sliding, 'banner', sliding.lane.targetLane, sliding.speed * 0.8);
    expect(coachHint(sliding)).toBe('slide');
  });

  it('says nothing about something in another lane', () => {
    // Prompting to jump over an obstacle two lanes across teaches the wrong
    // lesson about when jumping is the answer.
    const rt = steered();
    place(rt, 'drift', (rt.lane.targetLane + 1) % 3, rt.speed * 0.8);
    expect(coachHint(rt)).toBeNull();
  });

  it('says nothing about something that is only dodged', () => {
    const rt = steered();
    place(rt, 'boulder', rt.lane.targetLane, rt.speed * 0.8);
    expect(coachHint(rt)).toBeNull();
  });

  it('waits until it is close enough to be about to matter', () => {
    const rt = steered();
    place(rt, 'drift', rt.lane.targetLane, rt.speed * TUNING.coach.lookaheadSeconds * 3);
    expect(coachHint(rt)).toBeNull();
  });

  it('prompts the nearer of two lessons', () => {
    const rt = steered();
    place(rt, 'banner', rt.lane.targetLane, rt.speed * 1.2);
    place(rt, 'drift', rt.lane.targetLane, rt.speed * 0.4);
    expect(coachHint(rt)).toBe('jump');
  });
});

describe('going quiet', () => {
  it('never speaks on a run that is not coached', () => {
    // The counterweight to everything above: an uncoached run has to be silent
    // whatever is on the track, or every run is a tutorial for ever.
    const rt = coachedRun();
    rt.coaching = false;
    place(rt, 'drift', rt.lane.targetLane, rt.speed * 0.5);
    expect(coachHint(rt)).toBeNull();
  });

  it('gives up eventually even if nothing was tried', () => {
    const rt = coachedRun();
    rt.distance = TUNING.coach.givesUpAfter + 1;
    expect(coachHint(rt)).toBeNull();
  });

  it('is done once all three have been used', () => {
    const rt = coachedRun();
    rt.learned.move = true;
    rt.learned.jump = true;
    rt.learned.slide = true;
    place(rt, 'drift', rt.lane.targetLane, rt.speed * 0.5);
    expect(coachHint(rt)).toBeNull();
  });
});

describe('noticing an input', () => {
  it('counts a jump the player made', () => {
    const rt = coachedRun();
    requestJump(rt.player);
    noteLearned(rt);
    expect(rt.learned.jump).toBe(true);
  });

  it('does not count a ramp launch as a jump', () => {
    // The ramp threw them; they did not press anything. Counting it would
    // retire the lesson without teaching it.
    const rt = coachedRun();
    rt.player.motion = 'airborne';
    rt.player.ramping = true;
    noteLearned(rt);
    expect(rt.learned.jump).toBe(false);
  });

  it('counts a slide queued in mid-air', () => {
    // The input was made and the game responded - the dive - so the lesson has
    // landed even though the slide itself starts on touchdown.
    const rt = coachedRun();
    requestJump(rt.player);
    requestSlide(rt.player);
    noteLearned(rt);
    expect(rt.learned.slide).toBe(true);
  });

  it('notices through a real tick, not just when asked directly', () => {
    const rt = coachedRun();
    requestLaneChange(rt.lane, 1);
    tickRun(rt, STEP);
    expect(rt.learned.move).toBe(true);
  });
});

describe('the quiet opening', () => {
  it('is long enough to be worth having', () => {
    // A couple of seconds at the opening pace: time to read one prompt and act
    // on it before the slope starts asking questions.
    expect(TUNING.coach.openingClearance / TUNING.speed.start).toBeGreaterThan(1.5);
  });

  it('is not so long the player is bored before the game starts', () => {
    expect(TUNING.coach.openingClearance / TUNING.speed.start).toBeLessThan(5);
  });
});
