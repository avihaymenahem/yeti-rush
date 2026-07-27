/**
 * The home screen.
 *
 * A full screen rather than a card floating over the game, because this is
 * where a session starts and where the player comes back to between runs - it
 * should feel like the front of the game, not an interruption to it. The live
 * scene keeps running behind, dimmed by a scrim so the type stays readable
 * whatever is on screen.
 */

import { useState } from 'react';
import { BoardPreview } from '@/app/BoardPreview';
import { Icon } from '@/app/Icon';
import { NavIcons } from '@/app/icons';
import type { Screen } from '@/app/screens';
import { TapButton } from '@/app/TapButton';
import {
  DEFAULT_MODE,
  GAME_MODE_IDS,
  gameModeDef,
  type GameModeId,
} from '@/game/content/modes';
import { skinDef } from '@/game/content/skins';
import { useMetaStore } from '@/game/state/metaStore';
import { startRun } from '@/game/state/runController';
import { canClaimDaily, localDateKey } from '@/game/systems/dailyCycle';

export interface HomeProps {
  onNavigate: (screen: Screen) => void;
}

export function Home({ onNavigate }: HomeProps) {
  const save = useMetaStore((state) => state.save);
  const board = skinDef(save.equippedSkin);
  const dailyAvailable = canClaimDaily(save.lastDailyClaim, localDateKey(new Date()));

  // The chosen mode lives here rather than in a store: it is a menu choice, and
  // the run itself snapshots the rules the moment it starts.
  //
  // The mode's blurb and the equipped board's stat bars used to sit here too.
  // Both are reference material rather than anything you act on from the front
  // screen, and together they crowded out the two things that are: the mode you
  // are picking and the Play button. The stats are still a tap away in the
  // shop, where you are actually choosing between boards, and per-mode bests
  // are on the scores screen.
  const [mode, setMode] = useState<GameModeId>(DEFAULT_MODE);

  return (
    <div className="layer layer-safe home">
      <header className="home-top">
        <span className="home-coins">{save.coins.toLocaleString()}</span>
        <TapButton
          className="icon-button"
          aria-label="Settings"
          onTap={() => onNavigate('settings')}
        >
          <Icon icon={NavIcons.settings} size={19} />
        </TapButton>
      </header>

      <div className="home-title-block">
        <h1 className="home-title">Yeti Rush</h1>
        <p className="home-tagline">Alpine endless run</p>
      </div>

      <dl className="home-records">
        <div>
          <dt>Best</dt>
          <dd>{save.highScore.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Furthest</dt>
          <dd>{Math.floor(save.bestDistance).toLocaleString()} m</dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>{save.totalRuns.toLocaleString()}</dd>
        </div>
      </dl>

      <div className="home-actions">
        {/* Mode picker. Chips rather than a dropdown: four options that all
            need explaining are better shown than hidden behind a control. */}
        <div className="mode-picker" role="radiogroup" aria-label="Game mode">
          {GAME_MODE_IDS.map((id) => {
            const def = gameModeDef(id);
            return (
              <TapButton
                key={id}
                role="radio"
                aria-checked={id === mode}
                className={id === mode ? 'mode-chip mode-chip-on' : 'mode-chip'}
                onTap={() => setMode(id)}
              >
                {def.name}
              </TapButton>
            );
          })}
        </div>

        <TapButton className="play-button" onTap={() => startRun(mode)}>
          Play
        </TapButton>

        <nav className="home-nav">
          <TapButton className="nav-button" onTap={() => onNavigate('shop')}>
            <Icon icon={NavIcons.boards} size={21} />
            Boards
          </TapButton>
          <TapButton className="nav-button" onTap={() => onNavigate('missions')}>
            <Icon icon={NavIcons.daily} size={21} />
            Daily
            {dailyAvailable && <span className="nav-badge" aria-label="reward available" />}
          </TapButton>
          <TapButton className="nav-button" onTap={() => onNavigate('scores')}>
            <Icon icon={NavIcons.scores} size={21} />
            Scores
          </TapButton>
        </nav>
      </div>

      <TapButton
        className="home-board"
        onTap={() => onNavigate('shop')}
        aria-label={`Equipped board: ${board.name}. Open boards.`}
      >
        <BoardPreview skin={board} size={44} />
        <span className="home-board-text">
          <span className="home-board-name">{board.name}</span>
          <span className="home-board-tagline">{board.tagline}</span>
        </span>
      </TapButton>
    </div>
  );
}
