/**
 * The Android hardware back button.
 *
 * Without this the button closed the app from anywhere - mid-run, mid-shop, mid
 * anything. On Android that is the primary navigation control, and an app that
 * treats it as "quit" reads as broken rather than as minimal.
 *
 * Deliberately a pure function rather than a router. These screens are modal
 * layers over one persistent canvas: there is nothing to address and nothing to
 * deep-link to, so a history stack would only be a second copy of `screen` to
 * keep in step with the first. What is worth getting right is the *decision*,
 * and a decision is testable without a dependency - which is this file.
 */

import { describe, expect, it } from 'vitest';
import { backTarget, type Screen } from '@/app/screens';

const SCREENS: Screen[] = ['home', 'shop', 'missions', 'scores', 'settings'];

describe('mid-run', () => {
  it('pauses rather than doing anything else', () => {
    // The one that matters most. Dumping a player out of a personal best
    // because their thumb found the gesture bar is unforgivable, and it is
    // exactly what the default behaviour did.
    expect(backTarget('running', 'home')).toBe('pause-run');
  });

  it('pauses whatever screen state was left behind', () => {
    for (const screen of SCREENS) {
      expect(backTarget('running', screen)).toBe('pause-run');
    }
  });
});

describe('between runs', () => {
  it('leaves a paused run for the menu', () => {
    expect(backTarget('paused', 'home')).toBe('resume-menu');
  });

  it('leaves a result for the menu', () => {
    expect(backTarget('gameover', 'home')).toBe('resume-menu');
  });

  it('declines a revive rather than ignoring the offer', () => {
    // Back is not an answer to "keep going?", so it takes the other one. An
    // offer that swallowed the back button would be a dead end with a clock.
    expect(backTarget('revive', 'home')).toBe('resume-menu');
  });
});

describe('in a menu', () => {
  it('closes whatever screen is open', () => {
    for (const screen of SCREENS.filter((s) => s !== 'home')) {
      expect(backTarget('menu', screen)).toBe('close-screen');
    }
  });

  it('leaves the app only from home', () => {
    // The counterweight to everything above. Back has to *eventually* exit or
    // the player is trapped in an app they cannot leave the normal way.
    expect(backTarget('menu', 'home')).toBe('exit-app');
    expect(backTarget('boot', 'home')).toBe('exit-app');
  });
});

describe('across every combination', () => {
  it('never exits from anywhere but an idle home screen', () => {
    const phases = ['boot', 'menu', 'running', 'paused', 'revive', 'gameover'];
    for (const phase of phases) {
      for (const screen of SCREENS) {
        const action = backTarget(phase, screen);
        if (action !== 'exit-app') continue;
        expect(screen).toBe('home');
        expect(['boot', 'menu']).toContain(phase);
      }
    }
  });

  it('always decides something', () => {
    // No combination may fall through to undefined: a back press that does
    // nothing at all is the failure this replaced, wearing a different hat.
    const phases = ['boot', 'menu', 'running', 'paused', 'revive', 'gameover', 'nonsense'];
    for (const phase of phases) {
      for (const screen of SCREENS) {
        expect(backTarget(phase, screen)).toBeTruthy();
      }
    }
  });
});
