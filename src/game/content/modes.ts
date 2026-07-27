/**
 * Game modes.
 *
 * Each mode is a set of rules applied on top of the same simulation - there is
 * no separate game loop per mode. A mode can change where the difficulty curve
 * starts, cap the run with a timer, make a trip immediately fatal, and fix the
 * seed so everyone rides the same track.
 *
 * Scores are ranked per mode, because a Time Attack score and an Endless score
 * are not comparable and putting them in one table would make the harder modes
 * look worthless.
 */

import { seedForDate } from '@/game/systems/dailyCycle';

export type GameModeId = 'endless' | 'timeAttack' | 'blizzard' | 'daily';

export interface GameModeDef {
  id: GameModeId;
  name: string;
  /** One line, shown on the mode picker. */
  description: string;
  /** Seconds before the run ends on its own, or null to run until you crash. */
  timeLimit: number | null;
  /**
   * Seconds into the difficulty curve the run starts at. Higher means the run
   * opens at a speed an Endless run would take minutes to reach.
   */
  startElapsed: number;
  /** Whether a single trip ends the run rather than costing speed and combo. */
  lethalStumbles: boolean;
  /** Whether the track is seeded from the date, so everyone gets the same one. */
  seededByDate: boolean;
  /** Score multiplier, so a harder mode is worth playing. */
  scoreMultiplier: number;
}

export const GAME_MODES = {
  endless: {
    id: 'endless',
    name: 'Endless',
    description: 'Ride until you crash. The slope keeps getting faster.',
    timeLimit: null,
    startElapsed: 0,
    lethalStumbles: false,
    seededByDate: false,
    scoreMultiplier: 1,
  },
  timeAttack: {
    id: 'timeAttack',
    name: 'Time Attack',
    description: '90 seconds. Score as much as you can, starting at pace.',
    timeLimit: 90,
    startElapsed: 45,
    lethalStumbles: false,
    seededByDate: false,
    scoreMultiplier: 1.25,
  },
  blizzard: {
    id: 'blizzard',
    name: 'Blizzard',
    description: 'Top speed from the gate, and one slip ends it.',
    timeLimit: null,
    // Straight to the top of the speed curve.
    startElapsed: 200,
    lethalStumbles: true,
    seededByDate: false,
    scoreMultiplier: 1.8,
  },
  daily: {
    id: 'daily',
    name: 'Daily Challenge',
    description: 'The same track for everyone today. One slope, your best run.',
    timeLimit: null,
    startElapsed: 0,
    lethalStumbles: false,
    seededByDate: true,
    scoreMultiplier: 1.15,
  },
} as const satisfies Record<GameModeId, GameModeDef>;

export const GAME_MODE_IDS = Object.keys(GAME_MODES) as GameModeId[];

export const DEFAULT_MODE: GameModeId = 'endless';

export function gameModeDef(id: string): GameModeDef {
  return (GAME_MODES as Record<string, GameModeDef>)[id] ?? GAME_MODES[DEFAULT_MODE];
}

/**
 * The seed a run in this mode should use.
 *
 * Date-seeded modes derive it from the local day, so the track is identical for
 * every run that day and a player can genuinely retry the same slope.
 */
export function seedForMode(mode: GameModeDef, today: string, randomSeed: () => number): number {
  return mode.seededByDate ? seedForDate(`${mode.id}:${today}`) : randomSeed();
}
