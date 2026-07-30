/**
 * End-of-run summary.
 *
 * Reads the run numbers from the game store (exactly what the HUD is still
 * showing behind it) and the records from the meta store, which `endRun` has
 * already updated. Stays a card rather than a full screen: it is a result, not
 * a destination.
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

/**
 * Seconds the card waits before it fades in, and before its numbers start
 * counting.
 *
 * The crash flash sits at `z-index: 50` and this card at 30, and they are
 * siblings with no stacking context between them - so the cool-white wash
 * decays *over* the card, not behind it. That is kept deliberately: it makes
 * the wash a wipe the result arrives through. Which only works if the card is
 * not already sitting there underneath it, hence the hold.
 *
 * At `flashHalfLife` 0.07 s from a 0.55 punch down to the 0.002 epsilon, the
 * flash is gone in about 0.57 s; this catches its tail rather than waiting the
 * whole thing out, because a result screen that takes over half a second to
 * appear reads as the game having hung.
 *
 * **Must agree with `.panel-card-enter`'s `animation-delay` in `index.css`.**
 */
const CARD_DELAY_SECONDS = 0.32;

export function GameOver({ onNavigate, onHome }: GameOverProps) {
  const score = useGameStore((state) => state.score);
  const coins = useGameStore((state) => state.coins);
  const distance = useGameStore((state) => state.distance);
  const deathCause = useGameStore((state) => state.deathCause);
  const mode = useGameStore((state) => state.mode);
  const leaderboard = useMetaStore((state) => state.save.leaderboard);
  // Both come from `commitRun`, which `endRun` has already called. `bestCombo`
  // is on the run's stats and appeared on no screen in the app until now; the
  // completions can only be known there, because the diff has to be taken
  // against the mission progress that existed a moment before.
  const bestCombo = useMetaStore((state) => state.lastRun.bestCombo);
  const completedMissions = useMetaStore((state) => state.lastRun.completedMissions);
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
      <div className="panel-card panel-card-enter">
        <h2 className="panel-title">{title}</h2>
        {subtitle && <p className="panel-subtitle">{subtitle}</p>}
        {isNewBest && <p className="panel-best">New best!</p>}

        <dl className="panel-stats">
          <div>
            <dt>Score</dt>
            <dd>
              <CountUp value={score} delay={CARD_DELAY_SECONDS} />
            </dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>
              <CountUp value={Math.floor(distance)} delay={CARD_DELAY_SECONDS} suffix=" m" />
            </dd>
          </div>
          <div>
            <dt>Coins</dt>
            <dd>
              <CountUp value={coins} delay={CARD_DELAY_SECONDS} />
            </dd>
          </div>
          <div>
            <dt>Best combo</dt>
            <dd>
              <CountUp value={bestCombo} delay={CARD_DELAY_SECONDS} />
            </dd>
          </div>
        </dl>

        {/* Missions this run finished. `commitRun` banks the progress the
            instant a run ends and the card said nothing about it, so the one
            reason to start another run was announced only on a screen the
            player had to go looking for. Claiming stays on the Missions
            screen - this is news, not a transaction. */}
        {completedMissions.length > 0 && (
          <div className="panel-missions">
            <h3 className="panel-missions-title">
              {completedMissions.length === 1 ? 'Mission complete' : 'Missions complete'}
            </h3>
            <ul>
              {completedMissions.map((mission) => (
                <li key={mission.id}>
                  <span>{mission.description}</span>
                  <span className="panel-mission-reward">
                    <span className="shop-coin" aria-hidden="true" />
                    {mission.reward}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
