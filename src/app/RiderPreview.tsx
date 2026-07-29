/**
 * The rider, as they will actually look on the slope.
 *
 * Drawn as SVG rather than rendered in 3D. A live preview per shop row would
 * mean a WebGL context per row - mobile browsers cap those at a handful and
 * evict the oldest, which would take the game's own canvas down with it. SVG
 * costs nothing, stays sharp at any size, and re-colours from the same values
 * the 3D model bakes into its vertices, so a choice reads the same here as it
 * does in play.
 *
 * Takes a character *and* a board, because those are two independent choices
 * and the whole point of the preview is showing the combination. It used to
 * take only a board and read the fur off it, which is exactly the confusion
 * the two were split apart to end.
 *
 * Deliberately a three-quarter view. In game the camera is behind the rider,
 * but a shop needs to show the face and the front of the board.
 */

import type { CharacterDef } from '@/game/content/characters';
import type { SkinDef } from '@/game/content/skins';

export interface RiderPreviewProps {
  character: CharacterDef;
  skin: SkinDef;
  size?: number;
}

export function RiderPreview({ character, skin, size = 56 }: RiderPreviewProps) {
  const { fur, furShade, face, accent } = character;
  const { board, boardTrim } = skin;

  return (
    <svg
      className="rider-preview"
      width={size}
      height={size}
      viewBox="0 0 72 72"
      role="img"
      aria-label={`${character.name} on the ${skin.name} board`}
    >
      {/* Snow shadow, grounding the rider so it does not float in the tile. */}
      <ellipse cx="36" cy="64" rx="24" ry="3.4" fill={furShade} opacity="0.35" />

      <g transform="rotate(-9 36 60)">
        {/* Deck and its rail stripe. */}
        <rect x="8" y="55" width="56" height="7" rx="3.5" fill={board} />
        <rect x="13" y="57.2" width="46" height="2" rx="1" fill={boardTrim} />
      </g>

      {/* Boots, in the board's colours so the rider reads as kitted out. */}
      <rect x="26" y="48" width="9" height="8" rx="2" fill={board} />
      <rect x="38" y="48" width="9" height="8" rx="2" fill={board} />

      {/* Legs. */}
      <rect x="28" y="41" width="6" height="9" rx="3" fill={furShade} />
      <rect x="39" y="41" width="6" height="9" rx="3" fill={furShade} />

      {/* Scarf, trailing back and out - the same read as the 3D model, and the
          rider's colour there too. */}
      <path d="M44 27 q11 1 16 7 q-6 1 -9 -1 q-3 3 -8 2 z" fill={accent} />

      {/*
        Torso as a shaggy silhouette. The jagged edge is what separates "yeti"
        from "snowman" at this size, exactly as the fur rings do in 3D.
      */}
      <path
        d="M36 20
           l7 2 l3 -2 l2 4 l4 1 l-3 3 l3 4 l-4 1 l1 5 l-4 1 l0 5 l-4 2
           l-5 1 l-5 -1 l-4 -2 l0 -5 l-4 -1 l1 -5 l-4 -1 l3 -4 l-3 -3 l4 -1
           l2 -4 l3 2 z"
        fill={fur}
      />

      {/* Arms. */}
      <rect x="17" y="29" width="6" height="14" rx="3" fill={furShade} />
      <rect x="49" y="29" width="6" height="14" rx="3" fill={furShade} />

      {/* Ears. */}
      <circle cx="25" cy="13" r="4" fill={furShade} />
      <circle cx="47" cy="13" r="4" fill={furShade} />

      {/* Head, with a shaggy crown. */}
      <path
        d="M36 3 l3 3 l4 -2 l1 4 l4 0 l-1 4 l3 2 l-2 3
           a12 12 0 0 1 -24 0 l-2 -3 l3 -2 l-1 -4 l4 0 l1 -4 l4 2 z"
        fill={fur}
      />

      {/* Goggles: strap band, then the lens. */}
      <rect x="22" y="15" width="28" height="6" rx="3" fill={accent} />
      <rect x="26" y="14.5" width="20" height="7" rx="3.5" fill={face} />
      {/* Highlight, so the lens reads as glass rather than a hole. */}
      <rect x="28.5" y="16" width="6" height="2.2" rx="1.1" fill="#fff" opacity="0.45" />
    </svg>
  );
}
