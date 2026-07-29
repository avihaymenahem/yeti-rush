/**
 * Skins and power-up upgrades.
 *
 * Reads and writes only through the meta store, so every purchase rule -
 * affordability, ownership, level caps - lives in one tested place rather than
 * being re-implemented in the button handlers.
 */

import { BoardPreview } from '@/app/BoardPreview';
import { BoardStatList } from '@/app/BoardStatList';
import { TapButton } from '@/app/TapButton';
import { POWER_UP_IDS, powerUpDef, UPGRADE_MAX_LEVEL, upgradePrice } from '@/game/content/powerUps';
import { CHARACTER_IDS, characterDef } from '@/game/content/characters';
import { skinsForSale } from '@/game/content/skins';
import { useMetaStore } from '@/game/state/metaStore';

export interface ShopProps {
  onClose: () => void;
}

export function Shop({ onClose }: ShopProps) {
  const save = useMetaStore((state) => state.save);
  const buySkin = useMetaStore((state) => state.buySkin);
  const equipSkin = useMetaStore((state) => state.equipSkin);
  const buyUpgrade = useMetaStore((state) => state.buyUpgrade);
  const buyCharacter = useMetaStore((state) => state.buyCharacter);
  const equipCharacter = useMetaStore((state) => state.equipCharacter);

  return (
    <div className="layer layer-safe panel panel-scroll">
      <div className="panel-card panel-card-wide">
        <header className="panel-header">
          <h2 className="panel-title">Shop</h2>
          <span className="panel-wallet">{save.coins.toLocaleString()} coins</span>
        </header>

        <h3 className="panel-section">Boards</h3>
        <p className="panel-note">
          Every board handles differently. None is strictly best - pick the trade you want.
        </p>
        <ul className="shop-list">
          {skinsForSale().map((skin) => {
            const owned = save.ownedSkins.includes(skin.id);
            const equipped = save.equippedSkin === skin.id;
            const affordable = save.coins >= skin.price;

            return (
              <li key={skin.id} className="shop-row shop-row-board">
                <BoardPreview skin={skin} />
                <span className="shop-name">
                  {skin.name}
                  <span className="shop-tagline">{skin.tagline}</span>
                </span>

                {equipped ? (
                  <span className="shop-tag">Equipped</span>
                ) : owned ? (
                  <TapButton className="shop-button" onTap={() => equipSkin(skin.id)}>
                    Equip
                  </TapButton>
                ) : (
                  <TapButton
                    className="shop-button"
                    disabled={!affordable}
                    onTap={() => buySkin(skin.id)}
                  >
                    {skin.price.toLocaleString()}
                  </TapButton>
                )}

                <BoardStatList stats={skin.stats} compact />
              </li>
            );
          })}
        </ul>

        <h3 className="panel-section">Riders</h3>
        <p className="panel-note">
          Looks only. Who you ride as never changes how the board handles - that is
          what the boards above are for.
        </p>
        <ul className="shop-list">
          {CHARACTER_IDS.map((id) => {
            const character = characterDef(id);
            const owned = save.ownedCharacters.includes(id);
            const equipped = save.equippedCharacter === id;

            return (
              <li key={id} className="shop-row">
                {/* Three of the character's four colours, which is enough to
                    tell them apart in a list without rendering a second yeti. */}
                <span className="shop-rider" aria-hidden="true">
                  <span style={{ background: character.fur }} />
                  <span style={{ background: character.furShade }} />
                  <span style={{ background: character.accent }} />
                </span>
                <span className="shop-name">
                  {character.name}
                  <span className="shop-tagline">{character.tagline}</span>
                </span>

                {equipped ? (
                  <span className="shop-tag">Equipped</span>
                ) : owned ? (
                  <TapButton className="shop-button" onTap={() => equipCharacter(id)}>
                    Equip
                  </TapButton>
                ) : (
                  <TapButton
                    className="shop-button"
                    disabled={save.coins < character.price}
                    onTap={() => buyCharacter(id)}
                  >
                    {character.price.toLocaleString()}
                  </TapButton>
                )}
              </li>
            );
          })}
        </ul>

        <h3 className="panel-section">Power-up upgrades</h3>
        <ul className="shop-list">
          {POWER_UP_IDS.map((id) => {
            const def = powerUpDef(id);
            const level = save.upgrades[id] ?? 0;
            const maxed = level >= UPGRADE_MAX_LEVEL;
            const price = upgradePrice(level);

            return (
              <li key={id} className="shop-row">
                <span className="shop-swatch" style={{ background: def.color, borderColor: def.color }} />
                <span className="shop-name">
                  {def.label}
                  <span className="shop-level">
                    {' '}
                    Lv {level}/{UPGRADE_MAX_LEVEL}
                  </span>
                </span>

                {maxed ? (
                  <span className="shop-tag">Max</span>
                ) : (
                  <TapButton
                    className="shop-button"
                    disabled={save.coins < price}
                    onTap={() => buyUpgrade(id)}
                  >
                    {price.toLocaleString()}
                  </TapButton>
                )}
              </li>
            );
          })}
        </ul>

        <TapButton className="panel-button" onTap={onClose}>
          Back
        </TapButton>
      </div>
    </div>
  );
}
