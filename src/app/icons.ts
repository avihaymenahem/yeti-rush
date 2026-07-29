/**
 * The icon set.
 *
 * One place that decides what every symbol in the game looks like. Emoji were
 * doing this job, and they render as a different picture on every platform -
 * the same button was a flat glyph on one phone and a glossy 3D sticker on
 * another, next to type that matched neither. A line set draws in the current
 * text colour at the current size, so an icon always belongs to the control it
 * sits in.
 *
 * Imported icon by icon rather than as a namespace: `lucide-react` ships six
 * thousand components and only the handful named here should reach the bundle.
 */

import {
  CableCar,
  ChevronsUp,
  Home,
  Magnet,
  Pause,
  RotateCcw,
  Settings,
  Store,
  Sparkles,
  Target,
  Trophy,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { PowerUpId } from '@/game/content/powerUps';

/**
 * Power-up icons.
 *
 * Chosen for the *effect*, not the name. "Hot Cocoa" is flavour; what the
 * player needs to read in a fifth of a second is that coins are being pulled
 * in, so it is a magnet. Getting that backwards would make the HUD decorative.
 */
const POWER_UP_ICONS: Record<PowerUpId, LucideIcon> = {
  magnet: Magnet,
  avalanche: Zap,
  chairlift: CableCar,
  snowAngel: ChevronsUp,
  doubleScore: Sparkles,
};

export function powerUpIcon(id: PowerUpId): LucideIcon {
  return POWER_UP_ICONS[id];
}

export const NavIcons = {
  home: Home,
  scores: Trophy,
  // The shop sells boards, riders and upgrades, so it is named for the place
  // rather than for one of the three things in it - which is what "Boards" was,
  // and why nobody found the riders.
  shop: Store,
  daily: Target,
  settings: Settings,
  restart: RotateCcw,
  pause: Pause,
  close: X,
} as const;
