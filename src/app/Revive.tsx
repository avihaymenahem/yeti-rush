/**
 * The second chance.
 *
 * Shown instead of the results card when a run ends and the player can afford
 * to keep going. The countdown is the whole design: an offer with no clock is a
 * menu, and a menu is where the tension of the run goes to die.
 *
 * The timer is React state on purpose. This is the one screen where the game
 * loop is *not* the thing being driven - the simulation is stopped, nothing is
 * being steered, and a re-render per second costs nothing anyone can measure.
 */

import { useEffect, useState } from 'react';
import { Icon } from '@/app/Icon';
import { NavIcons } from '@/app/icons';
import { TapButton } from '@/app/TapButton';
import { TUNING } from '@/game/config/tuning';
import { useGameStore } from '@/game/state/gameStore';
import { useMetaStore } from '@/game/state/metaStore';
import { endRun, revivePrice, reviveRun } from '@/game/state/runController';
import { runtime } from '@/game/state/runtime';

export function Revive() {
  const score = useGameStore((state) => state.score);
  const wallet = useMetaStore((state) => state.save.coins);
  const [remaining, setRemaining] = useState<number>(TUNING.revive.offerSeconds);

  const price = revivePrice();

  // A real timer against the wall clock, which is what an effect is for. It
  // ends the run itself rather than merely hiding: an offer that expires into
  // nothing would leave the player on a dead screen.
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      const left = TUNING.revive.offerSeconds - (Date.now() - started) / 1000;
      if (left <= 0) {
        window.clearInterval(id);
        setRemaining(0);
        endRun();
        return;
      }
      setRemaining(left);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const fraction = Math.max(0, Math.min(1, remaining / TUNING.revive.offerSeconds));

  return (
    <div className="layer layer-safe panel">
      <div className="panel-card">
        <h2 className="panel-title">Keep going?</h2>
        <p className="panel-subtitle">
          {score.toLocaleString()} points on the board. Get back on the slope for {price} coins.
        </p>

        {/* Draining rather than counting down in numerals: the bar is read
            without being looked at, which is the point when the player has
            about four seconds to decide. */}
        <div className="revive-clock" aria-hidden="true">
          <span className="revive-clock-fill" style={{ transform: `scaleX(${fraction})` }} />
        </div>

        <TapButton className="panel-button" onTap={() => reviveRun()}>
          Revive · {price}
        </TapButton>
        <p className="revive-wallet">
          {wallet.toLocaleString()} coins
          {runtime.revives > 0 && ` · revive ${runtime.revives + 1} of ${TUNING.revive.maxPerRun}`}
        </p>

        <TapButton className="panel-button panel-button-secondary" onTap={() => endRun()}>
          <Icon icon={NavIcons.home} size={18} />
          End run
        </TapButton>
      </div>
    </div>
  );
}
