/**
 * Pause menu.
 *
 * The run is genuinely frozen behind this - the simulation tick returns early
 * while paused, so nothing can advance or kill the player while they are
 * reading a menu.
 *
 * Quitting abandons the run rather than banking it, which is stated on the
 * button so nobody loses a good score to a mis-tap.
 */

import { Icon } from '@/app/Icon';
import { NavIcons } from '@/app/icons';
import { TapButton } from '@/app/TapButton';
import { gameModeDef } from '@/game/content/modes';
import { useGameStore } from '@/game/state/gameStore';
import { quitRun, resumeRun, startRun } from '@/game/state/runController';

export interface PausedProps {
  onHome: () => void;
}

export function Paused({ onHome }: PausedProps) {
  const score = useGameStore((state) => state.score);
  const distance = useGameStore((state) => state.distance);
  const mode = useGameStore((state) => state.mode);

  return (
    <div className="layer layer-safe panel">
      <div className="panel-card">
        <h2 className="panel-title">Paused</h2>
        <p className="panel-subtitle">{gameModeDef(mode).name}</p>

        <dl className="panel-stats">
          <div>
            <dt>Score</dt>
            <dd>{score.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{Math.floor(distance)} m</dd>
          </div>
        </dl>

        <TapButton className="panel-button" onTap={resumeRun}>
          Resume
        </TapButton>

        <div className="panel-actions">
          <TapButton
            className="panel-button panel-button-secondary"
            onTap={() => startRun(mode)}
          >
            <Icon icon={NavIcons.restart} size={20} />
            Restart
          </TapButton>
          <TapButton
            className="panel-button panel-button-secondary"
            onTap={() => {
              quitRun();
              onHome();
            }}
          >
            <Icon icon={NavIcons.home} size={20} />
            Quit
          </TapButton>
        </div>
        <p className="panel-note">Quitting does not save this run.</p>
      </div>
    </div>
  );
}
