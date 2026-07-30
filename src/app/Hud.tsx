/**
 * In-run heads-up display.
 *
 * Each value subscribes to its own store slice, so a coin pickup re-renders
 * the coin counter and nothing else. The store is only written at ~10 Hz.
 *
 * It stays mounted past the end of the run - see `settled`. Every number here
 * is what the player watched for two minutes, and having the lot vanish in one
 * frame at the moment of maximum drama throws away the only context the results
 * card and the revive offer have to sit against.
 */

import { Icon } from '@/app/Icon';
import { NavIcons, powerUpIcon } from '@/app/icons';
import { TapButton } from '@/app/TapButton';
import { TUNING } from '@/game/config/tuning';
import { powerUpDef } from '@/game/content/powerUps';
import { clamp01 } from '@/game/core/math';
import { useGameStore } from '@/game/state/gameStore';
import { pauseRun } from '@/game/state/runController';
import { COMBO_PER_STEP, MAX_MULTIPLIER } from '@/game/systems/simulation';

function PowerUpBar() {
  const powerUps = useGameStore((state) => state.powerUps);
  if (powerUps.length === 0) return null;

  return (
    <div className="hud-powerups">
      {powerUps.map((powerUp) => {
        const def = powerUpDef(powerUp.id);
        const fraction = Math.max(0, Math.min(1, powerUp.remaining / powerUp.duration));
        return (
          <div key={powerUp.id} className="hud-powerup" style={{ borderColor: def.color }}>
            <span className="hud-powerup-icon" style={{ color: def.color }}>
              <Icon icon={powerUpIcon(powerUp.id)} size={17} />
            </span>
            <span className="hud-powerup-label">{def.label}</span>
            <span
              className="hud-powerup-drain"
              style={{ background: def.color, transform: `scaleX(${fraction})` }}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Seconds the avalanche announcement stays up.
 *
 * Derived from the drain rather than timed. A `setTimeout` here would be a
 * second clock racing the simulation's, and it would have to be cancelled by
 * every way a run can end mid-avalanche; asking whether the bar is still nearly
 * full answers the same question with no state at all.
 */
const AVALANCHE_ANNOUNCE_SECONDS = 2;

/**
 * The avalanche warning.
 *
 * A drain bar across the top edge and one announcement, rather than the pulsing
 * red pill this used to be. The number nobody had stated: at a 900 m interval
 * and fifteen seconds a piece, an avalanche is live for roughly 40% of the
 * early run and 65% of the late one - so a permanently pulsing rectangle is not
 * an alert, it is the dominant visual state of the late game, and it drowns out
 * everything that is genuinely an event.
 *
 * It deliberately owns the *top* edge only. The side strips belong to the speed
 * and impact tint, and near misses cluster hardest during an avalanche - taking
 * the sides here would make them invisible at exactly the moment they matter.
 *
 * Loud for its two seconds, though. It is the only time in a run when a trip
 * that is normally survivable ends it, and a rule change the player cannot see
 * is just an unfair death.
 */
function AvalancheBanner() {
  const remaining = useGameStore((state) => state.avalanche);
  if (remaining <= 0) return null;

  const { duration } = TUNING.avalanche;
  const fraction = clamp01(remaining / duration);
  const announcing = remaining > duration - AVALANCHE_ANNOUNCE_SECONDS;

  return (
    <>
      {/* The snapshot only re-publishes when the whole second changes, so the
          transform lands once a second. The transition is what turns that into
          a glide rather than fourteen visible steps. */}
      <div className="hud-avalanche" aria-hidden="true">
        <span className="hud-avalanche-drain" style={{ transform: `scaleX(${fraction})` }} />
      </div>
      {announcing && (
        <div className="hud-avalanche-call" role="status">
          Avalanche · don&apos;t fall
        </div>
      )}
    </>
  );
}

/**
 * The combo, as the thing it actually is: a multiplier on the score.
 *
 * Directly under the score and the same width, because that is the entire
 * point - `runtime.combo`, `bestCombo` and `multiplier` have all been simulated
 * since the beginning and the whole visual expression of them was a detached
 * pill in the corner reading `x2`. One instrument: the bar is how close the
 * next step is, the label is what the score is being multiplied by right now.
 *
 * The escalation matters more than the bar, so the tint steps with the combo
 * multiplier rather than sliding - a colour that has visibly *changed* is read
 * in peripheral vision, and a bar that is 70% full is not.
 */
function ComboMeter() {
  const combo = useGameStore((state) => state.combo);
  const multiplier = useGameStore((state) => state.multiplier);
  // A power-up can multiply the score with no combo at all, and that is worth
  // showing; a combo of zero with no power-up is not an instrument, it is a
  // permanently empty bar under the score.
  if (combo <= 0 && multiplier <= 1) return null;

  // The combo's own contribution, which is what the bar is filling towards.
  // `multiplier` also carries any power-up term and can exceed the ceiling.
  const step = Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / COMBO_PER_STEP));
  const fraction = step >= MAX_MULTIPLIER ? 1 : (combo % COMBO_PER_STEP) / COMBO_PER_STEP;

  return (
    <span className="hud-combo" data-step={step}>
      <span className="hud-combo-track" aria-hidden="true">
        <span className="hud-combo-fill" style={{ transform: `scaleX(${fraction})` }} />
      </span>
      <span className="hud-combo-label">x{multiplier}</span>
    </span>
  );
}

/**
 * What the flight is worth, while it is still in the air.
 *
 * Centred and large, because it is read in peripheral vision - the player is
 * looking at where they are going to land, not at the corner of the screen, and
 * the whole decision it supports ("one more?") happens in under a second.
 */
function TrickTally() {
  const pending = useGameStore((state) => state.trickPending);
  const chain = useGameStore((state) => state.trickChain);
  if (pending <= 0) return null;

  return (
    <div className="hud-tricks" role="status">
      <span className="hud-tricks-score">+{pending.toLocaleString()}</span>
      <span className="hud-tricks-chain">{chain}x</span>
    </div>
  );
}

/** What each prompt says. Short enough to read at thirty metres a second. */
const COACH_COPY = {
  move: { title: 'Swipe left or right', detail: 'Change lanes' },
  jump: { title: 'Swipe up', detail: 'Jump it' },
  slide: { title: 'Swipe down', detail: 'Slide under' },
} as const;

/**
 * The opening coach.
 *
 * Sits low, under the lane the player is reading, so it never covers the thing
 * it is telling them to deal with. It disappears the moment the input is used
 * rather than after a timer - the fastest possible acknowledgement that they
 * got it, and the reason it never has to be dismissed.
 */
function Coach() {
  const hint = useGameStore((state) => state.coach);
  if (!hint) return null;

  const copy = COACH_COPY[hint];
  return (
    <div className="hud-coach" role="status">
      <span className="hud-coach-title">{copy.title}</span>
      <span className="hud-coach-detail">{copy.detail}</span>
    </div>
  );
}

export interface HudProps {
  /**
   * The run has stopped - the results card or the revive offer is up.
   *
   * Everything that is a *state* stays: score, coins, distance, the multiplier
   * the run finished on. Everything that is an *instruction to act right now*
   * goes: the pause button (there is nothing to pause, and it would sit under a
   * panel taking taps), the coach, the trick tally and the avalanche clock.
   *
   * The last three cannot be left to their own emptiness checks. `endRun`
   * publishes a snapshot with the transients zeroed, but the revive offer is
   * reached without publishing anything at all - so a player killed mid-flight
   * during an avalanche would sit there watching a drain bar for a run that has
   * already ended.
   */
  settled?: boolean;
}

export function Hud({ settled = false }: HudProps) {
  const score = useGameStore((state) => state.score);
  const coins = useGameStore((state) => state.coins);
  const distance = useGameStore((state) => state.distance);
  const timeRemaining = useGameStore((state) => state.timeRemaining);

  return (
    <div
      className={
        settled
          ? 'layer layer-safe layer-passthrough hud hud-settled'
          : 'layer layer-safe layer-passthrough hud'
      }
    >
      <div className="hud-row">
        {/* No `key` and no pop animation on the score. `updateScore` floors a
            continuously growing distance term at a point per unit, so the score
            advances by roughly two on every 100 ms publish and the store's
            equality guard can never short-circuit it. A 140 ms animation
            restarting every 100 ms has never once landed - on the largest
            element on the screen. Coins are a real event and keep theirs. */}
        <span className="hud-score-block">
          <span className="hud-score">{score.toLocaleString()}</span>
          <ComboMeter />
        </span>
        <span className="hud-right">
          <span key={coins} className="hud-coins hud-pop">
            {coins}
          </span>
          {/* Top-right, away from the thumb that is busy swiping. */}
          {!settled && (
            <TapButton className="hud-pause" aria-label="Pause" onTap={pauseRun}>
              <Icon icon={NavIcons.pause} size={16} />
            </TapButton>
          )}
        </span>
      </div>
      <div className="hud-distance">{Math.floor(distance)} m</div>
      {!settled && (
        <>
          <AvalancheBanner />
          <TrickTally />
          <Coach />
        </>
      )}

      {timeRemaining !== null && (
        // Turns urgent inside the last ten seconds, which is the only moment
        // the exact number matters.
        <div className={timeRemaining <= 10 && !settled ? 'hud-clock hud-clock-low' : 'hud-clock'}>
          {Math.ceil(timeRemaining)}s
        </div>
      )}
      <PowerUpBar />
    </div>
  );
}
