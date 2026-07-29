/**
 * Daily missions and the login reward.
 *
 * Missions are regenerated from today's date rather than stored, so this screen
 * shows the same three objectives all day and a fresh set at local midnight.
 */

import { Page } from '@/app/Page';
import { TapButton } from '@/app/TapButton';
import { isComplete, progressFraction } from '@/game/content/missions';
import { useMetaStore } from '@/game/state/metaStore';
import { canClaimDaily, dailyRewardFor, localDateKey, nextStreak } from '@/game/systems/dailyCycle';

export interface MissionsProps {
  onClose: () => void;
}

export function Missions({ onClose }: MissionsProps) {
  const save = useMetaStore((state) => state.save);
  const missions = useMetaStore((state) => state.missions);
  const claimMission = useMetaStore((state) => state.claimMission);
  const claimDaily = useMetaStore((state) => state.claimDaily);

  const today = localDateKey(new Date());
  const dailyAvailable = canClaimDaily(save.lastDailyClaim, today);
  const pendingStreak = nextStreak(save.lastDailyClaim, today, save.dailyStreak);

  return (
    <Page
      title="Daily"
      onClose={onClose}
      aside={<span className="panel-wallet">{save.coins.toLocaleString()} coins</span>}
    >
      <div className="daily-reward">
        <div>
          <div className="daily-streak">
            Day {dailyAvailable ? pendingStreak : save.dailyStreak}
          </div>
          <div className="daily-hint">
            {dailyAvailable ? `Claim ${dailyRewardFor(pendingStreak)} coins` : 'Come back tomorrow'}
          </div>
        </div>
        <TapButton className="shop-button" disabled={!dailyAvailable} onTap={() => claimDaily()}>
          {dailyAvailable ? 'Claim' : 'Claimed'}
        </TapButton>
      </div>

      <h3 className="panel-section">Today&apos;s missions</h3>
      <ul className="mission-list">
        {missions.map((mission) => {
          const progress = save.missions[mission.id] ?? 0;
          const done = isComplete(mission, progress);
          const claimed = save.missionsClaimed.includes(mission.id);
          const fraction = progressFraction(mission, progress);

          return (
            <li key={mission.id} className="mission-row">
              <div className="mission-text">
                <span className="mission-description">{mission.description}</span>
                <span className="mission-progress">
                  {Math.min(Math.floor(progress), mission.target).toLocaleString()} /{' '}
                  {mission.target.toLocaleString()}
                </span>
              </div>

              <div className="mission-bar">
                <span className="mission-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
              </div>

              {claimed ? (
                <span className="shop-tag">Claimed</span>
              ) : (
                <TapButton
                  className="shop-button"
                  disabled={!done}
                  onTap={() => claimMission(mission.id)}
                >
                  {mission.reward}
                </TapButton>
              )}
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
