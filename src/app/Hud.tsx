/**
 * In-run heads-up display.
 *
 * Each value subscribes to its own store slice, so a coin pickup re-renders
 * the coin counter and nothing else. The store is only written at ~10 Hz.
 */

import { Icon } from '@/app/Icon';
import { NavIcons, powerUpIcon } from '@/app/icons';
import { TapButton } from '@/app/TapButton';
import { powerUpDef } from '@/game/content/powerUps';
import { useGameStore } from '@/game/state/gameStore';
import { pauseRun } from '@/game/state/runController';

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
 * The avalanche warning.
 *
 * Loud on purpose. It is the only time in a run when a trip that is normally
 * survivable ends it, and a rule change the player cannot see is just an unfair
 * death - the snowmobile filling the mirror behind them says the same thing,
 * but only if they happen to look.
 */
function AvalancheBanner() {
  const avalanche = useGameStore((state) => state.avalanche);
  if (avalanche <= 0) return null;

  return (
    <div className="hud-avalanche" role="status">
      <span className="hud-avalanche-label">Avalanche · don't fall</span>
      <span className="hud-avalanche-seconds">{Math.ceil(avalanche)}</span>
    </div>
  );
}

export function Hud() {
  const score = useGameStore((state) => state.score);
  const coins = useGameStore((state) => state.coins);
  const distance = useGameStore((state) => state.distance);
  const multiplier = useGameStore((state) => state.multiplier);
  const timeRemaining = useGameStore((state) => state.timeRemaining);

  return (
    <div className="layer layer-safe layer-passthrough hud">
      <div className="hud-row">
        {/* `key` on the value is what restarts the CSS pop. React reuses the
            element otherwise, and an animation that is already finished does
            not replay just because its text changed. */}
        <span key={score} className="hud-score hud-pop">
          {score.toLocaleString()}
        </span>
        <span className="hud-right">
          <span key={coins} className="hud-coins hud-pop">
            {coins}
          </span>
          {/* Top-right, away from the thumb that is busy swiping. */}
          <TapButton className="hud-pause" aria-label="Pause" onTap={pauseRun}>
            <Icon icon={NavIcons.pause} size={16} />
          </TapButton>
        </span>
      </div>
      <div className="hud-distance">{Math.floor(distance)} m</div>
      <AvalancheBanner />

      {timeRemaining !== null && (
        // Turns urgent inside the last ten seconds, which is the only moment
        // the exact number matters.
        <div className={timeRemaining <= 10 ? 'hud-clock hud-clock-low' : 'hud-clock'}>
          {Math.ceil(timeRemaining)}s
        </div>
      )}
      {multiplier > 1 && <div className="hud-multiplier">x{multiplier}</div>}
      <PowerUpBar />
    </div>
  );
}
