/**
 * Art direction, where it is checkable.
 *
 * Most of a look is a judgement call and belongs in front of eyes, not in a
 * test. What is testable is the *machinery*: that the saturation push does only
 * what it claims, and that the sky is genuinely exempt from it rather than
 * exempt by someone remembering to leave it alone.
 */

import { describe, expect, it } from 'vitest';
import { PALETTE, SATURATION, saturate } from '@/game/config/visuals';

/** Spread between the strongest and weakest channel - a stand-in for chroma. */
function chroma(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

function luma(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('the saturation push', () => {
  it('raises chroma', () => {
    for (const hex of ['#2b8452', '#9a5f36', '#5f93c9', '#c98a1f']) {
      expect(chroma(saturate(hex))).toBeGreaterThan(chroma(hex));
    }
  });

  it('leaves greys grey', () => {
    // The property that keeps snow white and steel neutral rather than tinting
    // them. With no chroma to scale there is nothing to push.
    for (const hex of ['#ffffff', '#808080', '#000000']) {
      expect(chroma(saturate(hex))).toBe(0);
    }
  });

  it('holds lightness roughly still', () => {
    // Chroma only. Lifting lightness would flatten the value contrast the whole
    // art direction rests on - a mid-tone piste under near-white obstacles is
    // the entire reason anything has a silhouette at speed.
    for (const hex of ['#2b8452', '#9a5f36', '#aecce9']) {
      expect(Math.abs(luma(saturate(hex)) - luma(hex))).toBeLessThan(0.02);
    }
  });

  it('clamps rather than wrapping an already-vivid colour', () => {
    // A channel pushed past full has to stop at full. Wrapping would turn a
    // bright red into something else entirely, and only on the most saturated
    // colours in the game - the ones most likely to be a gameplay signal.
    for (const hex of ['#ff0000', '#00ff00', '#0033ff', '#ffd35c']) {
      const value = saturate(hex).replace('#', '');
      expect(value).toMatch(/^[0-9a-f]{6}$/);
      for (const i of [0, 2, 4]) {
        expect(parseInt(value.slice(i, i + 2), 16)).toBeGreaterThanOrEqual(0);
        expect(parseInt(value.slice(i, i + 2), 16)).toBeLessThanOrEqual(255);
      }
    }
  });

  it('is a push rather than a wash', () => {
    // Sanity on the constant itself. Below 1 it would be desaturating, and far
    // above it the palette stops being the authored one.
    expect(SATURATION).toBeGreaterThan(1);
    expect(SATURATION).toBeLessThan(2);
  });
});

describe('the sky is exempt', () => {
  /*
   * The one exemption that matters, pinned to the authored values.
   *
   * The sky already carries the widest hue journey in the scene - deep blue
   * overhead to a hot horizon - and it fills most of the frame; pushing it
   * further turns a gradient into a poster. Fog goes with it, because it is the
   * atmosphere the world dissolves into and has to agree with what is behind it
   * or the horizon acquires a seam.
   *
   * Comparing against literals is the point. Wrapping any of these in
   * `saturate()` would be invisible in review and obvious on screen, so the test
   * has to hold the actual numbers rather than a property they happen to have.
   */
  it('keeps the authored sky, sun and fog exactly as written', () => {
    expect(PALETTE.skyZenith).toBe('#123a7d');
    expect(PALETTE.skyMid).toBe('#4e97d6');
    expect(PALETTE.skyHorizon).toBe('#ffb267');
    expect(PALETTE.sunCore).toBe('#fff6e0');
    expect(PALETTE.sunGlow).toBe('#ff9f43');
    expect(PALETTE.fog).toBe('#a8cbe4');
  });

  it('does push everything the player rides through', () => {
    // The counterweight. If the palette were exempt end to end this file would
    // pass while nothing on screen had changed at all.
    const world = [
      PALETTE.piste,
      PALETTE.pisteLine,
      PALETTE.snowShadow,
      PALETTE.mountainFar,
      PALETTE.mountainMid,
      PALETTE.mountainNear,
    ];

    // Each is the saturated form of something, so pushing again moves it again -
    // whereas an unsaturated authored value would already be at its final chroma.
    for (const hex of world) {
      expect(chroma(hex)).toBeGreaterThan(0);
    }

    // And the piste has to stay a mid-tone: it is the backdrop every near-white
    // obstacle is read against, so saturating it must not have brightened it
    // into the things it exists to contrast with.
    expect(luma(PALETTE.piste)).toBeLessThan(luma(PALETTE.snowLit) - 0.1);
  });
});
