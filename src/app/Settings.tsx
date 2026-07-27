/**
 * Settings.
 *
 * Writes straight through the meta store so preferences persist with the rest
 * of the save; `App` syncs them into the audio and haptics modules.
 *
 * Volumes are sliders rather than on/off buttons: "music is too loud" and
 * "music is off" are different problems, and a toggle only solves the second by
 * making the first worse. Zero on the slider is off, so there is no separate
 * mute to fall out of step with the level.
 */

import { TapButton } from '@/app/TapButton';
import { useMetaStore } from '@/game/state/metaStore';
import type { SaveData } from '@/game/state/saveSchema';

export interface SettingsProps {
  onClose: () => void;
}

type VolumeKey = 'sfxVolume' | 'musicVolume';

const VOLUMES: { key: VolumeKey; label: string; hint: string }[] = [
  { key: 'sfxVolume', label: 'Sound effects', hint: 'Carving, coins, crashes' },
  { key: 'musicVolume', label: 'Music', hint: 'Builds with your speed' },
];

function VolumeRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <li className="volume-row">
      <div className="volume-head">
        <span className="toggle-label">{label}</span>
        <span className="volume-value">{value === 0 ? 'Off' : `${value}%`}</span>
      </div>
      <span className="toggle-hint">{hint}</span>
      <input
        className="volume-slider"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        aria-label={label}
        // `input` rather than `change`, so the level follows the thumb while it
        // is being dragged instead of jumping when it is released.
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </li>
  );
}

export function Settings({ onClose }: SettingsProps) {
  const settings = useMetaStore((state) => state.save.settings);
  const setSetting = useMetaStore((state) => state.setSetting);
  const haptics = settings.hapticsEnabled;

  return (
    <div className="layer layer-safe panel panel-scroll">
      <div className="panel-card panel-card-wide">
        <header className="panel-header">
          <h2 className="panel-title">Settings</h2>
        </header>

        <ul className="toggle-list">
          {VOLUMES.map((row) => (
            <VolumeRow
              key={row.key}
              label={row.label}
              hint={row.hint}
              value={settings[row.key]}
              onChange={(next) => setSetting(row.key, next)}
            />
          ))}

          <li className="toggle-row">
            <span className="toggle-text">
              <span className="toggle-label">Vibration</span>
              <span className="toggle-hint">Lane changes and impacts</span>
            </span>
            <TapButton
              role="switch"
              aria-checked={haptics}
              aria-label="Vibration"
              className={haptics ? 'switch switch-on' : 'switch'}
              onTap={() => setSetting('hapticsEnabled', !haptics)}
            >
              <span className="switch-knob" />
            </TapButton>
          </li>
        </ul>

        <h3 className="panel-section">Controls</h3>
        <ul className="help-list">
          <li>
            <b>Swipe left / right</b> change lane
          </li>
          <li>
            <b>Swipe up</b> or tap to jump
          </li>
          <li>
            <b>Swipe down</b> to slide, or to dive back down in the air
          </li>
          <li>Swipes register as you move, so you can duck and steer in one go</li>
          <li>Hit a ramp to fly over a chalet and its coin line</li>
        </ul>

        <TapButton className="panel-button" onTap={onClose}>
          Back
        </TapButton>
      </div>
    </div>
  );
}

/** Kept alongside the component so the settings shape stays in one place. */
export type SettingsKey = keyof SaveData['settings'];
