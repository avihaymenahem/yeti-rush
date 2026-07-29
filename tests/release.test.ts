/**
 * What has to be true before a build can go to a store.
 *
 * None of this is gameplay, and none of it fails while developing. A debug key,
 * an inspectable WebView, a version that disagrees with the tag, a permission a
 * plugin added on its way in - every one of them builds, installs and plays
 * perfectly, and is found either by a reviewer or by nobody.
 *
 * The declarations filed with a store are the reason this is a test rather than
 * a checklist. A Data safety form says "this app collects no data and makes no
 * network requests", and that stops being a statement about intent the moment
 * anyone adds a `fetch`. Signed paperwork that a code change can silently
 * falsify is exactly the kind of thing a test is for.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const file = (path: string) => fileURLToPath(new URL(path, root));
const read = (path: string) => readFileSync(file(path), 'utf8');

const gradle = read('android/app/build.gradle');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const capacitor = read('capacitor.config.ts');
const pkg = JSON.parse(read('package.json')) as { version: string };

describe('the version', () => {
  it('is the same number in the web build and the Android build', () => {
    // Two files, edited by hand, one release apart. They have not drifted yet;
    // this is here so the first time cannot be on a store listing, where the
    // version a player reports and the version that was uploaded disagree.
    expect(/versionName "([^"]+)"/.exec(gradle)?.[1]).toBe(pkg.version);
  });

  it('has an Android version code that Play can order', () => {
    const code = Number(/versionCode (\d+)/.exec(gradle)?.[1]);
    expect(Number.isInteger(code)).toBe(true);
    expect(code).toBeGreaterThan(0);
  });
});

describe('signing', () => {
  it('has a release config that is not the debug key', () => {
    /*
     * The blocker that made every release so far unpublishable. Play rejects a
     * debug-signed upload outright, and the tempting fix - pointing the release
     * type at `signingConfigs.debug` so the build never fails - reproduces it
     * exactly, only quietly.
     */
    expect(gradle).toMatch(/signingConfigs\s*\{[\s\S]*release\s*\{/);
    const releaseBlock = /buildTypes\s*\{[\s\S]*?release\s*\{([\s\S]*?)\n\s{8}\}/.exec(gradle)?.[1];
    expect(releaseBlock).toBeTruthy();
    expect(releaseBlock).toContain('signingConfig');
    expect(releaseBlock).not.toContain('signingConfigs.debug');
  });

  it('keeps the key and its passwords out of git', () => {
    // An upload key in a public repository cannot be rotated: Play will accept
    // updates signed by that key and nothing else, ever.
    const ignored = read('android/.gitignore');
    for (const pattern of ['*.jks', '*.keystore', 'keystore.properties']) {
      expect(ignored.split('\n')).toContain(pattern);
    }
  });
});

describe('the shipped manifest', () => {
  it('asks for exactly two permissions', () => {
    /*
     * Pinned as a set, not checked for absentees. A Capacitor plugin brings its
     * permissions in through the manifest merger, so a dependency added for one
     * feature can quietly widen what the app requests - and the Data safety
     * declaration is answered against this list.
     */
    const asked = [...manifest.matchAll(/uses-permission android:name="android\.permission\.(\w+)"/g)]
      .map((match) => match[1])
      .sort();
    expect(asked).toEqual(['INTERNET', 'VIBRATE']);
  });

  it('is a game locked to portrait, and says so in both places', () => {
    /*
     * Both halves are load-bearing together. From Android 16 the orientation
     * lock is ignored on displays of 600dp or more - games are exempt, and
     * `appCategory` is the only thing that identifies one. Keep the lock,
     * drop the category, and the game is landscape on every tablet.
     */
    expect(manifest).toContain('android:screenOrientation="portrait"');
    expect(manifest).toContain('android:appCategory="game"');
  });

  it('never ships debuggable', () => {
    expect(manifest).not.toContain('android:debuggable="true"');
  });

  it('targets the API level Play requires', () => {
    // API 36 is the floor for new apps and updates from 31 August 2026.
    const target = Number(/targetSdkVersion = (\d+)/.exec(read('android/variables.gradle'))?.[1]);
    expect(target).toBeGreaterThanOrEqual(36);
  });
});

describe('the release WebView', () => {
  it('is not left inspectable', () => {
    /*
     * `webContentsDebuggingEnabled: true` was set with a comment saying to turn
     * it off before release, and shipped in all eight of them. The fix is to say
     * nothing: Capacitor defaults the flag to whether the app is debuggable, so
     * the correct value is the one nobody has to remember.
     */
    expect(capacitor).not.toMatch(/webContentsDebuggingEnabled:\s*true/);
  });
});

describe('the claims made to the store', () => {
  /**
   * Our own source, excluding the dev-only overlays, which are stripped from the
   * production bundle and are not what the declaration covers.
   */
  const sources = readdirSync(file('src'), { recursive: true, encoding: 'utf8' })
    .map((entry) => `src/${entry.replace(/\\/g, '/')}`)
    .filter((path) => /\.tsx?$/.test(path) && !path.startsWith('src/dev/'));

  it('finds no way for the game to talk to a network', () => {
    /*
     * The Data safety form says no data is collected and none is transmitted.
     * That is a signed statement about a codebase, and one `fetch` in a future
     * feature turns it into a false one - so the absence is asserted rather
     * than remembered. If the game ever legitimately needs a network, this test
     * failing is the reminder to update the declaration first.
     */
    const forbidden = /\bfetch\s*\(|XMLHttpRequest|new WebSocket|sendBeacon|navigator\.geolocation/;
    const offenders = sources.filter((path) => forbidden.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('has read something real rather than an empty file list', () => {
    // The counterweight. A glob that matched nothing would pass the test above
    // for ever, and it is the kind of thing a path separator quietly breaks.
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.some((path) => path.replace(/\\/g, '/') === 'src/main.tsx')).toBe(true);
  });

  it('publishes the privacy policy the listing has to link to', () => {
    // Required by Play for every app, including one that collects nothing. In
    // `public/` so the existing Pages workflow serves it next to the demo.
    const policy = read('public/privacy.html');
    expect(policy).toContain('Privacy Policy');
    // The two claims a reviewer can check against the app in one sitting.
    expect(policy).toMatch(/collects nothing/i);
    expect(policy).toMatch(/VIBRATE/);
  });
});
