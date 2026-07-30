/**
 * The home screen's composition, in the one place it can fail silently.
 *
 * The rider on the home screen is the product shot. With the menu camera they
 * stand between roughly 53% and 72% of the frame height, contact shadow
 * included, and 54% to 77% once the frame is squarer than a modern phone - so
 * the screen is furniture at the top, the character alone in the middle, and
 * the one thing you act on at the bottom. Nothing in the code says any of that,
 * and the ways it breaks are all *emergent*.
 *
 * It has now been broken twice, by two different mechanisms, and this file
 * holds one guard per mechanism.
 *
 * 1. **The mode picker wrapped.** It was a `flex-wrap` row: at a phone's width
 *    the four real mode names measured three pills plus a full-width fourth,
 *    66 px instead of 37, which pushed the top of a bottom-anchored action
 *    stack up to 62% of the frame - straight across the rider's chest. Nobody
 *    wrote "two rows"; the row count was an emergent property of four strings,
 *    a font size and a screen width, and it changed with any of them.
 *
 * 2. **A fixed row was not enough.** One row of chips still put the stack's top
 *    edge at 69%, across the rider's board. The picker is furniture rather than
 *    an action, so it moved up beside the records bar and the bottom of the
 *    screen went down to two rows. That left free space to redistribute, and
 *    the two `margin-top: auto`s that used to place the bands split it evenly -
 *    spending half of every pixel won at the bottom on walking the records bar
 *    *down* onto the rider's crown instead. The bands are placed by two
 *    flexible spacers now, at a deliberate ratio.
 *
 * Layout assertions in a repo with no DOM: the stylesheet and the component are
 * read as text, which is enough because every fact below is a single
 * declaration or a single ordering. Anything needing a real box model belongs
 * in front of a human with a device, not here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GAME_MODE_IDS } from '@/game/content/modes';

/**
 * The stylesheet with its comments taken out.
 *
 * Not tidiness: this file is heavily commented and several of those comments
 * quote the declaration they are arguing against - `.home-actions` opens by
 * saying it has no `margin-top: auto`, which a naive search reads as having
 * one. Stripping first also means a `}` inside prose cannot end a rule body
 * early.
 */
const css = readFileSync(
  fileURLToPath(new URL('../src/index.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');
const home = readFileSync(fileURLToPath(new URL('../src/app/Home.tsx', import.meta.url)), 'utf8');

/** The root font size every `rem` below is resolved against. */
const ROOT_PX = 16;

/**
 * Android's minimum touch target. Quoted in dp, and a WebView at default zoom
 * draws one CSS pixel per dp, so the two are the same number here.
 */
const MIN_TOUCH_DP = 48;

/**
 * The declaration block for a top-level rule, by exact selector.
 *
 * Deliberately strict about the selector and deliberately unforgiving when it
 * finds nothing: a lenient match that quietly returns an empty string would
 * turn "the rule was renamed" - which is exactly how this regression would
 * come back - into a passing test.
 */
function ruleBody(selector: string): string {
  const pattern = new RegExp(
    `(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`,
  );
  const body = pattern.exec(css)?.[1];
  if (body === undefined) throw new Error(`no rule for "${selector}" in src/index.css`);
  return body;
}

/** A length in `rem`, as pixels. Throws rather than guessing at other units. */
function remPx(body: string, property: string): number {
  const found = new RegExp(`${property}:\\s*(-?[\\d.]+)rem`).exec(body);
  if (found === null) throw new Error(`"${property}" is not a rem length in: ${body.trim()}`);
  return Number(found[1]) * ROOT_PX;
}

/** The `flex-grow` term of a `flex: <grow> <shrink> <basis>` shorthand. */
function flexGrow(selector: string): number {
  const found = /flex:\s*(\d+)\s+\d+\s+0\b/.exec(ruleBody(selector));
  if (found === null) {
    throw new Error(
      `${selector} must set \`flex: <grow> <shrink> 0\`. The zero basis is what makes ` +
        'the grow factor a share of the whole free space rather than of whatever is ' +
        'left after an intrinsic height',
    );
  }
  return Number(found[1]);
}

describe('home mode picker', () => {
  /**
   * The counterweight to everything below.
   *
   * "The chips fit on one row" is trivially true of one chip. Both assertions
   * that follow are only worth anything because there are enough modes, with
   * long enough names, that a wrapping row genuinely wrapped - so state that
   * rather than assume it.
   */
  it('has enough modes, with long enough names, for the row to be at risk', () => {
    expect(GAME_MODE_IDS.length).toBeGreaterThanOrEqual(4);
    // "Daily Challenge" is the one that forced its own row. A picker whose
    // longest label is short would not need a grid at all.
    const longest = Math.max(...GAME_MODE_IDS.map((id) => id.length));
    expect(longest).toBeGreaterThanOrEqual(5);
  });

  it('gives the picker exactly one column per mode, so it is always one row', () => {
    const body = ruleBody('.mode-picker');
    const columns = /grid-template-columns:\s*repeat\(\s*(\d+)\s*,/.exec(body);

    expect(
      columns,
      '.mode-picker must set `grid-template-columns: repeat(N, ...)`; a wrapping ' +
        'flex row is what put a second row of chips across the rider',
    ).not.toBeNull();

    expect(
      Number(columns?.[1]),
      `the picker has ${String(columns?.[1])} columns for ${GAME_MODE_IDS.length} modes - ` +
        'the surplus wraps onto a second row and pushes the action stack up over the rider',
    ).toBe(GAME_MODE_IDS.length);
  });

  it('lets a long mode name wrap inside its own chip', () => {
    const body = ruleBody('.mode-chip');

    // The grid fixes the column width, so `nowrap` no longer means "one row" -
    // it means "Daily Challenge overflows its pill". The height it would save
    // is already paid for by `min-height`, which sizes every chip for two
    // lines whether or not it uses them.
    expect(
      /white-space:\s*nowrap/.test(body),
      '.mode-chip must not be `white-space: nowrap` inside a fixed grid column',
    ).toBe(false);
    expect(
      /min-height:/.test(body),
      '.mode-chip needs a min-height so a one-line chip matches a two-line one',
    ).toBe(true);
  });

  /**
   * Where the row lives, which is the fix for the second break.
   *
   * Source order is column order for siblings, so "the picker is written before
   * the action stack" is exactly "the picker is not part of the action stack".
   * Nesting it back inside `.home-actions` - the shape it had - puts its index
   * after the stack's and fails here.
   */
  it('keeps the mode picker out of the bottom action stack', () => {
    const picker = home.indexOf('className="mode-picker"');
    const actions = home.indexOf('className="home-actions"');

    expect(picker, 'no `mode-picker` element in src/app/Home.tsx').toBeGreaterThanOrEqual(0);
    expect(actions, 'no `home-actions` element in src/app/Home.tsx').toBeGreaterThanOrEqual(0);
    expect(
      picker,
      "the mode picker is inside or below the action stack again. As the stack's top " +
        "row it measured 37 px at 69% of the frame, straight across the rider's board; " +
        'it belongs in the furniture band under the records bar',
    ).toBeLessThan(actions);
  });

  /**
   * The touch target, and the reason it is allowed to be full size now.
   *
   * The visible chip is sized by the composition and is smaller than a thumb;
   * `::before` grows the hit box past it. While the row sat one gutter above
   * Play the box had to stay short of 48 dp, because a chip swallowing a tap
   * meant for Play is far worse than a chip that needs an accurate thumb. Below
   * the row is empty stage now, so there is nothing left to apologise to.
   */
  it('gives each chip a touch target of at least 48 dp', () => {
    const chip = remPx(ruleBody('.mode-chip'), 'min-height');
    // Two values means vertical then horizontal, and only the vertical one is
    // being spent on height here.
    const vertical = remPx(ruleBody('.mode-chip::before'), 'inset');

    // Counterweight: a hit box that merely equals the pill would pass the size
    // check by making the pill enormous, which is the composition problem this
    // whole file exists to stop. The overhang has to be real.
    expect(
      vertical,
      '.mode-chip::before must be a negative inset - it grows the hit box',
    ).toBeLessThan(0);

    expect(
      chip + 2 * Math.abs(vertical),
      `the mode chip's touch target is ${String(chip + 2 * Math.abs(vertical))} dp`,
    ).toBeGreaterThanOrEqual(MIN_TOUCH_DP);
  });
});

describe('home band placement', () => {
  /**
   * The counterweight: a ratio only means anything if both sides are real.
   *
   * "The stage gets more than the sky" is trivially satisfied by deleting the
   * sky, which pins the title block under the coin row and gives the top of the
   * screen away instead of the middle.
   */
  it('keeps both spacers flexible, so there is a ratio at all', () => {
    expect(flexGrow('.home-gap'), 'the sky above the title must still grow').toBeGreaterThan(0);
    expect(flexGrow('.home-stage'), "the character's band must still grow").toBeGreaterThan(0);
  });

  it("gives the character's band the larger share of the free space", () => {
    const sky = flexGrow('.home-gap');
    const stage = flexGrow('.home-stage');

    expect(
      stage,
      `the sky takes ${String(sky)} and the stage ${String(stage)}. An even split is what ` +
        'the two `margin-top: auto`s did, and it spends half of every pixel freed at the ' +
        "bottom of the screen on walking the records bar down onto the rider's crown - " +
        'measured, from 47.4% to 51.5% against a crown at 53%',
    ).toBeGreaterThan(sky);
  });

  /**
   * Neither band may be placed by an auto margin again.
   *
   * This is the mechanism, not a preference. Auto margins share free space
   * equally between every one of them and there is no way to weight them, so
   * reintroducing one silently reverts the ratio above to 1:1 while leaving
   * both spacers in the file looking as though they still decide anything.
   */
  it('does not place the bands with auto margins', () => {
    for (const selector of ['.home-title-block', '.home-actions']) {
      expect(
        /margin-top:\s*auto/.test(ruleBody(selector)),
        `${selector} must not use \`margin-top: auto\`; the spacers place the bands, and ` +
          'an auto margin takes an equal share of the free space that cannot be weighted',
      ).toBe(false);
    }
  });
});
