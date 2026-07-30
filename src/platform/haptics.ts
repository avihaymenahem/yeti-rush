/**
 * Haptic feedback.
 *
 * Fire-and-forget: haptics are garnish, so every call swallows its errors and
 * never blocks a frame. On web the Capacitor plugin falls back to
 * `navigator.vibrate` where the browser supports it, and silently does nothing
 * where it does not.
 */

import { Haptics, ImpactStyle } from '@capacitor/haptics';

let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function impact(style: ImpactStyle): void {
  if (!enabled) return;
  void Haptics.impact({ style }).catch(() => {
    // No haptics engine on this device. Nothing to do.
  });
}

/** Lane change, landing, a coin - the frequent cues, so it has to stay subtle. */
export function hapticLight(): void {
  impact(ImpactStyle.Light);
}

/** Power-up pickup, mission complete. */
export function hapticMedium(): void {
  impact(ImpactStyle.Medium);
}

/** Crash. */
export function hapticHeavy(): void {
  impact(ImpactStyle.Heavy);
}

/**
 * Seconds of buzz for a stumble.
 *
 * Well short of the 0.7 s the recovery itself lasts. A vibration held that long
 * stops reading as the board slipping and starts reading as an alarm - and it
 * would still be running when the player has already recovered.
 */
const BUZZ_MS = 120;

/**
 * A sustained buzz rather than a tap. Used for the stumble.
 *
 * The three impact styles are all *transients*: they model something striking
 * the phone, which is exactly what a crash, a landing and a pickup are. A trip
 * is not an impact - it is a loss of grip lasting most of a second - and firing
 * an impact at it would make it the same event as a landing at a different
 * amplitude, which is the same mistake as reusing the crash flash for it. A
 * duration is the only thing the hardware has that is a different *shape*.
 *
 * Android drives this off the same vibrator the impacts use, so it needs no
 * permission beyond the VIBRATE the manifest already declares - and
 * `tests/release.test.ts` would fail loudly if that ever changed.
 */
export function hapticBuzz(): void {
  if (!enabled) return;
  void Haptics.vibrate({ duration: BUZZ_MS }).catch(() => {
    // No vibrator, or a browser that will not vibrate without a gesture.
  });
}
