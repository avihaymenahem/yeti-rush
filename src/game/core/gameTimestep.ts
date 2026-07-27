/**
 * The single fixed-timestep instance driving the run.
 *
 * A module singleton because two separate places need it: the game loop that
 * advances it every frame, and the lifecycle bridge that resets it when the
 * app returns from the background so the sim does not lurch forward.
 */

import { createFixedTimestep } from '@/game/core/loop';

export const gameTimestep = createFixedTimestep();
