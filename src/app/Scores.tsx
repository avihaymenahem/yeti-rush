/**
 * Local leaderboard, ranked per mode.
 *
 * The game has no backend, so this is the player's own best runs rather than a
 * global ranking - and the screen says so, because a "leaderboard" a player
 * assumes is global and later discovers is not feels like a broken promise.
 *
 * Modes are tabbed rather than pooled: a Time Attack score and an Endless score
 * are not comparable, and one table would make the timed modes look worthless.
 */

import { useState } from 'react';
import { TapButton } from '@/app/TapButton';
import { GAME_MODE_IDS, gameModeDef, DEFAULT_MODE, type GameModeId } from '@/game/content/modes';
import { skinDef } from '@/game/content/skins';
import { useMetaStore } from '@/game/state/metaStore';
import { leaderboardFor, LEADERBOARD_SIZE } from '@/game/state/saveSchema';

export interface ScoresProps {
  onClose: () => void;
}

export function Scores({ onClose }: ScoresProps) {
  const save = useMetaStore((state) => state.save);
  const [mode, setMode] = useState<GameModeId>(DEFAULT_MODE);
  const entries = leaderboardFor(save.leaderboard, mode);

  return (
    <div className="layer layer-safe panel panel-scroll">
      <div className="panel-card panel-card-wide">
        <header className="panel-header">
          <h2 className="panel-title">Best runs</h2>
          <span className="panel-wallet">{save.totalRuns.toLocaleString()} runs</span>
        </header>
        <p className="panel-note">Your top {LEADERBOARD_SIZE} per mode, on this device.</p>

        <div className="mode-picker mode-picker-light" role="tablist" aria-label="Mode">
          {GAME_MODE_IDS.map((id) => (
            <TapButton
              key={id}
              role="tab"
              aria-selected={id === mode}
              className={id === mode ? 'mode-chip mode-chip-on' : 'mode-chip'}
              onTap={() => setMode(id)}
            >
              {gameModeDef(id).name}
            </TapButton>
          ))}
        </div>

        {entries.length === 0 ? (
          <p className="panel-empty">No {gameModeDef(mode).name} runs yet.</p>
        ) : (
          <ol className="score-list">
            {entries.map((entry, index) => (
              <li key={`${entry.score}-${entry.date}-${index}`} className="score-row">
                <span className="score-rank">{index + 1}</span>
                <span className="score-main">
                  <span className="score-value">{entry.score.toLocaleString()}</span>
                  <span className="score-detail">
                    {Math.floor(entry.distance).toLocaleString()} m · {entry.coins} coins
                  </span>
                </span>
                <span className="score-side">
                  {/* Labelled, because an unqualified board name in a scores
                      table reads as a game mode. */}
                  <span className="score-board">Board: {skinDef(entry.skin).name}</span>
                  {entry.date && <span className="score-date">{entry.date}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}

        <TapButton className="panel-button" onTap={onClose}>
          Back
        </TapButton>
      </div>
    </div>
  );
}
