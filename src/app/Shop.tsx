/**
 * Boards, riders and power-up upgrades.
 *
 * Reads and writes only through the meta store, so every purchase rule -
 * affordability, ownership, level caps - lives in one tested place rather than
 * being re-implemented in the button handlers.
 *
 * Everything on sale is shown *as it will look*. A board is previewed with the
 * rider currently equipped, and a rider with the board currently equipped, so
 * the shop answers the question actually being asked - what the combination
 * looks like - rather than describing one half of it. Power-ups use the same
 * icons the HUD uses mid-run, for the same reason: a coloured square here and a
 * magnet there is two things to learn instead of one.
 *
 * Three tabs rather than one long page. Fourteen cards stacked was a page you
 * had to remember your way down, and on a phone the power-ups sat four screens
 * below the fold. The cost of tabs is that two thirds of the shop is now
 * hidden, so each tab carries a dot when it holds something unowned and
 * affordable - see `hasAffordable`. That is the discovery the scroll used to
 * give away for free, and it has to be paid back deliberately.
 */

import { useRef, useState } from 'react';
import { BoardStatList } from '@/app/BoardStatList';
import { Icon } from '@/app/Icon';
import { powerUpIcon } from '@/app/icons';
import { Page } from '@/app/Page';
import { RiderPreview } from '@/app/RiderPreview';
import { TapButton } from '@/app/TapButton';
import { CHARACTER_IDS, characterDef } from '@/game/content/characters';
import { POWER_UP_IDS, powerUpDef, UPGRADE_MAX_LEVEL, upgradePrice } from '@/game/content/powerUps';
import { hasAffordable, SHOP_TABS, type ShopTab } from '@/game/content/shopTabs';
import { skinDef, skinsForSale } from '@/game/content/skins';
import { useMetaStore } from '@/game/state/metaStore';

export interface ShopProps {
  onClose: () => void;
}

interface BuyButtonProps {
  owned: boolean;
  equipped: boolean;
  price: number;
  coins: number;
  onBuy: () => void;
  onEquip: () => void;
}

/**
 * The buy / equip / equipped control.
 *
 * One component, because the three states are one decision. Each list building
 * its own is how the boards ended up with a differently sized button from
 * everything else on the page.
 */
function BuyButton({ owned, equipped, price, coins, onBuy, onEquip }: BuyButtonProps) {
  if (equipped) return <span className="shop-tag shop-tag-on">Equipped</span>;

  if (owned) {
    return (
      <TapButton className="shop-button" onTap={onEquip}>
        Equip
      </TapButton>
    );
  }

  return (
    <TapButton className="shop-button shop-button-buy" disabled={coins < price} onTap={onBuy}>
      <span className="shop-coin" aria-hidden="true" />
      {price.toLocaleString()}
    </TapButton>
  );
}

export function Shop({ onClose }: ShopProps) {
  const save = useMetaStore((state) => state.save);
  const buySkin = useMetaStore((state) => state.buySkin);
  const equipSkin = useMetaStore((state) => state.equipSkin);
  const buyUpgrade = useMetaStore((state) => state.buyUpgrade);
  const buyCharacter = useMetaStore((state) => state.buyCharacter);
  const equipCharacter = useMetaStore((state) => state.equipCharacter);

  const [tab, setTab] = useState<ShopTab>('boards');
  const scrollRef = useRef<HTMLDivElement>(null);

  const wearing = characterDef(save.equippedCharacter);
  const riding = skinDef(save.equippedSkin);

  // Switching tabs scrolls back to the top. Landing halfway down a shorter list
  // because the last one was longer reads as the page having jumped.
  const openTab = (next: ShopTab) => {
    setTab(next);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <Page
      title="Shop"
      onClose={onClose}
      aside={
        <span className="shop-wallet">
          <span className="shop-coin" aria-hidden="true" />
          {save.coins.toLocaleString()}
        </span>
      }
      toolbar={
        <>
          <p className="shop-wearing">
            {wearing.name} on the {riding.name}
          </p>
          <div className="shop-tabs" role="tablist" aria-label="Shop sections">
            {SHOP_TABS.map((entry) => (
              <TapButton
                key={entry.id}
                className={`shop-tab${tab === entry.id ? ' shop-tab-on' : ''}`}
                role="tab"
                aria-selected={tab === entry.id}
                onTap={() => openTab(entry.id)}
              >
                {entry.label}
                {hasAffordable(entry.id, save) && (
                  <span className="shop-dot" aria-label="affordable" />
                )}
              </TapButton>
            ))}
          </div>
        </>
      }
      bodyRef={scrollRef}
    >
      {tab === 'boards' && (
        <div role="tabpanel">
          <p className="panel-note">
            Every board handles differently. None is strictly best - pick the trade you want.
          </p>
          <ul className="shop-grid">
            {skinsForSale().map((skin) => {
              const equipped = save.equippedSkin === skin.id;

              return (
                <li key={skin.id} className={`shop-card${equipped ? ' shop-card-on' : ''}`}>
                  {/* This board, under the rider they have already chosen. */}
                  <RiderPreview character={wearing} skin={skin} size={66} />
                  <span className="shop-card-name">{skin.name}</span>
                  <BuyButton
                    owned={save.ownedSkins.includes(skin.id)}
                    equipped={equipped}
                    price={skin.price}
                    coins={save.coins}
                    onBuy={() => buySkin(skin.id)}
                    onEquip={() => equipSkin(skin.id)}
                  />
                  <span className="shop-tagline">{skin.tagline}</span>
                  {/* Its own row across the whole card. Squeezed into the middle
                        column it collided with the price, which is the one thing on
                        a shop card that must never be ambiguous. */}
                  <div className="shop-card-stats">
                    <BoardStatList stats={skin.stats} compact />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === 'riders' && (
        <div role="tabpanel">
          <p className="panel-note">
            Looks only. Who you ride as never changes how the board handles - that is what the
            boards are for.
          </p>
          <ul className="shop-grid">
            {CHARACTER_IDS.map((id) => {
              const character = characterDef(id);
              const equipped = save.equippedCharacter === id;

              return (
                <li key={id} className={`shop-card${equipped ? ' shop-card-on' : ''}`}>
                  {/* This rider, on the board they have already chosen. */}
                  <RiderPreview character={character} skin={riding} size={66} />
                  <span className="shop-card-name">{character.name}</span>
                  <BuyButton
                    owned={save.ownedCharacters.includes(id)}
                    equipped={equipped}
                    price={character.price}
                    coins={save.coins}
                    onBuy={() => buyCharacter(id)}
                    onEquip={() => equipCharacter(id)}
                  />
                  <span className="shop-tagline">{character.tagline}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === 'powerUps' && (
        <div role="tabpanel">
          <p className="panel-note">Every level makes a pickup last thirty per cent longer.</p>
          <ul className="shop-grid">
            {POWER_UP_IDS.map((id) => {
              const def = powerUpDef(id);
              const level = save.upgrades[id] ?? 0;
              const maxed = level >= UPGRADE_MAX_LEVEL;
              const price = upgradePrice(level);

              return (
                <li key={id} className="shop-card">
                  {/* The icon the HUD uses mid-run, in the power-up's own colour. */}
                  <span className="shop-icon" style={{ color: def.color, borderColor: def.color }}>
                    <Icon icon={powerUpIcon(id)} size={26} />
                  </span>
                  <div className="shop-card-body">
                    <span className="shop-card-name">{def.label}</span>
                    {/* Pips rather than "Lv 2/3". How much is left is read
                          without counting, which is all this has to say. */}
                    <span
                      className="shop-pips"
                      aria-label={`Level ${level} of ${UPGRADE_MAX_LEVEL}`}
                    >
                      {Array.from({ length: UPGRADE_MAX_LEVEL }, (_, i) => (
                        <span
                          key={i}
                          className="shop-pip"
                          style={i < level ? { background: def.color } : undefined}
                        />
                      ))}
                    </span>
                  </div>

                  {maxed ? (
                    <span className="shop-tag shop-tag-on">Max</span>
                  ) : (
                    <TapButton
                      className="shop-button shop-button-buy"
                      disabled={save.coins < price}
                      onTap={() => buyUpgrade(id)}
                    >
                      <span className="shop-coin" aria-hidden="true" />
                      {price.toLocaleString()}
                    </TapButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Page>
  );
}
