/**
 * The score's arrangement.
 *
 * Music is judged by listening to it and this file does not pretend otherwise.
 * What it holds is the part of "annoying and boring" that is arithmetic: how
 * long the piece is before it repeats, whether it ever stops, and whether the
 * mix can be pushed past what the limiter was set up for.
 *
 * All three had gone wrong silently. The piece was eight bars long, so it
 * repeated three hundred times in a decent run; nothing ever rested; and the
 * gain budget was a comment claiming a sum nobody had added up since.
 *
 * `voicesForStep` is pure precisely so this can exist - no AudioContext, no
 * clock, no device that can make a sound.
 */

import { describe, expect, it } from 'vitest';
import {
  BARS_PER_CYCLE,
  BARS_PER_PHRASE,
  STEPS_PER_BAR,
  stepGain,
  voicesForStep,
  type MusicIntensity,
  type VoiceRole,
} from '@/platform/music';

const STEPS_PER_CYCLE = BARS_PER_CYCLE * STEPS_PER_BAR;

const RUNNING: MusicIntensity = { energy: 0.5, tension: 0, running: true };
const FLAT_OUT: MusicIntensity = { energy: 1, tension: 1, running: true };
const MENU: MusicIntensity = { energy: 0, tension: 0, running: false };

/** Every step of one full cycle, at a given intensity. */
function cycle(level: MusicIntensity) {
  return Array.from({ length: STEPS_PER_CYCLE }, (_, i) => voicesForStep(i, level));
}

function rolesAt(index: number, level: MusicIntensity): VoiceRole[] {
  return voicesForStep(index, level).map((voice) => voice.role);
}

describe('the form', () => {
  it('runs for over a minute before it repeats', () => {
    /*
     * The boredom fix, as a number. The old piece was eight bars at 96 BPM -
     * twenty seconds - and a two-minute run heard it six times through. Four
     * phrases at 100 BPM is nearer eighty seconds, which is longer than most
     * runs last.
     */
    const seconds = (BARS_PER_CYCLE * STEPS_PER_BAR * 60) / 100 / 4;
    expect(seconds).toBeGreaterThan(60);
  });

  it('plays a different tune in every phrase', () => {
    /*
     * The counterweight to the test above, and the one that actually bites. A
     * 32-bar cycle whose phrases are copies of each other is an 8-bar cycle
     * wearing a longer number, and every length constant would still agree.
     *
     * Deliberately the *arpeggio* alone rather than everything sounding. A
     * fingerprint over all the voices is satisfied by the kit changing while
     * the melody repeats - which was the first version of this test, and which
     * passed happily when the chords and the figure were forced identical.
     */
    const steps = cycle(RUNNING);
    const phraseSteps = BARS_PER_PHRASE * STEPS_PER_BAR;

    const tunes = [0, 1, 2, 3].map((p) =>
      steps
        .slice(p * phraseSteps, (p + 1) * phraseSteps)
        .map((voices) =>
          voices
            .filter((v) => v.role === 'arp')
            .map((v) => v.frequency.toFixed(1))
            .join(','),
        )
        .join('/'),
    );

    expect(new Set(tunes).size).toBe(tunes.length);
  });

  it('changes chords between the two phrases', () => {
    // The harmonic half of the same point. Four figures over one progression
    // would pass the test above and still be one chord loop all the way down.
    const bassOf = (phrase: number) =>
      Array.from({ length: BARS_PER_PHRASE }, (_, bar) => {
        const index = (phrase * BARS_PER_PHRASE + bar) * STEPS_PER_BAR;
        return voicesForStep(index, RUNNING).find((v) => v.role === 'bass')?.frequency.toFixed(1);
      }).join(',');

    expect(bassOf(0)).not.toBe(bassOf(1));
  });

  it('takes the arpeggio away somewhere in the cycle', () => {
    // The rest. Eight bars of unbroken sixteenths is what turned a hook into a
    // drone, and a texture is only noticed when it comes back.
    const bars = Array.from({ length: BARS_PER_CYCLE }, (_, bar) =>
      Array.from({ length: STEPS_PER_BAR }, (_, s) =>
        rolesAt(bar * STEPS_PER_BAR + s, FLAT_OUT),
      ).flat(),
    );

    const silent = bars.filter((roles) => !roles.includes('arp'));
    expect(silent.length).toBeGreaterThan(0);
    // But not so much that the piece stops being one. A cycle that rested half
    // the time would satisfy the line above and sound broken.
    expect(silent.length).toBeLessThan(BARS_PER_CYCLE / 4);
  });

  it('never drops the pad and bass, even while resting', () => {
    // The rest is the kit and the arpeggio standing down, not a hole. Harmony
    // continuing through it is the difference between a breath and a dropout.
    for (let bar = 0; bar < BARS_PER_CYCLE; bar++) {
      expect(rolesAt(bar * STEPS_PER_BAR, FLAT_OUT)).toContain('pad');
      expect(rolesAt(bar * STEPS_PER_BAR, FLAT_OUT)).toContain('bass');
    }
  });
});

describe('what the player is doing', () => {
  it('sits still on the menus', () => {
    // No arpeggio, no kit, nothing driving - just harmony behind the buttons.
    const roles = new Set(cycle(MENU).flat().map((voice) => voice.role));
    expect(roles.has('arp')).toBe(false);
    expect(roles.has('kick')).toBe(false);
    expect(roles.has('hat')).toBe(false);
    expect(roles.has('pad')).toBe(true);
  });

  it('opens the arpeggio filter as the run speeds up', () => {
    /*
     * The cure for "annoying". A raw square wave is all odd harmonics straight
     * up the spectrum, which is exactly where a phone speaker is harshest. The
     * sweep doubles as the clearest speed cue in the piece.
     */
    const cutoffAt = (energy: number) => {
      const arp = voicesForStep(0, { energy, tension: 0, running: true }).find(
        (v) => v.role === 'arp',
      );
      if (!arp?.cutoff) throw new Error('no arpeggio to measure');
      return arp.cutoff;
    };

    expect(cutoffAt(1)).toBeGreaterThan(cutoffAt(0) * 2);
  });

  it('gives every pitched voice a filter', () => {
    // The counterweight: the sweep above is satisfied by one filtered voice
    // among six raw ones, which is the mix that was reported as annoying.
    for (const voice of cycle(FLAT_OUT).flat()) {
      if (voice.role === 'hat' || voice.role === 'kick') continue;
      expect(`${voice.role} cutoff`).toBe(`${voice.role} ${voice.cutoff ? 'cutoff' : 'unfiltered'}`);
    }
  });

  it('holds the kit back until the run is moving', () => {
    const crawling: MusicIntensity = { energy: 0.05, tension: 0, running: true };
    const roles = new Set(cycle(crawling).flat().map((voice) => voice.role));
    expect(roles.has('kick')).toBe(false);
    expect(roles.has('hat')).toBe(false);

    // And brings it in once it is. Without this the test above passes on a kit
    // that was never wired up at all.
    const moving = new Set(cycle(FLAT_OUT).flat().map((voice) => voice.role));
    expect(moving.has('kick')).toBe(true);
    expect(moving.has('hat')).toBe(true);
  });

  it('only sounds the warning when the patrol is close', () => {
    const safe = new Set(cycle({ energy: 1, tension: 0, running: true }).flat().map((v) => v.role));
    expect(safe.has('tension')).toBe(false);
    expect(new Set(cycle(FLAT_OUT).flat().map((v) => v.role)).has('tension')).toBe(true);
  });
});

describe('the gain budget', () => {
  it('never exceeds what the limiter was set up for', () => {
    /*
     * The mix in `audio.ts` drives this bus at 1.6 into a limiter, which is
     * what lets the score be loud enough to hear on a phone. That only holds if
     * the worst step stays near what it was tuned against - so the comment in
     * music.ts claiming "about 1.15" is checked here rather than trusted.
     *
     * Measured across a whole cycle at full energy and full tension, which is
     * the loudest the piece can be.
     */
    const worst = Math.max(...cycle(FLAT_OUT).map(stepGain));
    expect(worst).toBeLessThan(1.2);
  });

  it('is being measured against something that could fail it', () => {
    // A budget test that has never been near its bound proves nothing. The
    // loudest step has to be most of the allowance, or the number is arbitrary.
    const worst = Math.max(...cycle(FLAT_OUT).map(stepGain));
    expect(worst).toBeGreaterThan(0.8);
  });

  it('is quieter on the menus than at full pelt', () => {
    expect(Math.max(...cycle(MENU).map(stepGain))).toBeLessThan(
      Math.max(...cycle(FLAT_OUT).map(stepGain)),
    );
  });
});
