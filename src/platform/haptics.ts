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

/** Lane change - the most frequent cue, so it has to stay subtle. */
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
