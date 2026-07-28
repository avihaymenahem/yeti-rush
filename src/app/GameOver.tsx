/**
 * End-of-run summary.
 *
 * Reads the run numbers from the game store (exactly what the HUD last showed)
 * and the records from the meta store, which `endRun` has already updated.
 * Stays a card rather than a full screen: it is a result, not a destination.
 */

import { CountUp } from '@/app/CountUp';
import { Icon } from '@/app/Icon';
import { NavIcons } from '@/app/icons';
import type { Screen } from '@/app/screens';
import { TapButton } from '@/app/TapButton';
import { gameModeDef } from '@/game/content/modes';
import { useGameStore } from '@/game/state/gameStore';
import { useMetaStore } from '@/game/state/metaStore';
import { returnToMenu, startRun } from '@/game/state/runController';
import { bestScoreFor } from '@/game/state/saveSchema';

export interface GameOverProps {
  onNavigate: (screen: Screen) => void;
  onHome: () => void;
}

export function GameOver({ onNavigate, onHome }: GameOverProps) {
  const score = useGameStore((state) => state.score);
  const coins = useGameStore((state) => state.coins);
  const distance = useGameStore((state) => state.distance);
  const deathCause = useGameStore((state) => state.deathCause);
  const mode = useGameStore((state) => state.mode);
  const leaderboard = useMetaStore((state) => state.save.leaderboard);
  // Compared within the mode, since scores across modes are not comparable.
  const modeBest = bestScoreFor(leaderboard, mode);

  const title =
    deathCause === 'timeUp' ? "Time's up" : deathCause === 'caught' ? 'Caught!' : 'Wiped out';
  const subtitle =
    deathCause === 'timeUp'
      ? `${gameModeDef(mode).name} run complete.`
      : deathCause === 'caught'
        ? 'The ski patrol got you. Keep a clean run between slips.'
        : null;
  // `endRun` has already banked the score, so equality means this run set it.
  const isNewBest = score > 0 && modeBest !== null && score >= modeBest;

  return (
    <div className="layer layer-safe panel">
      <div className="panel-card">
        <h2 className="panel-title">{title}</h2>
        {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        {isNewBest && <p className="panel-best">New best!</p>}

        <dl className="panel-stats">
          <div>
            <dt>Score</dt>
            <dd>
              <CountUp value={score} />
            </dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>
              <CountUp value={Math.floor(distance)} suffix=" m" />
            </dd>
          </div>
          <div>
            <dt>Coins</dt>
            <dd>
              <CountUp value={coins} />
            </dd>
          </div>
        </dl>

        <TapButton className="panel-button" onTap={() => startRun(mode)}>
          Run again
        </TapButton>

        <div className="panel-actions">
          <TapButton
            className="panel-button panel-button-secondary"
            onTap={() => {
              // Leaving the result behind is what returns the shell to home.
              returnToMenu();
              onHome();
            }}
          >
            <Icon icon={NavIcons.home} size={20} />
            Home
          </TapButton>
          <TapButton
            className="panel-button panel-button-secondary"
            onTap={() => onNavigate('scores')}
          >
            <Icon icon={NavIcons.scores} size={20} />
            Scores
          </TapButton>
        </div>
      </div>
    </div>
  );
}
