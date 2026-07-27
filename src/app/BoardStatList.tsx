/**
 * A board's handling profile.
 *
 * Shared by the home screen and the shop so a board reads the same in both.
 * Every stat is a multiplier around 1, and what the player needs to see is the
 * *difference* from neutral - so each row shows a signed percentage as well as
 * a bar, and a board that is neutral on a stat says so rather than drawing a
 * half-full bar the player has to interpret.
 */

import type { BoardStats } from '@/game/content/skins';

interface StatRow {
  key: keyof BoardStats;
  label: string;
  /** What this stat does, in the player's terms. */
  hint: string;
}

const ROWS: StatRow[] = [
  { key: 'speed', label: 'Speed', hint: 'Scores faster, less time to react' },
  { key: 'control', label: 'Control', hint: 'How sharply it changes lane' },
  { key: 'grip', label: 'Grip', hint: 'How fast the patrol drops back' },
  { key: 'fortune', label: 'Fortune', hint: 'What coins are worth' },
];

/** Maps a multiplier onto a bar fill, with neutral sitting at the midpoint. */
function fillFor(value: number): number {
  const span = 0.6; // 0.7x to 1.6x maps across the bar
  return Math.max(0.04, Math.min(1, 0.5 + (value - 1) / span));
}

function deltaLabel(value: number): string {
  const percent = Math.round((value - 1) * 100);
  if (percent === 0) return '—';
  return percent > 0 ? `+${percent}%` : `${percent}%`;
}

export interface BoardStatListProps {
  stats: BoardStats;
  /** Compact drops the hints, for the denser shop rows. */
  compact?: boolean;
}

export function BoardStatList({ stats, compact = false }: BoardStatListProps) {
  return (
    <ul className={compact ? 'stat-list stat-list-compact' : 'stat-list'}>
      {ROWS.map((row) => {
        const value = stats[row.key];
        const percent = Math.round((value - 1) * 100);
        const tone = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';

        return (
          <li key={row.key} className="stat-row">
            <span className="stat-label">{row.label}</span>
            <span className="stat-bar">
              <span className={`stat-bar-fill stat-${tone}`} style={{ width: `${fillFor(value) * 100}%` }} />
              {/* Neutral marker, so a bar can be read as better or worse at a glance. */}
              <span className="stat-bar-neutral" />
            </span>
            <span className={`stat-delta stat-${tone}`}>{deltaLabel(value)}</span>
            {!compact && <span className="stat-hint">{row.hint}</span>}
          </li>
        );
      })}
    </ul>
  );
}
